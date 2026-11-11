import { frozen, validate } from '../schema.js';
import {
  RuntimeError,
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
import { ExecutionStore } from './execution-store.js';
import { inputCount, latestInputSequence, pendingInputs } from './input.js';
import type { OperationExecutor } from './operation-executor.js';
import type { RequestRow, SqliteStore, WorkRow } from './store.js';
import { validateWaitBindings, workflowWaits } from './wait.js';

export interface ExecutionEngineOptions {
  readonly store: SqliteStore;
  readonly registry: DefinitionRegistry;
  readonly operations: OperationExecutor;
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
      let childStates: readonly Json[] | undefined;
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
        );
        if (
          workPolicy.maxOperations !== undefined &&
          (proposal.type === 'call' ||
            proposal.type === 'child' ||
            proposal.type === 'children' ||
            (proposal.type === 'wait' && proposal.until)) &&
          row.operations + (proposal.type === 'children' ? proposal.children.length : 1) >
            workPolicy.maxOperations
        )
          throw new RuntimeError('LIMIT_EXCEEDED', 'Workflow operation limit reached');
        if (proposal.type === 'wait' && proposal.until)
          validateWaitBindings(proposal.until, waits, row.control_token);
        if (proposal.type === 'call' && calls[proposal.call.slot])
          throw new RuntimeError('DUPLICATE_SLOT', 'Request slot already exists in this Work');
        if (proposal.type === 'child' && children[proposal.child.slot])
          throw new RuntimeError('DUPLICATE_SLOT', 'Child Work slot already exists in this Work');
        if (proposal.type === 'child') {
          const child = this.options.registry.workflow(proposal.child.definition)!;
          childStates = [validate(child.state, child.initial(frozen(proposal.child.objective)))];
        }
        if (proposal.type === 'children') {
          const slots = new Set(Object.keys(children));
          if (proposal.children.some((child) => slots.has(child.slot)))
            throw new RuntimeError('DUPLICATE_SLOT', 'Child Work slot already exists in this Work');
          childStates = proposal.children.map((planned) => {
            const child = this.options.registry.workflow(planned.definition)!;
            return validate(child.state, child.initial(frozen(planned.objective)));
          });
        }
      } catch (error) {
        this.fail(row, reason(error));
        continue;
      }
      this.options.checkpoint('proposal');
      const committed = this.transactions.commit({
        row,
        definition,
        proposal,
        inputs: batch,
        inputBoundary,
        ...(childStates === undefined ? {} : { childStates }),
      });
      if (!committed) continue;
      this.options.checkpoint(
        proposal.type === 'call' ||
          proposal.type === 'child' ||
          proposal.type === 'children' ||
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
      `SELECT c.slot,w.id,w.definition,w.objective,w.status,w.closure
       FROM child_work c JOIN work w ON w.id=c.child_work_id
       WHERE c.parent_work_id=? ORDER BY c.decision_sequence,c.slot`,
    )
    .all(parentWorkId) as {
    slot: string;
    id: string;
    definition: string;
    objective: string;
    status: 'active' | 'waiting' | 'closed';
    closure: string | null;
  }[];
  return rows.map((row) => ({
    slot: row.slot,
    work: { id: row.id as WorkId, definition: JSON.parse(row.definition) },
    objective: JSON.parse(row.objective),
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
