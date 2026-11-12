import { canonical, identity } from '../schema.js';
import { approvals, planApproval, withdrawApprovals } from './approval.js';
import {
  RuntimeError,
  type AnyWorkflow,
  type Closure,
  type InputRecord,
  type Json,
  type Proposal,
  type Reason,
  type WorkId,
} from './contracts.js';
import type { DefinitionRegistry } from './definition-registry.js';
import { entityId } from './id.js';
import { disposeInputs, incorporateInputs, inputCount } from './input.js';
import type { SqliteStore, WorkRow } from './store.js';
import { clearWakeCondition, planWait, withdrawWaits, workflowWaits } from './wait.js';

export interface ExecutionStoreOptions {
  readonly registry: DefinitionRegistry;
  readonly clock: () => number;
  readonly publishClosure: (workId: WorkId, closure: Closure) => void;
}

export interface PreparedChild {
  readonly callId: string;
  readonly slot: string;
  readonly definition: { readonly id: string; readonly version: string };
  readonly objective: Json;
  readonly targetKind: 'agent' | 'workflow';
  readonly mode: 'sequential' | 'concurrent';
  readonly state: Json;
}

export interface ChildCallAuthorization {
  readonly child: PreparedChild;
  readonly policyRevision: string;
  readonly allowed: boolean;
}

export interface DecisionCommit {
  readonly row: WorkRow;
  readonly definition: AnyWorkflow;
  readonly proposal: Proposal;
  readonly inputs: readonly InputRecord[];
  readonly inputBoundary: number;
  readonly childCalls?: readonly PreparedChild[];
  readonly childAuthorizations?: readonly ChildCallAuthorization[];
}

/** Semantic, fenced transactions used by the Work execution engine. */
export class ExecutionStore {
  constructor(
    private readonly store: SqliteStore,
    private readonly options: ExecutionStoreOptions,
  ) {}

  runnable(blocked: ReadonlySet<string>): WorkRow | undefined {
    const rows = this.store.db
      .prepare('SELECT * FROM work WHERE eligible=1 ORDER BY id')
      .all() as WorkRow[];
    return rows.find((row) => !blocked.has(row.id));
  }

  commit(input: DecisionCommit): boolean {
    const { row, definition, proposal, inputs, inputBoundary } = input;
    return this.store.write(() => {
      const current = this.store.work(row.id);
      if (
        current.basis !== row.basis ||
        current.control_token !== row.control_token ||
        current.status === 'closed'
      )
        return false;
      if (proposal.type === 'complete' && inputCount(this.store, row.id) !== inputs.length)
        return false;
      const sequence = row.basis + 1;
      this.store.db
        .prepare(
          'INSERT INTO decisions(work_id,sequence,body,input_boundary,input_ids,context) VALUES(?,?,?,?,?,?)',
        )
        .run(
          row.id,
          sequence,
          canonical(proposal),
          inputBoundary,
          canonical(inputs.map((item) => item.id)),
          JSON.stringify({
            objective: JSON.parse(row.objective),
            state: JSON.parse(row.state),
            basis: row.basis,
            objectiveRevision: row.objective_revision,
            stateRevision: row.state_revision,
            controlToken: row.control_token,
          }),
        );
      incorporateInputs(this.store, row.id, sequence, proposal.dispositions ?? []);
      clearWakeCondition(this.store, row.id);
      if (proposal.type === 'call') this.commitCall(row, proposal, sequence, inputBoundary);
      else if (proposal.type === 'child' || proposal.type === 'children')
        this.commitChildren(
          row,
          input.childCalls!,
          proposal.state,
          sequence,
          inputBoundary,
          input.childAuthorizations!,
        );
      else if (proposal.type === 'join') this.commitJoin(row, proposal, sequence, inputBoundary);
      else if (proposal.type === 'wait')
        this.commitWait(row, definition, proposal, sequence, inputBoundary);
      else this.commitClosure(row, proposal, sequence, inputBoundary);
      return true;
    });
  }

  fail(row: WorkRow, problem: Reason): boolean {
    return this.store.write(() => this.failWork(row, problem));
  }

  denyChildren(row: WorkRow, authorizations: readonly ChildCallAuthorization[]): boolean {
    return this.store.write(() => {
      for (const authorization of authorizations) this.recordChildAuthorization(row, authorization);
      return this.failWork(row, {
        code: 'ACCESS_DENIED',
        message: 'Child Call is not authorized',
      });
    });
  }

  private commitCall(
    row: WorkRow,
    proposal: Extract<Proposal, { type: 'call' }>,
    sequence: number,
    inputBoundary: number,
  ): void {
    const operationId = entityId('call');
    this.store.db
      .prepare(
        "INSERT INTO requests(id,work_id,decision_sequence,slot,tool,input,status,outcome,objective_revision,control_token) VALUES(?,?,?,?,?,?,'planned',NULL,?,?)",
      )
      .run(
        operationId,
        row.id,
        sequence,
        proposal.call.slot,
        canonical(identity(proposal.call.tool)),
        canonical(proposal.call.input),
        row.objective_revision,
        row.control_token,
      );
    this.store.db.prepare('INSERT INTO operations VALUES(?)').run(operationId);
    const approval = this.options.registry.tool(proposal.call.tool)!.approval;
    if (approval)
      planApproval(
        this.store,
        this.store.requests(row.id).find((request) => request.id === operationId)!,
        approval,
        this.options.clock(),
      );
    this.store.db
      .prepare(
        'UPDATE work SET state=?,basis=?,state_revision=?,decisions=decisions+1,operations=operations+1 WHERE id=?',
      )
      .run(canonical(proposal.state), sequence, row.objective_revision, row.id);
    this.store.event(row.id, 'decision.committed', { operationId, inputBoundary }, sequence);
    this.store.event(
      row.id,
      'call.committed',
      {
        operationId,
        tool: { id: proposal.call.tool.id, version: proposal.call.tool.version },
      },
      sequence,
    );
    const plannedApproval = approvals(this.store, row.id).find(
      (candidate) => candidate.operationId === operationId,
    );
    if (plannedApproval)
      this.store.event(
        row.id,
        'interaction.requested',
        {
          interaction: {
            id: plannedApproval.wait.id,
            type: 'approval',
            blocking: true,
            title: `Approve ${plannedApproval.tool.id}?`,
            details: plannedApproval.input,
            tool: { id: plannedApproval.tool.id, revision: plannedApproval.tool.version },
          },
        },
        sequence,
      );
  }

  private commitWait(
    row: WorkRow,
    definition: AnyWorkflow,
    proposal: Extract<Proposal, { type: 'wait' }>,
    sequence: number,
    inputBoundary: number,
  ): void {
    const settled = proposal.until
      ? planWait(this.store, row, sequence, proposal.until, definition, this.options.clock())
      : false;
    const pending = settled || inputCount(this.store, row.id) > 0;
    this.store.db
      .prepare(
        `UPDATE work SET state=?,basis=?,state_revision=?,decisions=decisions+1,operations=operations+${proposal.until ? 1 : 0},status=?,eligible=? WHERE id=?`,
      )
      .run(
        canonical(proposal.state),
        sequence,
        row.objective_revision,
        pending ? 'active' : 'waiting',
        pending ? 1 : 0,
        row.id,
      );
    this.store.event(
      row.id,
      'decision.committed',
      { inputBoundary, waitingFor: proposal.until?.type ?? 'input' },
      sequence,
    );
    for (const planned of workflowWaits(this.store, row.id).filter(
      (candidate) => candidate.kind === 'reply' && candidate.decisionSequence === sequence,
    ))
      this.store.event(
        row.id,
        'interaction.requested',
        {
          interaction: {
            id: planned.wait.id,
            type: planned.interaction,
            blocking: planned.blocking,
            ...(planned.interaction === 'question'
              ? {
                  prompt: planned.prompt ?? 'Response required',
                  response: planned.schema?.jsonSchema ?? {},
                }
              : {
                  title: planned.prompt ?? 'Approval required',
                  details: planned.presentation,
                }),
          },
        },
        sequence,
      );
  }

  private commitChildren(
    row: WorkRow,
    children: readonly PreparedChild[],
    state: Json,
    sequence: number,
    inputBoundary: number,
    authorizations: readonly ChildCallAuthorization[],
  ): void {
    const parentPolicy = JSON.parse(row.policy) as Record<string, number | undefined>;
    const root = this.rootChildBudget(row.id);
    let used = root.used;
    const started: {
      id: WorkId;
      callId: string;
      slot: string;
      definition: { id: string; version: string };
      kind: 'agent' | 'workflow';
      mode: 'sequential' | 'concurrent';
    }[] = [];
    for (let index = 0; index < children.length; index++) {
      const planned = children[index]!;
      const definition = this.options.registry.workflow(planned.definition)!;
      const id = entityId('work') as WorkId;
      const controlToken = entityId('control');
      const childPolicy = Object.fromEntries(
        Object.entries(definition.policy).map(([name, value]) => [
          name,
          parentPolicy[name] === undefined ? value : Math.min(value, parentPolicy[name]!),
        ]),
      );
      childPolicy.maxDepth = Math.max(0, (parentPolicy.maxDepth ?? 8) - 1);
      childPolicy.maxChildWork = Math.min(
        definition.policy.maxChildWork ?? 100,
        parentPolicy.maxChildWork ?? 100,
        Math.max(0, root.limit - used - 1),
      );
      used++;
      this.recordChildAuthorization(row, authorizations[index]!);
      this.store.db
        .prepare(
          "INSERT INTO work(id,principal,definition,objective,state,policy,status,eligible,control_token,context) VALUES(?,?,?,?,?,?,'active',1,?,?)",
        )
        .run(
          id,
          row.principal,
          canonical(planned.definition),
          canonical(planned.objective),
          canonical(planned.state),
          canonical(childPolicy),
          controlToken,
          row.context,
        );
      this.store.db
        .prepare('INSERT INTO objective_revisions VALUES(?,1,?,?)')
        .run(id, canonical(planned.objective), controlToken);
      this.store.db
        .prepare(
          `INSERT INTO child_work
           (parent_work_id,slot,child_work_id,decision_sequence,control_token,call_id,mode,target_kind,join_decision,join_slot)
           VALUES(?,?,?,?,?,?,?,?,NULL,NULL)`,
        )
        .run(
          row.id,
          planned.slot,
          id,
          sequence,
          row.control_token,
          planned.callId,
          planned.mode,
          planned.targetKind,
        );
      this.store.authorization({
        action: 'start',
        principal: row.principal,
        policyRevision: 'inherited-parent-authority-v1',
        allowed: true,
        workId: id,
        targetId: id,
        subject: {
          kind: planned.targetKind,
          id: planned.definition.id,
          version: planned.definition.version,
        },
        value: planned.objective,
      });
      started.push({
        id,
        callId: planned.callId,
        slot: planned.slot,
        definition: planned.definition,
        kind: planned.targetKind,
        mode: planned.mode,
      });
    }
    const blocking = started.every((child) => child.mode === 'sequential');
    this.store.db
      .prepare(
        `UPDATE work SET state=?,basis=?,state_revision=?,decisions=decisions+1,
         operations=operations+?,status=?,eligible=? WHERE id=?`,
      )
      .run(
        canonical(state),
        sequence,
        row.objective_revision,
        children.length,
        blocking ? 'waiting' : 'active',
        blocking ? 0 : 1,
        row.id,
      );
    this.store.event(
      row.id,
      'decision.committed',
      {
        childWorkIds: started.map((child) => child.id),
        callIds: started.map((child) => child.callId),
        inputBoundary,
      },
      sequence,
    );
    for (const child of started) {
      this.store.event(
        row.id,
        'child.started',
        {
          childWorkId: child.id,
          callId: child.callId,
          slot: child.slot,
          definition: child.definition,
          kind: child.kind,
          mode: child.mode,
        },
        sequence,
      );
      this.store.event(child.id, 'work.accepted', {
        parentWorkId: row.id,
        slot: child.slot,
      });
    }
  }

  private recordChildAuthorization(row: WorkRow, authorization: ChildCallAuthorization): void {
    this.store.authorization({
      action: 'call',
      principal: row.principal,
      policyRevision: authorization.policyRevision,
      allowed: authorization.allowed,
      workId: row.id,
      targetId: authorization.child.callId,
      subject: {
        kind: authorization.child.targetKind,
        id: authorization.child.definition.id,
        version: authorization.child.definition.version,
      },
      value: authorization.child.objective,
      ...(authorization.allowed ? {} : { safeReason: 'child_call_denied' }),
    });
  }

  private failWork(row: WorkRow, problem: Reason): boolean {
    const current = this.store.work(row.id);
    if (
      current.status === 'closed' ||
      current.basis !== row.basis ||
      current.control_token !== row.control_token
    )
      return false;
    const closure: Closure = { status: 'failed', reason: problem };
    this.store.db
      .prepare(
        "UPDATE work SET status='closed',eligible=0,closure=?,concern=?,control_token=? WHERE id=?",
      )
      .run(canonical(closure), canonical(problem), entityId('control'), row.id);
    this.options.publishClosure(row.id as WorkId, closure);
    this.store.db
      .prepare("UPDATE requests SET status='withdrawn' WHERE work_id=? AND status='planned'")
      .run(row.id);
    withdrawApprovals(this.store, row.id);
    withdrawWaits(this.store, row.id);
    disposeInputs(this.store, row.id, 'failed', problem);
    this.store.event(row.id, 'work.closed', closure);
    return true;
  }

  private rootChildBudget(workId: string): { id: string; limit: number; used: number } {
    const ancestor = this.store.db
      .prepare(
        `WITH RECURSIVE ancestors(parent_work_id,depth) AS (
           SELECT parent_work_id,1 FROM child_work WHERE child_work_id=?
           UNION ALL
           SELECT c.parent_work_id,depth+1
           FROM child_work c JOIN ancestors a ON c.child_work_id=a.parent_work_id
         )
         SELECT parent_work_id AS id FROM ancestors ORDER BY depth DESC LIMIT 1`,
      )
      .get(workId) as { id: string } | undefined;
    const rootId = ancestor?.id ?? workId;
    const rootPolicy = JSON.parse(this.store.work(rootId).policy) as {
      readonly maxChildWork?: number;
    };
    const used = (
      this.store.db
        .prepare(
          `WITH RECURSIVE tree(id) AS (
             SELECT ?
             UNION ALL
             SELECT c.child_work_id FROM child_work c JOIN tree t ON c.parent_work_id=t.id
           )
           SELECT COUNT(*) AS count FROM child_work c JOIN tree t ON c.parent_work_id=t.id`,
        )
        .get(rootId) as { count: number }
    ).count;
    return { id: rootId, limit: rootPolicy.maxChildWork ?? 100, used };
  }

  private commitJoin(
    row: WorkRow,
    proposal: Extract<Proposal, { type: 'join' }>,
    sequence: number,
    inputBoundary: number,
  ): void {
    const child = this.store.db
      .prepare(
        `SELECT c.call_id,c.slot,c.mode,c.child_work_id,c.control_token,w.status
         FROM child_work c JOIN work w ON w.id=c.child_work_id
         WHERE c.parent_work_id=? AND c.slot=?`,
      )
      .get(row.id, proposal.join.child) as
      | {
          call_id: string;
          slot: string;
          mode: 'sequential' | 'concurrent';
          child_work_id: string;
          control_token: string;
          status: 'active' | 'waiting' | 'closed';
        }
      | undefined;
    if (!child) throw new RuntimeError('INVALID_PROPOSAL', 'Join target has not started');
    if (child.control_token !== row.control_token)
      throw new RuntimeError('STALE_WAIT', 'Join target belongs to an older authority scope');
    const settled = child.status === 'closed';
    this.store.db
      .prepare(
        `UPDATE child_work SET join_decision=?,join_slot=? WHERE parent_work_id=? AND slot=?`,
      )
      .run(sequence, proposal.join.slot, row.id, child.slot);
    this.store.db
      .prepare(
        `UPDATE work SET state=?,basis=?,state_revision=?,decisions=decisions+1,
         operations=operations+1,status=?,eligible=? WHERE id=?`,
      )
      .run(
        canonical(proposal.state),
        sequence,
        row.objective_revision,
        settled ? 'active' : 'waiting',
        settled ? 1 : 0,
        row.id,
      );
    this.store.event(
      row.id,
      'decision.committed',
      {
        inputBoundary,
        childWorkId: child.child_work_id,
        callId: child.call_id,
        joinSlot: proposal.join.slot,
      },
      sequence,
    );
    this.store.event(
      row.id,
      'call.joined',
      {
        childWorkId: child.child_work_id,
        callId: child.call_id,
        slot: child.slot,
        mode: child.mode,
        joinSlot: proposal.join.slot,
      },
      sequence,
    );
  }

  private commitClosure(
    row: WorkRow,
    proposal: Extract<Proposal, { type: 'complete' | 'fail' }>,
    sequence: number,
    inputBoundary: number,
  ): void {
    if (
      proposal.type === 'complete' &&
      this.store
        .requests(row.id)
        .some((request) => request.status !== 'settled' && request.status !== 'withdrawn')
    )
      throw new RuntimeError('UNSETTLED', 'Owned effects prevent completion');
    if (
      proposal.type === 'complete' &&
      this.store.db
        .prepare(
          `SELECT 1 FROM child_work c JOIN work w ON w.id=c.child_work_id
           WHERE c.parent_work_id=? AND w.status!='closed' LIMIT 1`,
        )
        .get(row.id)
    )
      throw new RuntimeError('UNSETTLED', 'Active child Work prevents completion');
    withdrawWaits(this.store, row.id);
    if (proposal.type === 'fail') disposeInputs(this.store, row.id, 'failed', proposal.reason);
    const closure: Closure =
      proposal.type === 'complete'
        ? { status: 'completed', result: proposal.result }
        : { status: 'failed', reason: proposal.reason };
    this.store.db
      .prepare(
        "UPDATE work SET basis=?,decisions=decisions+1,status='closed',eligible=0,closure=?,control_token=? WHERE id=?",
      )
      .run(sequence, canonical(closure), entityId('control'), row.id);
    this.store.event(
      row.id,
      'decision.committed',
      { inputBoundary, closure: closure.status },
      sequence,
    );
    this.options.publishClosure(row.id as WorkId, closure);
    this.store.event(row.id, 'work.closed', closure, sequence);
  }
}
