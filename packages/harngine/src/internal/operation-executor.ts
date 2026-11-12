import { entityId } from './id.js';
import type {
  AnyTool,
  EffectResolutionAcceptance,
  Identity,
  Json,
  Outcome,
  Policy,
  ReconciliationResult,
  Reason,
  Receipt,
  ResolveEffectRequest,
  WorkId,
} from './contracts.js';
import { RuntimeError } from './contracts.js';
import { copy, frozen, key, validate } from '../schema.js';
import type { ModelDelta, ModelItem } from '../model.js';
import { checkedOutcome, checkedReconciliation, reason } from './core.js';
import { OperationStore, type CallAuthorizationRecord } from './operation-store.js';
import type { RequestRow, SqliteStore, WorkRow } from './store.js';
import {
  runGuardrails,
  type GuardrailDecision,
  type GuardrailReason,
  type GuardrailRun,
  type GuardrailStage,
} from '../guardrail.js';

export interface CallAccessPolicy {
  readonly revision: string;
  canCall(input: {
    principal: string;
    workId: WorkId;
    target: Identity & { readonly kind: 'tool' | 'agent' | 'workflow' };
    tool: Identity;
    input: Json;
  }): boolean | Promise<boolean>;
}

export interface OperationExecutorOptions {
  readonly store: SqliteStore;
  readonly tools: ReadonlyMap<string, AnyTool>;
  readonly access: CallAccessPolicy;
  readonly shouldContinue: () => boolean;
  readonly checkpoint: (
    boundary:
      | 'beforeAdmission'
      | 'admission'
      | 'outcome'
      | 'reconciliationAdmission'
      | 'reconciliationOutcome',
  ) => void;
  readonly clock: () => number;
  readonly fail: (row: WorkRow, problem: Reason) => void;
  readonly onModelDelta?: (delta: ModelDelta) => void;
}

/** Admits, invokes, and settles Tool operations without owning Work scheduling. */
export class OperationExecutor {
  private readonly transactions: OperationStore;
  private readonly invocations = new Map<string, AbortController>();

  constructor(private readonly options: OperationExecutorOptions) {
    this.transactions = new OperationStore(options.store);
  }

  recover(): void {
    this.transactions.recoverAdmittedAttempts((request) => {
      const selected = this.options.tools.get(key(JSON.parse(request.tool)));
      return selected?.effect === 'read' && selected.category === 'model';
    });
    this.transactions.recoverAdmittedReconciliations();
  }

  abort(workId: string): void {
    this.invocations.get(workId)?.abort();
  }

  abortAll(): void {
    for (const invocation of new Set(this.invocations.values())) invocation.abort();
  }

  resolveUnknown(
    caller: { readonly principal: string; readonly source: string },
    workId: WorkId,
    request: ResolveEffectRequest,
  ): Receipt<EffectResolutionAcceptance> {
    const operation = this.options.store
      .requests(workId)
      .find((candidate) => candidate.id === request.operationId);
    const selectedTool = operation
      ? this.options.tools.get(key(JSON.parse(operation.tool)))
      : undefined;
    if (operation?.status === 'unknown' && !selectedTool)
      throw new RuntimeError('UNAVAILABLE', 'The exact Tool revision is unavailable');
    const checkedRequest =
      request.resolution.status === 'success' && selectedTool
        ? {
            ...request,
            resolution: {
              status: 'success' as const,
              value: validate(selectedTool.output, request.resolution.value),
            },
          }
        : request;
    return this.transactions.resolveUnknown(caller, workId, checkedRequest, {
      retryMaxAttempts: selectedTool?.retry?.maxAttempts ?? 1,
      approvalRequired: Boolean(selectedTool?.approval),
      now: this.options.clock(),
    });
  }

  reconcileOne(): false | Promise<true> {
    const candidates = this.options.store.db
      .prepare(
        `SELECT r.*,a.id AS unknown_attempt_id,e.id AS reconciliation_id
         FROM requests r
         JOIN work w ON w.id=r.work_id AND w.status!='closed'
         JOIN attempts a ON a.operation_id=r.id AND a.status='unknown'
         LEFT JOIN effect_reconciliation_attempts e ON e.attempt_id=a.id
         WHERE r.status='unknown' AND (e.id IS NULL OR e.status='planned')
         ORDER BY r.work_id,r.decision_sequence,a.sequence`,
      )
      .all() as (RequestRow & {
      unknown_attempt_id: string;
      reconciliation_id: string | null;
    })[];
    const selected = candidates
      .map((request) => ({
        request,
        tool: this.options.tools.get(key(JSON.parse(request.tool))),
      }))
      .find((candidate) => candidate.tool?.reconcile);
    if (!selected?.tool?.reconcile) return false;
    const { request, tool } = selected;
    return this.runReconciliation(request, tool, tool.reconcile!);
  }

  private async runReconciliation(
    request: RequestRow & { unknown_attempt_id: string; reconciliation_id: string | null },
    tool: AnyTool,
    reconcile: NonNullable<AnyTool['reconcile']>,
  ): Promise<true> {
    const reconciliationId = request.reconciliation_id ?? entityId('reconcile');
    if (
      !this.transactions.admitReconciliation({
        workId: request.work_id,
        operationId: request.id,
        attemptId: request.unknown_attempt_id,
        reconciliationId,
        now: this.options.clock(),
      })
    )
      return true;
    const controller = new AbortController();
    this.invocations.set(request.work_id, controller);
    this.options.checkpoint('reconciliationAdmission');
    let result: ReconciliationResult;
    try {
      result = checkedReconciliation(
        tool,
        await reconcile({
          input: frozen(validate(tool.input, JSON.parse(request.input))),
          operationId: request.id,
          attemptId: request.unknown_attempt_id,
          signal: controller.signal,
        }),
      );
    } catch (error) {
      result = {
        status: 'unknown',
        reason: { code: 'RECONCILIATION_ERROR', message: reason(error).message },
      };
    }
    this.invocations.delete(request.work_id);
    this.transactions.settleReconciliation({
      workId: request.work_id,
      operationId: request.id,
      attemptId: request.unknown_attempt_id,
      reconciliationId,
      result,
      retryMaxAttempts: tool.retry?.maxAttempts ?? 1,
      approvalRequired: Boolean(tool.approval),
      now: this.options.clock(),
    });
    this.options.checkpoint('reconciliationOutcome');
    return true;
  }

  async execute(row: WorkRow, request: RequestRow): Promise<boolean> {
    const selectedTool = this.options.tools.get(key(JSON.parse(request.tool)));
    if (!selectedTool) return false;
    const policy = JSON.parse(row.policy) as Policy;
    if (row.spent >= policy.maxAttempts) {
      this.options.fail(row, { code: 'ATTEMPT_LIMIT', message: 'Attempt limit reached' });
      return true;
    }
    const modelTurn = selectedTool.category === 'model';
    if (
      (modelTurn &&
        policy.maxModelTurns !== undefined &&
        row.model_turns >= policy.maxModelTurns) ||
      (!modelTurn &&
        policy.maxToolExecutions !== undefined &&
        row.tool_executions >= policy.maxToolExecutions)
    ) {
      this.options.fail(row, { code: 'LIMIT_EXCEEDED', message: 'Execution limit reached' });
      return true;
    }
    const input = validate(selectedTool.input, JSON.parse(request.input));
    const inputStage: GuardrailStage = modelTurn ? 'model-input' : 'tool-input';
    const outputStage: GuardrailStage = modelTurn ? 'model-output' : 'tool-output';
    const toolRevision = selectedTool.version as `rev_${string}`;
    const controller = new AbortController();
    this.invocations.set(row.id, controller);
    const inputAlreadyChecked = this.transactions.hasInputGuardrailDecisions(
      row.id,
      request.id,
      inputStage,
    );
    let inputGuardrails: GuardrailRun = Object.freeze({
      allowed: true,
      value: input,
      decisions: Object.freeze([]),
    });
    if (!inputAlreadyChecked && selectedTool.guardrails?.length) {
      try {
        inputGuardrails = await runGuardrails(selectedTool.guardrails ?? [], {
          stage: inputStage,
          value: input,
          subject: {
            kind: modelTurn ? 'agent' : 'tool',
            id: selectedTool.id,
            revision: toolRevision,
          },
          signal: controller.signal,
        });
      } catch (error) {
        this.invocations.delete(row.id);
        if (controller.signal.aborted) return true;
        throw error;
      }
    }
    if (!inputGuardrails.allowed) {
      this.invocations.delete(row.id);
      this.transactions.blockCall({
        workId: row.id,
        operationId: request.id,
        decisions: inputGuardrails.decisions,
        reason: [...inputGuardrails.decisions]
          .reverse()
          .find((decision) => decision.action === 'block')?.reason ?? {
          code: 'GUARDRAIL_BLOCKED',
          message: 'Tool input was blocked by a guardrail',
        },
      });
      return true;
    }
    let effectiveInput: Json;
    try {
      effectiveInput = validate(selectedTool.input, inputGuardrails.value);
    } catch {
      const decisions = invalidGuardrailDecision(
        inputGuardrails,
        'GUARDRAIL_INVALID_INPUT',
        'Guardrail redacted input does not satisfy the Tool input contract',
      );
      this.invocations.delete(row.id);
      this.transactions.blockCall({
        workId: row.id,
        operationId: request.id,
        decisions,
        reason: [...decisions].reverse().find((decision) => decision.action === 'block')
          ?.reason ?? {
          code: 'GUARDRAIL_INVALID_INPUT',
          message: 'Guardrail redacted input does not satisfy the Tool input contract',
        },
      });
      return true;
    }
    if (
      !this.transactions.recordInputGuardrails({
        workId: row.id,
        operationId: request.id,
        decisions: inputGuardrails.decisions,
        effectiveInput,
      })
    ) {
      this.invocations.delete(row.id);
      return true;
    }
    const authorization: CallAuthorizationRecord = {
      principal: row.principal,
      policyRevision: this.options.access.revision,
      tool: JSON.parse(request.tool) as Identity & Json,
      input: effectiveInput,
    };
    const access = this.options.access.canCall({
      principal: row.principal,
      workId: row.id as WorkId,
      target: {
        kind: 'tool',
        id: authorization.tool.id,
        version: authorization.tool.version,
      },
      tool: authorization.tool,
      input: effectiveInput,
    });
    const authorized = typeof access === 'boolean' ? access : await access;
    if (!this.options.shouldContinue()) {
      this.invocations.delete(row.id);
      return true;
    }
    if (!authorized) {
      this.invocations.delete(row.id);
      this.transactions.denyCall(row.id, request.id, authorization, inputGuardrails.decisions);
      return true;
    }

    const attemptId = entityId('attempt');
    this.options.checkpoint('beforeAdmission');
    const admission = this.transactions.admitAttempt({
      workId: row.id,
      operationId: request.id,
      attemptId,
      modelTurn,
      approvalRequired: Boolean(selectedTool.approval),
      authorized: authorization,
      now: this.options.clock(),
    });
    if (!admission.admitted) {
      this.invocations.delete(row.id);
      return true;
    }

    this.options.checkpoint('admission');
    let outcome: Outcome;
    let outputGuardrails: readonly GuardrailDecision[] = Object.freeze([]);
    let modelDeltaSequence = 0;
    let modelDeltaActive = true;
    const canStreamModelOutput =
      modelTurn &&
      !selectedTool.guardrails?.some((guardrail) => guardrail.stages.includes(outputStage));
    try {
      outcome = checkedOutcome(
        selectedTool,
        await selectedTool
          .invoke(
            Object.freeze({
              input: frozen(effectiveInput),
              operationId: request.id,
              attemptId,
              signal: controller.signal,
              ...(modelTurn
                ? {
                    ...(canStreamModelOutput
                      ? {
                          emitModelItem: (item: ModelItem) => {
                            if (
                              !modelDeltaActive ||
                              controller.signal.aborted ||
                              !this.options.onModelDelta
                            )
                              return;
                            try {
                              this.options.onModelDelta({
                                object: 'model_delta',
                                type: 'model.delta',
                                workId: row.id as WorkId,
                                callId: request.id,
                                attemptId,
                                sequence: modelDeltaSequence++,
                                item: frozen(copy(item)),
                              });
                            } catch {
                              // A malformed or changing preview cannot alter provider execution.
                            }
                          },
                        }
                      : {}),
                    progress: (event: {
                      type: string;
                      text?: string;
                      usage?: {
                        inputTokens?: number;
                        outputTokens?: number;
                        totalTokens?: number;
                        cost?: { amountMicros: number; currency: string };
                      };
                    }) => {
                      if (
                        controller.signal.aborted ||
                        !['started', 'reasoning', 'completed'].includes(event.type)
                      )
                        return;
                      const text =
                        typeof event.text === 'string' ? event.text.slice(0, 2000) : undefined;
                      const usage =
                        event.usage &&
                        [
                          event.usage.inputTokens,
                          event.usage.outputTokens,
                          event.usage.totalTokens,
                        ].every(
                          (value) =>
                            value === undefined || (Number.isSafeInteger(value) && value >= 0),
                        ) &&
                        (event.usage.cost === undefined ||
                          (Number.isSafeInteger(event.usage.cost.amountMicros) &&
                            event.usage.cost.amountMicros >= 0 &&
                            typeof event.usage.cost.currency === 'string' &&
                            event.usage.cost.currency.length > 0 &&
                            event.usage.cost.currency.length <= 16))
                          ? event.usage
                          : undefined;
                      const recordedUsage: Json | undefined = usage
                        ? {
                            ...(usage.inputTokens === undefined
                              ? {}
                              : { inputTokens: usage.inputTokens }),
                            ...(usage.outputTokens === undefined
                              ? {}
                              : { outputTokens: usage.outputTokens }),
                            ...(usage.totalTokens === undefined
                              ? {}
                              : { totalTokens: usage.totalTokens }),
                            ...(usage.cost
                              ? {
                                  cost: {
                                    amountMicros: usage.cost.amountMicros,
                                    currency: usage.cost.currency,
                                  },
                                }
                              : {}),
                          }
                        : undefined;
                      this.options.store.write(() =>
                        this.options.store.event(row.id, 'model.progress', {
                          operationId: request.id,
                          attemptId,
                          type: event.type,
                          ...(text ? { text } : {}),
                          ...(recordedUsage ? { usage: recordedUsage } : {}),
                        }),
                      );
                    },
                  }
                : {}),
            }),
          )
          .finally(() => {
            modelDeltaActive = false;
          }),
      );
      if (outcome.status === 'success' && selectedTool.guardrails?.length) {
        let guardrails: GuardrailRun;
        try {
          guardrails = await runGuardrails(selectedTool.guardrails, {
            stage: outputStage,
            value: outcome.value,
            subject: {
              kind: modelTurn ? 'agent' : 'tool',
              id: selectedTool.id,
              revision: toolRevision,
            },
            signal: controller.signal,
          });
        } catch (error) {
          if (!controller.signal.aborted) throw error;
          guardrails = {
            allowed: false,
            value: outcome.value,
            decisions: Object.freeze([
              Object.freeze({
                object: 'guardrail_decision',
                stage: outputStage,
                guardrail: {
                  id: selectedTool.id,
                  revision: toolRevision,
                },
                action: 'block',
                reason: {
                  code: 'GUARDRAIL_INTERRUPTED',
                  message: 'Guardrail evaluation was interrupted after invocation',
                },
              }),
            ]),
          };
        }
        outputGuardrails = guardrails.decisions;
        if (!guardrails.allowed) {
          outcome = {
            status: 'failure',
            effect: selectedTool.effect === 'read' ? 'none' : 'occurred',
            reason: [...guardrails.decisions]
              .reverse()
              .find((decision) => decision.action === 'block')?.reason ?? {
              code: 'GUARDRAIL_BLOCKED',
              message: 'Tool output was blocked by a guardrail',
            },
          };
        } else {
          try {
            outcome = {
              status: 'success',
              value: validate(selectedTool.output, guardrails.value),
            };
          } catch {
            outputGuardrails = invalidGuardrailDecision(
              guardrails,
              'GUARDRAIL_INVALID_OUTPUT',
              'Guardrail redacted output does not satisfy the Tool output contract',
            );
            outcome = {
              status: 'failure',
              effect: selectedTool.effect === 'read' ? 'none' : 'occurred',
              reason: [...outputGuardrails]
                .reverse()
                .find((decision) => decision.action === 'block')?.reason ?? {
                code: 'GUARDRAIL_INVALID_OUTPUT',
                message: 'Guardrail redacted output does not satisfy the Tool output contract',
              },
            };
          }
        }
      }
    } catch (error) {
      outcome = {
        status: 'unknown',
        reason: { code: 'INVOCATION_ERROR', message: reason(error).message },
      };
    }
    this.invocations.delete(row.id);
    this.transactions.settleAttempt({
      workId: row.id,
      operationId: request.id,
      attemptId,
      outcome,
      retryMaxAttempts: selectedTool.retry?.maxAttempts ?? 1,
      approvalRequired: Boolean(selectedTool.approval),
      guardrailDecisions: outputGuardrails,
    });
    this.options.checkpoint('outcome');
    if (outcome.status === 'unknown' && selectedTool.unknownEffect === 'fail')
      this.options.fail(this.options.store.work(row.id), {
        code: 'TOOL_EFFECT_UNKNOWN',
        message: outcome.reason.message,
      });
    return true;
  }
}

function invalidGuardrailDecision(
  run: GuardrailRun,
  code: string,
  message: string,
): readonly GuardrailDecision[] {
  const redacted = [...run.decisions].reverse().find((decision) => decision.action === 'redact');
  if (!redacted) return run.decisions;
  const blocked: GuardrailDecision = Object.freeze({
    object: 'guardrail_decision',
    stage: redacted.stage,
    guardrail: redacted.guardrail,
    action: 'block',
    reason: Object.freeze({ code, message } satisfies GuardrailReason),
  });
  return Object.freeze([...run.decisions, blocked]);
}
