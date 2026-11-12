import { frozen, validate } from '../schema.js';
import {
  RuntimeError,
  type AnyWorkflow,
  type CallRecord,
  type ChildWorkRecord,
  type Closure,
  type ControlToken,
  type ObjectiveRevision,
  type Json,
  type Policy,
  type Proposal,
  type Reason,
  type View,
  type WorkId,
} from './contracts.js';
import { checkedProposal, reason } from './core.js';
import type { DefinitionRegistry } from './definition-registry.js';
import {
  ExecutionStore,
  type ChildCallAuthorization,
  type PreparedChild,
} from './execution-store.js';
import { entityId } from './id.js';
import { inputCount, latestInputSequence, pendingInputs } from './input.js';
import type { OperationExecutor } from './operation-executor.js';
import type { CallAccessPolicy } from './operation-executor.js';
import type { RequestRow, SqliteStore, WorkRow } from './store.js';
import { validateWaitBindings, workflowWaits } from './wait.js';
import {
  runGuardrails,
  type GuardrailDecision,
  type GuardrailReason,
  type GuardrailRun,
  type GuardrailStage,
} from '../guardrail.js';

export interface ExecutionEngineOptions {
  readonly store: SqliteStore;
  readonly registry: DefinitionRegistry;
  readonly operations: OperationExecutor;
  readonly access: CallAccessPolicy;
  readonly shouldContinue: () => boolean;
  readonly beforeCycle: () => void;
  readonly checkpoint: (boundary: 'proposal' | 'decision' | 'closure') => void;
  readonly clock: () => number;
  readonly publishClosure: (workId: WorkId, closure: Closure) => void;
}

/** Advances durable Work while leaving host scheduling and Tool invocation to their authorities. */
export class ExecutionEngine {
  private readonly transactions: ExecutionStore;

  constructor(private readonly options: ExecutionEngineOptions) {
    this.transactions = new ExecutionStore(options.store, {
      registry: options.registry,
      clock: options.clock,
      publishClosure: options.publishClosure,
    });
  }

  async drive(): Promise<void> {
    const blocked = new Set<string>();
    while (this.options.shouldContinue()) {
      this.options.beforeCycle();
      const reconciling = this.options.operations.reconcileOne();
      if (reconciling) {
        await reconciling;
        continue;
      }
      const row = this.transactions.runnable(blocked);
      if (!row) return;
      const definition = this.options.registry.workflow(JSON.parse(row.definition));
      if (!definition) {
        blocked.add(row.id);
        continue;
      }
      const planned = this.options.store
        .requests(row.id)
        .find((request) => request.status === 'planned');
      if (planned) {
        if (!(await this.options.operations.execute(row, planned))) blocked.add(row.id);
        continue;
      }
      const unresolved = this.options.store
        .requests(row.id)
        .some((request) => request.status === 'unknown' || request.status === 'admitted');
      if (unresolved) {
        blocked.add(row.id);
        continue;
      }
      const workPolicy = JSON.parse(row.policy) as Policy;
      if (workPolicy.maxOperations === undefined && row.decisions >= workPolicy.maxDecisions) {
        this.fail(row, { code: 'DECISION_LIMIT', message: 'Decision limit reached' });
        continue;
      }
      const waits = workflowWaits(this.options.store, row.id);
      const batch = pendingInputs(this.options.store, row.id, definition.input?.batchSize ?? 0);
      const inputBoundary =
        batch.at(-1)?.sequence ?? latestInputSequence(this.options.store, row.id);
      const hasMoreInputs = inputCount(this.options.store, row.id) > batch.length;
      let proposal: Proposal;
      let childCalls: readonly PreparedChild[] | undefined;
      try {
        const calls: Record<string, CallRecord> = Object.create(null);
        for (const call of this.options.store.requests(row.id)) calls[call.slot] = callRecord(call);
        const children: Record<string, ChildWorkRecord> = Object.create(null);
        for (const child of childRecords(this.options.store, row.id)) children[child.slot] = child;
        const view: View = frozen({
          workId: row.id as WorkId,
          objective: JSON.parse(row.objective),
          state: JSON.parse(row.state),
          context: JSON.parse(row.context),
          basis: row.basis,
          objectiveRevision: row.objective_revision as ObjectiveRevision,
          stateRevision: row.state_revision as ObjectiveRevision,
          controlToken: row.control_token as ControlToken,
          calls,
          children,
          waits: Object.fromEntries(waits.map((wait) => [wait.slot, wait])),
          inputs: batch,
          inputBoundary,
          hasMoreInputs,
        });
        const derived = definition.decide(view);
        const raw =
          derived && typeof (derived as unknown as { then?: unknown }).then === 'function'
            ? await derived
            : derived;
        proposal = checkedProposal(
          definition,
          raw,
          this.options.registry.tools,
          (reference) => this.options.registry.workflow(reference),
          batch,
          hasMoreInputs,
          children,
        );
        if (
          workPolicy.maxOperations !== undefined &&
          (proposal.type === 'call' ||
            proposal.type === 'child' ||
            proposal.type === 'children' ||
            proposal.type === 'join' ||
            (proposal.type === 'wait' && proposal.until)) &&
          row.operations + (proposal.type === 'children' ? proposal.children.length : 1) >
            workPolicy.maxOperations
        )
          throw new RuntimeError('LIMIT_EXCEEDED', 'Workflow operation limit reached');
        if (proposal.type === 'wait' && proposal.until)
          validateWaitBindings(proposal.until, waits, row.control_token);
        if (
          (proposal.type === 'call' &&
            (calls[proposal.call.slot] || children[proposal.call.slot])) ||
          (proposal.type === 'child' &&
            (calls[proposal.child.slot] || children[proposal.child.slot])) ||
          (proposal.type === 'join' &&
            (calls[proposal.join.slot] ||
              children[proposal.join.slot] ||
              Object.values(children).some(
                (child) =>
                  child.joinSlot === (proposal as Extract<Proposal, { type: 'join' }>).join.slot,
              )))
        )
          throw new RuntimeError('DUPLICATE_SLOT', 'Request slot already exists in this Work');
        if (proposal.type === 'child') {
          ensureChildCapacity(this.options.store, row, workPolicy, 1);
          const child = this.options.registry.workflow(proposal.child.definition)!;
          childCalls = [
            prepareChild(
              proposal.child.slot,
              proposal.child.definition,
              proposal.child.objective,
              proposal.child.mode,
              child,
              this.options.registry,
            ),
          ];
        }
        if (proposal.type === 'children') {
          const slots = new Set(Object.keys(children));
          if (proposal.children.some((child) => slots.has(child.slot)))
            throw new RuntimeError('DUPLICATE_SLOT', 'Child Work slot already exists in this Work');
          ensureChildCapacity(this.options.store, row, workPolicy, proposal.children.length);
          childCalls = proposal.children.map((planned) => {
            const child = this.options.registry.workflow(planned.definition)!;
            return prepareChild(
              planned.slot,
              planned.definition,
              planned.objective,
              planned.mode,
              child,
              this.options.registry,
            );
          });
        }
      } catch (error) {
        this.fail(row, reason(error));
        continue;
      }
      let guardrailDecisions: readonly GuardrailDecision[] | undefined;
      let blockedCallReason: Reason | undefined;
      if (proposal.type === 'call') {
        const selectedTool = this.options.registry.tool(proposal.call.tool);
        if (selectedTool?.guardrails?.length) {
          const stage: GuardrailStage =
            selectedTool.category === 'model' ? 'model-input' : 'tool-input';
          let checked: GuardrailRun;
          try {
            checked = await runGuardrails(selectedTool.guardrails, {
              stage,
              value: proposal.call.input,
              subject: {
                kind: selectedTool.category === 'model' ? 'agent' : 'tool',
                id: selectedTool.id,
                revision: selectedTool.version as `rev_${string}`,
              },
              signal: new AbortController().signal,
            });
          } catch (error) {
            this.fail(row, reason(error));
            continue;
          }
          guardrailDecisions = checked.decisions;
          const blocked = [...checked.decisions]
            .reverse()
            .find((decision) => decision.action === 'block');
          if (!checked.allowed) {
            blockedCallReason = blocked?.reason ?? {
              code: 'GUARDRAIL_BLOCKED',
              message: 'Tool input was blocked by a guardrail',
            };
          } else {
            try {
              const effectiveInput = validate(selectedTool.input, checked.value);
              proposal = {
                ...proposal,
                call: { ...proposal.call, input: effectiveInput },
              };
            } catch {
              guardrailDecisions = invalidGuardrailDecision(
                checked,
                'GUARDRAIL_INVALID_INPUT',
                'Guardrail redacted input does not satisfy the Tool input contract',
              );
              blockedCallReason = [...guardrailDecisions]
                .reverse()
                .find((decision) => decision.action === 'block')?.reason ?? {
                code: 'GUARDRAIL_INVALID_INPUT',
                message: 'Guardrail redacted input does not satisfy the Tool input contract',
              };
            }
          }
        }
      }
      if (!this.options.shouldContinue()) return;
      this.options.checkpoint('proposal');
      let childAuthorizations: ChildCallAuthorization[] | undefined;
      if (childCalls) {
        childAuthorizations = [];
        try {
          for (const child of childCalls) {
            const access = this.options.access.canCall({
              principal: row.principal,
              workId: row.id as WorkId,
              target: {
                kind: child.targetKind,
                id: child.definition.id,
                version: child.definition.version,
              },
              tool: child.definition,
              input: child.objective,
            });
            childAuthorizations.push({
              child,
              policyRevision: this.options.access.revision,
              allowed: typeof access === 'boolean' ? access : await access,
            });
          }
        } catch (error) {
          this.fail(row, reason(error));
          continue;
        }
        if (!this.options.shouldContinue()) return;
        if (childAuthorizations.some((authorization) => !authorization.allowed)) {
          if (this.transactions.denyChildren(row, childAuthorizations))
            this.options.checkpoint('closure');
          continue;
        }
      }
      let committed: boolean;
      try {
        committed = this.transactions.commit({
          row,
          definition,
          proposal,
          inputs: batch,
          inputBoundary,
          ...(childCalls === undefined ? {} : { childCalls }),
          ...(childAuthorizations === undefined ? {} : { childAuthorizations }),
          ...(guardrailDecisions === undefined ? {} : { guardrailDecisions }),
          ...(blockedCallReason === undefined ? {} : { blockedCallReason }),
        });
      } catch (error) {
        this.fail(row, reason(error));
        continue;
      }
      if (!committed) continue;
      this.options.checkpoint(
        proposal.type === 'call' ||
          proposal.type === 'child' ||
          proposal.type === 'children' ||
          proposal.type === 'join' ||
          proposal.type === 'wait'
          ? 'decision'
          : 'closure',
      );
    }
  }

  fail(row: WorkRow, problem: Reason): void {
    if (this.transactions.fail(row, problem)) this.options.checkpoint('closure');
  }
}

function childRecords(store: SqliteStore, parentWorkId: string): ChildWorkRecord[] {
  const rows = store.db
    .prepare(
      `SELECT c.call_id,c.slot,c.mode,c.target_kind,c.join_slot,w.id,w.definition,w.objective,w.status,w.closure
       FROM child_work c JOIN work w ON w.id=c.child_work_id
       WHERE c.parent_work_id=? ORDER BY c.decision_sequence,c.slot`,
    )
    .all(parentWorkId) as {
    call_id: string;
    slot: string;
    mode: 'sequential' | 'concurrent';
    target_kind: 'agent' | 'workflow';
    join_slot: string | null;
    id: string;
    definition: string;
    objective: string;
    status: 'active' | 'waiting' | 'closed';
    closure: string | null;
  }[];
  return rows.map((row) => ({
    callId: row.call_id,
    slot: row.slot,
    work: { id: row.id as WorkId, definition: JSON.parse(row.definition) },
    objective: JSON.parse(row.objective),
    definitionKind: row.target_kind,
    mode: row.mode,
    joinSlot: row.join_slot,
    status: row.status,
    closure: row.closure ? JSON.parse(row.closure) : null,
  }));
}

function callRecord(row: RequestRow): CallRecord {
  return {
    id: row.id,
    slot: row.slot,
    tool: JSON.parse(row.tool),
    input: JSON.parse(row.input),
    objectiveRevision: row.objective_revision as ObjectiveRevision,
    status: row.status,
    outcome: row.outcome ? JSON.parse(row.outcome) : null,
  };
}

function ensureChildCapacity(
  store: SqliteStore,
  row: WorkRow,
  policy: Policy,
  additional: number,
): void {
  const ancestor = (
    store.db
      .prepare(
        `WITH RECURSIVE ancestors(parent_work_id,depth) AS (
           SELECT parent_work_id,1 FROM child_work WHERE child_work_id=?
           UNION ALL
           SELECT c.parent_work_id,depth+1
           FROM child_work c JOIN ancestors a ON c.child_work_id=a.parent_work_id
         )
         SELECT parent_work_id AS id FROM ancestors ORDER BY depth DESC LIMIT 1`,
      )
      .get(row.id) as { id: string } | undefined
  )?.id;
  const root = ancestor ?? row.id;
  const subtree = (workId: string): number =>
    (
      store.db
        .prepare(
          `WITH RECURSIVE tree(id) AS (
             SELECT ?
             UNION ALL
             SELECT c.child_work_id FROM child_work c JOIN tree t ON c.parent_work_id=t.id
           )
           SELECT COUNT(*) AS count FROM child_work c JOIN tree t ON c.parent_work_id=t.id`,
        )
        .get(workId) as { count: number }
    ).count;
  const rootPolicy = JSON.parse(store.work(root).policy) as Policy;
  if (subtree(root) + additional > (rootPolicy.maxChildWork ?? 100))
    throw new RuntimeError('LIMIT_EXCEEDED', 'Child Work allowance reached');
  if (subtree(row.id) + additional > (policy.maxChildWork ?? 100))
    throw new RuntimeError('LIMIT_EXCEEDED', 'Branch Child Work allowance reached');
  const depth = (
    store.db
      .prepare(
        `WITH RECURSIVE ancestors(id,depth) AS (
           SELECT parent_work_id,1 FROM child_work WHERE child_work_id=?
           UNION ALL
           SELECT c.parent_work_id,depth+1
           FROM child_work c JOIN ancestors a ON c.child_work_id=a.id
         )
         SELECT COALESCE(MAX(depth),0) AS depth FROM ancestors`,
      )
      .get(row.id) as { depth: number }
  ).depth;
  if (depth + 1 > (policy.maxDepth ?? 8))
    throw new RuntimeError('LIMIT_EXCEEDED', 'Child Work depth limit reached');
}

function prepareChild(
  slot: string,
  definition: { readonly id: string; readonly version: string },
  objective: Json,
  mode: 'sequential' | 'concurrent' | undefined,
  child: AnyWorkflow,
  registry: DefinitionRegistry,
): PreparedChild {
  return {
    callId: entityId('call'),
    slot,
    definition,
    objective,
    targetKind: registry.agent(definition) ? 'agent' : 'workflow',
    mode: mode ?? 'sequential',
    state: validate(child.state, child.initial(frozen(objective))),
  };
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
