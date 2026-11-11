/** A value that can cross Harngine's durable and provider-neutral boundaries. */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export type WorkId = `work_${string}`;
export type SessionId = `session_${string}`;

/** A named JSON Schema contract with its inferred TypeScript value type. */
export interface Schema<T extends Json = Json> {
  readonly id: string;
  readonly version: string;
  readonly jsonSchema: Json;
  readonly __type?: T;
}
