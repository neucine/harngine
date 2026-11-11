import { canonical, frozen } from '../schema.js';
import type {
  CancelRequest,
  Closure,
  ControlAcceptance,
  Json,
  Receipt,
  ReviseRequest,
  WorkId,
  WorkRef,
} from './contracts.js';
import { RuntimeError } from './contracts.js';
import { controlWork } from './control.js';
import type { DefinitionRegistry } from './definition-registry.js';
import type { OperationExecutor } from './operation-executor.js';
import type { SqliteStore } from './store.js';

export interface ControlServiceOptions {
  readonly store: SqliteStore;
  readonly registry: DefinitionRegistry;
  readonly operations: OperationExecutor;
  readonly checkpoint: () => void;
  readonly wake: () => void;
  readonly publishClosure: (workId: WorkId, closure: Closure) => void;
}

/** Owns cancellation, objective revision, fencing, and best-effort invocation aborts. */
export class ControlService {
  constructor(private readonly options: ControlServiceOptions) {}

  async apply<O extends Json, R extends Json>(
    caller: { readonly principal: string; readonly source: string },
    work: WorkRef<O, R>,
    kind: 'cancel' | 'revise',
    request: CancelRequest | ReviseRequest<O>,
  ): Promise<Receipt<ControlAcceptance>> {
    const row = this.options.store.work(work.id);
    if (row.principal !== caller.principal)
      throw new RuntimeError('ACCESS_DENIED', 'Work belongs to another principal');
    if (row.definition !== canonical(work.definition))
      throw new RuntimeError('CONTRACT_MISMATCH', 'Work definition does not match reference');
    const descendants =
      kind === 'cancel'
        ? (this.options.store.db
            .prepare(
              `WITH RECURSIVE descendants(id) AS (
                 SELECT child_work_id FROM child_work WHERE parent_work_id=?
                 UNION ALL
                 SELECT c.child_work_id FROM child_work c JOIN descendants d ON c.parent_work_id=d.id
               ) SELECT id FROM descendants`,
            )
            .all(work.id) as { id: string }[])
        : [];
    const result = controlWork(
      this.options.store,
      caller,
      work,
      kind,
      request,
      this.options.registry.workflow(JSON.parse(row.definition)),
      this.options.publishClosure,
    );
    if (result.changed) {
      this.options.checkpoint();
      // A transport abort is best effort, never evidence that the remote action did not happen.
      this.options.operations.abort(work.id);
      for (const child of descendants) this.options.operations.abort(child.id as WorkId);
    }
    this.options.wake();
    return frozen(result.receipt);
  }
}
