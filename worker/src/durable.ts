// Durable Object that owns the pool database. One instance ("global") gives
// the small deployment exactly what the Node server has: serialized writes,
// atomic rotation and no external database to provision. Free-plan DOs are
// SQLite-backed only, which is all this adapter needs.

import { DurableObject } from "cloudflare:workers";
import { handleRequest } from "./app.js";
import type { DbEnv, Env } from "./env.js";

type SqlValue = string | number | null | ArrayBuffer;
type Row = Record<string, SqlValue>;

function normalize(v: unknown): SqlValue {
  if (v === undefined) return null;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (v === null || typeof v === "string" || typeof v === "number" || v instanceof ArrayBuffer) return v;
  return String(v);
}

function d1Meta(rowsRead: number, rowsWritten: number) {
  return {
    duration: 0,
    size_after: 0,
    rows_read: rowsRead,
    rows_written: rowsWritten,
    last_row_id: 0,
    changed_db: rowsWritten > 0,
    changes: rowsWritten,
  };
}

/**
 * Minimal synchronous D1-shaped facade over Durable Object SQLite storage.
 * The data layer (worker/src/db.ts) is written against D1's async API; the
 * only difference here is that queries resolve immediately. `await` handles
 * both, so the exact same SQL and rotation code runs inside the DO.
 */
class SqlStatement {
  constructor(
    private readonly storage: DurableObjectStorage,
    readonly sql: string,
    readonly binds: SqlValue[] = []
  ) {}

  bind(...values: unknown[]): SqlStatement {
    return new SqlStatement(this.storage, this.sql, values.map(normalize));
  }

  private exec(): ReturnType<SqlStorage["exec"]> {
    return this.storage.sql.exec(this.sql, ...this.binds);
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    const rows = this.exec().toArray();
    return (rows[0] ?? null) as T | null;
  }

  async all<T = Record<string, unknown>>() {
    const cursor = this.exec();
    return {
      results: cursor.toArray() as T[],
      success: true as const,
      meta: d1Meta(cursor.rowsRead, cursor.rowsWritten),
    };
  }

  async run<T = Record<string, unknown>>() {
    return this.runSync<T>();
  }

  /** Synchronous variant required by transactionSync(). */
  runSync<T = Record<string, unknown>>() {
    const cursor = this.exec();
    return {
      results: cursor.toArray() as T[],
      success: true as const,
      meta: d1Meta(cursor.rowsRead, cursor.rowsWritten),
    };
  }
}

class SqlD1 {
  constructor(private readonly storage: DurableObjectStorage) {}

  prepare(sql: string): SqlStatement {
    return new SqlStatement(this.storage, sql);
  }

  /** D1 batch semantics: all statements run in one transaction. */
  async batch<T = Record<string, unknown>>(statements: SqlStatement[]) {
    return this.storage.transactionSync(() => statements.map((s) => s.runSync<T>()));
  }

  async exec(sql: string): Promise<void> {
    this.storage.sql.exec(sql).toArray();
  }
}

export class PoolDB extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    const db = new SqlD1(this.ctx.storage);
    const env: DbEnv = { ...this.env, DB: db as unknown as D1Database };
    return handleRequest(request, env);
  }
}
