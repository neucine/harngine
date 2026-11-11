import type { Tool as CoreTool } from './internal/contracts.js';
import { RuntimeError } from './internal/contracts.js';
import type { Json, Schema } from './types.js';
import { frozen, identity, tool as coreTool } from './schema.js';
import { definitionRevision } from './build/manifest.js';

export interface ToolContext {
  readonly signal: AbortSignal;
  readonly idempotencyKey: string;
  fail(error: { effect: 'none' | 'partial' | 'occurred'; code: string; message: string }): never;
  effectUnknown(error: { code: string; message: string }): never;
}

export interface ToolReconciliationContext {
  readonly signal: AbortSignal;
  readonly idempotencyKey: string;
  readonly attemptId: string;
}

export type ToolReconciliationResult<O extends Json> =
  | { readonly status: 'success'; readonly value: O }
  | {
      readonly status: 'failure';
      readonly effect: 'partial' | 'occurred';
      readonly reason: { readonly code: string; readonly message: string };
    }
  | {
      readonly status: 'not-applied' | 'unknown';
      readonly reason: { readonly code: string; readonly message: string };
    };

export interface ApprovalPolicy {
  readonly approvers: readonly string[];
  readonly timeoutMs: number;
}

export interface WriteToolCapabilities {
  /** The Tool promises how repeated calls carrying the same operation key behave. */
  readonly idempotency: 'none' | 'operation-key' | 'intrinsic';
  /** Whether an applied write can be reversed outside Harngine. */
  readonly reversibility: 'unknown' | 'reversible' | 'irreversible';
}

export type ToolCapabilities =
  | { readonly effect: 'read'; readonly invocation: 'repeatable' }
  | (WriteToolCapabilities & {
      readonly effect: 'write';
      readonly reconciliation: 'manual' | 'automatic';
    });

export interface ToolDefinition<I extends Json, O extends Json> {
  readonly id: string;
  readonly description?: string;
  readonly input: Schema<I>;
  readonly output: Schema<O>;
  readonly effect: 'read' | 'write';
  /** Explicit write-safety promises. Omission is treated conservatively. */
  readonly capabilities?: WriteToolCapabilities;
  readonly approval?: ApprovalPolicy;
  readonly retry?: { readonly maxAttempts: number };
  readonly execute: (input: I, context: ToolContext) => O | Promise<O>;
  /** Read-only lookup used to determine the outcome of an uncertain write. */
  readonly reconcile?: (
    input: I,
    context: ToolReconciliationContext,
  ) => ToolReconciliationResult<O> | Promise<ToolReconciliationResult<O>>;
}

export interface Tool<I extends Json = Json, O extends Json = Json> {
  readonly id: string;
  readonly revision: `rev_${string}`;
  readonly description?: string;
  readonly input: Schema<I>;
  readonly output: Schema<O>;
  readonly effect: 'read' | 'write';
  readonly capabilities: ToolCapabilities;
  readonly approval?: ApprovalPolicy;
  readonly retry: { readonly maxAttempts: number };
  readonly execute: (input: I, context: ToolContext) => O | Promise<O>;
  readonly reconcile?: (
    input: I,
    context: ToolReconciliationContext,
  ) => ToolReconciliationResult<O> | Promise<ToolReconciliationResult<O>>;
  readonly __input?: I;
  readonly __output?: O;
}

type Internals = { tool: CoreTool<any, any> };
const internalDefinitions = new WeakMap<object, Internals>();

class KnownToolFailure extends Error {
  constructor(
    readonly effect: 'none' | 'partial' | 'occurred',
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

class UnknownToolEffect extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function tool<I extends Json, O extends Json>(definition: ToolDefinition<I, O>): Tool<I, O>;
export function tool<I extends Json, O extends Json>(definition: ToolDefinition<I, O>): Tool<I, O> {
  if (
    Object.keys(definition).some(
      (name) =>
        ![
          'id',
          'description',
          'input',
          'output',
          'effect',
          'capabilities',
          'approval',
          'retry',
          'execute',
          'reconcile',
        ].includes(name),
    )
  )
    throw new RuntimeError('UNSUPPORTED', 'Unsupported Tool configuration');
  if (!definition.id || definition.id.length > 256)
    throw new RuntimeError('INVALID_DEFINITION', 'Tool id must contain 1–256 characters');
  const retry = definition.retry ?? { maxAttempts: 1 };
  if (!Number.isSafeInteger(retry.maxAttempts) || retry.maxAttempts < 1)
    throw new RuntimeError('INVALID_POLICY', 'Tool retry maxAttempts must be a positive integer');
  if (definition.reconcile && definition.effect !== 'write')
    throw new RuntimeError('INVALID_DEFINITION', 'Only write Tools can reconcile effects');
  if (definition.capabilities && definition.effect !== 'write')
    throw new RuntimeError('INVALID_DEFINITION', 'Only write Tools declare write capabilities');
  if (
    definition.capabilities &&
    (!['none', 'operation-key', 'intrinsic'].includes(definition.capabilities.idempotency) ||
      !['unknown', 'reversible', 'irreversible'].includes(definition.capabilities.reversibility))
  )
    throw new RuntimeError('INVALID_DEFINITION', 'Invalid write Tool capabilities');
  const capabilities: ToolCapabilities =
    definition.effect === 'read'
      ? { effect: 'read', invocation: 'repeatable' }
      : {
          effect: 'write',
          idempotency: definition.capabilities?.idempotency ?? 'none',
          reconciliation: definition.reconcile ? 'automatic' : 'manual',
          reversibility: definition.capabilities?.reversibility ?? 'unknown',
        };
  const revision = definitionRevision('tool', definition.id, {
    id: definition.id,
    description: definition.description ?? null,
    input: definition.input,
    output: definition.output,
    effect: definition.effect,
    capabilities,
    approval: definition.approval ?? null,
    retry,
    reconcilable: Boolean(definition.reconcile),
  });
  const artifactDigest = revision.slice(4);
  const result: Tool<I, O> = Object.freeze({
    id: definition.id,
    revision,
    ...(definition.description === undefined ? {} : { description: definition.description }),
    input: definition.input,
    output: definition.output,
    effect: definition.effect,
    capabilities: frozen(capabilities),
    ...(definition.approval === undefined ? {} : { approval: frozen(definition.approval) }),
    retry: frozen(retry),
    execute: definition.execute,
    ...(definition.reconcile === undefined ? {} : { reconcile: definition.reconcile }),
  });
  const compiled = coreTool<I, O>({
    id: result.id,
    version: revision,
    artifactDigest,
    ...(result.description === undefined ? {} : { description: result.description }),
    input: result.input,
    output: result.output,
    effect: result.effect,
    capabilities: result.capabilities,
    retry: result.retry,
    unknownEffect: 'wait',
    ...(result.approval === undefined ? {} : { approval: result.approval }),
    ...(result.reconcile
      ? {
          async reconcile(call) {
            return result.reconcile!(call.input, {
              signal: call.signal,
              idempotencyKey: call.operationId,
              attemptId: call.attemptId,
            });
          },
        }
      : {}),
    async invoke(call) {
      const context: ToolContext = Object.freeze({
        signal: call.signal,
        idempotencyKey: call.operationId,
        fail(error: {
          effect: 'none' | 'partial' | 'occurred';
          code: string;
          message: string;
        }): never {
          throw new KnownToolFailure(error.effect, error.code, error.message);
        },
        effectUnknown(error: { code: string; message: string }): never {
          throw new UnknownToolEffect(error.code, error.message);
        },
      });
      try {
        return { status: 'success', value: await result.execute(call.input, context) };
      } catch (error) {
        if (error instanceof KnownToolFailure)
          return {
            status: 'failure',
            effect: error.effect,
            reason: { code: error.code, message: error.message },
          };
        if (error instanceof UnknownToolEffect)
          return { status: 'unknown', reason: { code: error.code, message: error.message } };
        if (result.effect === 'read')
          return {
            status: 'failure',
            effect: 'none',
            reason: {
              code: 'TOOL_FAILED',
              message: error instanceof Error ? error.message : 'Tool execution failed',
            },
          };
        return {
          status: 'unknown',
          reason: {
            code: 'TOOL_EFFECT_UNKNOWN',
            message: error instanceof Error ? error.message : 'Tool effect is unknown',
          },
        };
      }
    },
  });
  internalDefinitions.set(result, { tool: compiled });
  return result;
}

export function toolInternals(value: unknown): Internals | undefined {
  return value && typeof value === 'object' ? internalDefinitions.get(value) : undefined;
}

export function toolIdentity(value: object): { id: string; version: string } {
  const internal = toolInternals(value);
  return internal ? identity(internal.tool) : identity(value as CoreTool);
}
