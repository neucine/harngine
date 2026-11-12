export type StateStoreBackend = 'better-sqlite3' | 'node-sqlite';

export interface StateStoreConfiguration {
  /** Synchronous SQLite implementation used for durable runtime state. */
  readonly backend?: StateStoreBackend;
}

/**
 * Guarantees every Harngine state backend provides to the runtime.
 *
 * Applications can depend on these semantics while the concrete SQLite driver remains replaceable.
 */
export interface StateStoreContract {
  readonly engine: 'sqlite';
  readonly backend: StateStoreBackend;
  readonly durability: 'full';
  readonly transactions: 'atomic';
  readonly ownership: 'exclusive';
  readonly ownershipFencing: true;
  readonly idempotentReceipts: true;
  readonly inspectableHistory: true;
  readonly schemaVersion: number;
}
