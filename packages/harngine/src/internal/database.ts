import Database from 'better-sqlite3';
import { createRequire } from 'node:module';
import { RuntimeError } from './contracts.js';
import type { StateStoreBackend } from '../state-store.js';

export interface StateStatement {
  run(...parameters: unknown[]): { changes: number; lastInsertRowid: number | bigint };
  get(...parameters: unknown[]): unknown;
  all(...parameters: unknown[]): unknown[];
}

type Transaction<T> = (() => T) & { immediate(): T };

export interface StateDatabase {
  prepare(sql: string): StateStatement;
  exec(sql: string): void;
  pragma(statement: string, options?: { simple?: boolean }): unknown;
  transaction<T>(body: () => T): Transaction<T>;
  close(): void;
}

interface NodeStatement {
  run(...parameters: unknown[]): { changes: number; lastInsertRowid: number | bigint };
  get(...parameters: unknown[]): unknown;
  all(...parameters: unknown[]): unknown[];
}

interface NodeDatabase {
  prepare(sql: string): NodeStatement;
  exec(sql: string): void;
  close(): void;
}

class NodeSqliteDatabase implements StateDatabase {
  constructor(private readonly db: NodeDatabase) {}

  prepare(sql: string): StateStatement {
    return this.db.prepare(sql);
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  pragma(statement: string, options?: { simple?: boolean }): unknown {
    if (statement.includes('=')) {
      this.db.exec(`PRAGMA ${statement}`);
      return undefined;
    }
    const row = this.db.prepare(`PRAGMA ${statement}`).get() as Record<string, unknown> | undefined;
    if (!row) return undefined;
    return options?.simple ? Object.values(row)[0] : row;
  }

  transaction<T>(body: () => T): Transaction<T> {
    const run = (): T => {
      this.db.exec('BEGIN IMMEDIATE');
      try {
        const result = body();
        this.db.exec('COMMIT');
        return result;
      } catch (error) {
        try {
          this.db.exec('ROLLBACK');
        } catch {
          // Preserve the transaction failure rather than a secondary rollback error.
        }
        throw error;
      }
    };
    return Object.assign(run, { immediate: run });
  }

  close(): void {
    this.db.close();
  }
}

const require = createRequire(import.meta.url);

export function openStateDatabase(path: string, backend: StateStoreBackend): StateDatabase {
  if (backend === 'better-sqlite3') return new Database(path) as unknown as StateDatabase;
  try {
    const { DatabaseSync } = require('node:sqlite') as {
      DatabaseSync: new (path: string) => NodeDatabase;
    };
    return new NodeSqliteDatabase(new DatabaseSync(path));
  } catch (error) {
    throw new RuntimeError(
      'STATE_STORE_UNAVAILABLE',
      `The node-sqlite state backend is unavailable: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}
