import type { Closure, WorkId } from './contracts.js';
import type { SqliteStore } from './store.js';

/** Owns durable parent/child linkage and wakes parents from committed child closure. */
export class ChildWorkManager {
  constructor(private readonly store: SqliteStore) {}

  publishClosure(childWorkId: WorkId, closure: Closure): void {
    const link = this.store.db
      .prepare(
        `SELECT c.parent_work_id,c.slot,c.control_token,w.status,w.control_token AS current_token
         FROM child_work c JOIN work w ON w.id=c.parent_work_id
         WHERE c.child_work_id=?`,
      )
      .get(childWorkId) as
      | {
          parent_work_id: string;
          slot: string;
          control_token: string;
          status: string;
          current_token: string;
        }
      | undefined;
    if (!link || link.status === 'closed' || link.control_token !== link.current_token) return;
    this.store.event(link.parent_work_id, 'child.closed', {
      childWorkId,
      slot: link.slot,
      closure: closure.status,
    });
    const activeSibling = this.store.db
      .prepare(
        `SELECT 1 FROM child_work c JOIN work w ON w.id=c.child_work_id
         WHERE c.parent_work_id=? AND w.status!='closed' LIMIT 1`,
      )
      .get(link.parent_work_id);
    if (activeSibling) return;
    this.store.db
      .prepare("UPDATE work SET status='active',eligible=1 WHERE id=?")
      .run(link.parent_work_id);
  }
}
