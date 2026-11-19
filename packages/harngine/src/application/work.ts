import { WorkInspection } from './inspection.js';
import type { Closure, ControlToken, WorkRef } from '../core/execution.js';
import { Runtime, type Caller } from '../engine/runtime.js';
import type { Json, SessionId, WorkId } from '../core/types.js';
import {
  ConflictError,
  ValidationError,
  WorkCanceledError,
  WorkFailedError,
} from '../core/errors.js';
import { commandError, translateError } from './error.js';
import type {
  CancelOptions,
  EffectResolution,
  InspectionPage,
  Watch,
  WorkHandle as WorkHandleContract,
  WorkSnapshot,
  WorkUpdate,
} from './contracts.js';
import { generatedRequestId } from './codec.js';
import { publicSnapshot, projectionSnapshot } from '../projection/work.js';

function unwrapClosure<R extends Json>(closure: Closure<R>): R {
  if (closure.status === 'completed') return closure.result;
  if (closure.status === 'canceled') throw new WorkCanceledError(closure.reason);
  throw new WorkFailedError(closure.reason);
}

export class WorkHandle<O extends Json, R extends Json> implements WorkHandleContract<O, R> {
  readonly id: WorkId;

  constructor(
    private readonly runtime: Runtime,
    private readonly caller: Caller,
    private readonly ref: WorkRef<O, R>,
    private readonly steerable: boolean,
    private readonly session?: SessionId,
  ) {
    this.id = ref.id;
  }

  async snapshot(): Promise<WorkSnapshot<O, R>> {
    try {
      return publicSnapshot(
        await this.runtime.forCaller(this.caller).work.inspect(this.ref),
        this.runtime.workRecord(this.caller, this.id),
      );
    } catch (error) {
      throw translateError(error);
    }
  }

  async result(options: { signal?: AbortSignal } = {}): Promise<R> {
    try {
      return unwrapClosure(
        await this.runtime.forCaller(this.caller).work.result(this.ref, options),
      );
    } catch (error) {
      throw translateError(error);
    }
  }

  async cancel(reason = 'Canceled by application', options: CancelOptions = {}) {
    const api = this.runtime.forCaller(this.caller);
    try {
      const before = await api.work.inspect(this.ref);
      if (before.closure)
        return publicSnapshot(before, this.runtime.workRecord(this.caller, this.id));
      const receipt = await api.work.cancel(this.ref, {
        requestId: generatedRequestId(options.idempotencyKey),
        expectedControl: before.controlToken as ControlToken,
        reason,
      });
      if (receipt.status !== 'accepted') {
        const after = await api.work.inspect(this.ref);
        if (after.closure)
          return publicSnapshot(after, this.runtime.workRecord(this.caller, this.id));
        throw commandError(receipt.reason, receipt.status);
      }
      return publicSnapshot(
        await api.work.inspect(this.ref),
        this.runtime.workRecord(this.caller, this.id),
      );
    } catch (error) {
      throw translateError(error);
    }
  }

  async resolveEffect(
    callId: string,
    resolution: EffectResolution,
    options: { idempotencyKey?: string } = {},
  ): Promise<WorkSnapshot<O, R>> {
    const api = this.runtime.forCaller(this.caller);
    try {
      const receipt = await api.work.resolveEffect(this.ref, {
        requestId: generatedRequestId(options.idempotencyKey),
        operationId: callId,
        resolution,
      });
      if (receipt.status !== 'accepted') throw commandError(receipt.reason, receipt.status);
      return publicSnapshot(
        await api.work.inspect(this.ref),
        this.runtime.workRecord(this.caller, this.id),
      );
    } catch (error) {
      throw translateError(error);
    }
  }

  async respond(
    interactionId: string,
    response: Json,
    options: { idempotencyKey?: string } = {},
  ): Promise<WorkSnapshot<O, R>> {
    const api = this.runtime.forCaller(this.caller);
    try {
      const before = await api.work.inspect(this.ref);
      const approval = before.approvals.find((candidate) => candidate.wait.id === interactionId);
      const interaction = [
        ...before.waits.map((wait) => wait.wait),
        ...before.approvals.map((approval) => approval.wait),
      ].find((wait) => wait.id === interactionId);
      if (!interaction)
        throw new ConflictError({
          code: 'INTERACTION_CLOSED',
          message: 'The interaction is no longer open',
        });
      if (approval && typeof response !== 'boolean')
        throw new ValidationError({
          code: 'INVALID_DATA',
          message: 'Approval responses must be Boolean',
        });
      const receipt = await api.work.reply(this.ref, {
        requestId: generatedRequestId(options.idempotencyKey),
        wait: interaction,
        payload: approval ? { decision: response ? 'approve' : 'deny' } : response,
      });
      if (receipt.status !== 'accepted') throw commandError(receipt.reason, receipt.status);
      return publicSnapshot(
        await api.work.inspect(this.ref),
        this.runtime.workRecord(this.caller, this.id),
      );
    } catch (error) {
      throw translateError(error);
    }
  }

  async steer(input: O, options: { idempotencyKey?: string } = {}): Promise<WorkSnapshot<O, R>> {
    const api = this.runtime.forCaller(this.caller);
    try {
      if (!this.steerable)
        throw new ConflictError({
          code: 'STEERING_UNSUPPORTED',
          message: 'Only Agent-backed Work accepts steering',
        });
      const before = await api.work.inspect(this.ref);
      if (before.closure)
        throw new ConflictError({
          code: 'WORK_CLOSED',
          message: 'Completed Work cannot be steered',
        });
      const receipt = await api.work.steer(
        this.ref,
        {
          requestId: generatedRequestId(options.idempotencyKey),
          objectiveRevision: before.objectiveRevision,
          payload: input,
        },
        this.session,
      );
      if (receipt.status !== 'accepted') throw commandError(receipt.reason, receipt.status);
      return publicSnapshot(
        await api.work.inspect(this.ref),
        this.runtime.workRecord(this.caller, this.id),
      );
    } catch (error) {
      throw translateError(error);
    }
  }

  async watch(
    options: {
      after?: string;
      signal?: AbortSignal;
      onModelDelta?: (delta: import('../core/model.js').ModelDelta) => void;
    } = {},
  ): Promise<Watch<WorkSnapshot<O, R>, WorkUpdate<O, R>>> {
    const api = this.runtime.forCaller(this.caller);
    const initial = await api.work.inspect(this.ref);
    let value = publicSnapshot(initial, this.runtime.workRecord(this.caller, this.id));
    let sequence = initial.cursor;
    let cursor: string | null = null;
    let reset = false;
    if (options.after) {
      try {
        sequence = await api.work.eventCursor(this.ref, options.after);
        // Resume from the state committed with this event, not a fresh inspection of Work.
        value = projectionSnapshot<O, R>(
          await api.work.projection(this.ref, options.after),
          this.runtime.workRecord(this.caller, this.id),
        );
        cursor = options.after;
      } catch {
        reset = true;
      }
    }
    if ((!options.after || reset) && sequence > 0) {
      const page = await api.work.history(this.ref, {
        after: (sequence - 1) as typeof sequence,
        through: sequence,
        limit: 1,
      });
      cursor = page.events[0]?.id ?? null;
    }
    const watcher: Watch<WorkSnapshot<O, R>, WorkUpdate<O, R>> = {
      get value() {
        return value;
      },
      get cursor() {
        return cursor;
      },
      get reset() {
        return reset;
      },
      async *[Symbol.asyncIterator]() {
        let active = true;
        const unsubscribe = options.onModelDelta
          ? thisRuntime.subscribeModelDeltas(thisRef.id, (delta) => {
              if (active && !options.signal?.aborted) options.onModelDelta?.(delta);
            })
          : () => {};
        try {
          while (true) {
            options.signal?.throwIfAborted();
            const page = await api.work.history(thisRef, { after: sequence, limit: 100 });
            if (!page.events.length) {
              if ((await api.work.inspect(thisRef)).closure) return;
              await new Promise((resolve) => setTimeout(resolve, 20));
              continue;
            }
            for (const event of page.events) {
              options.signal?.throwIfAborted();
              sequence = event.cursor;
              value = projectionSnapshot<O, R>(
                await api.work.projection(thisRef, event.id),
                thisRuntime.workRecord(thisCaller, thisRef.id),
              );
              cursor = event.id;
              yield {
                durable: true,
                id: event.id,
                value: {
                  object: 'work_update',
                  type: 'work.updated',
                  event: event.kind,
                  snapshot: value,
                },
              };
            }
            if (
              value.status === 'completed' ||
              value.status === 'failed' ||
              value.status === 'canceled'
            )
              return;
          }
        } finally {
          active = false;
          unsubscribe();
        }
      },
    };
    const thisRef = this.ref;
    const thisRuntime = this.runtime;
    const thisCaller = this.caller;
    return watcher;
  }

  async inspect(
    options: { detail?: 'story' | 'diagnostic'; after?: string; limit?: number } = {},
  ): Promise<InspectionPage<O, R>> {
    return new WorkInspection(this.runtime, this.caller, this.ref).inspect(options);
  }
}
