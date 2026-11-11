import type { ContextCandidate, ContextItem, ContextPolicy, ModelContext } from '../model.js';
import type { Json } from '../types.js';
import type { View } from './contracts.js';
import { RuntimeError } from './contracts.js';

type Candidate = ContextCandidate & { readonly group: string };

export interface ContextEngineOptions {
  readonly maxInputTokens: number;
  readonly policy?: ContextPolicy;
  readonly countTokens?: (value: Json) => number;
  readonly accountingId?: string;
}

/** Resolves a provider-neutral, provenance-preserving snapshot for one model turn. */
export class ContextEngine {
  constructor(private readonly options: ContextEngineOptions) {}

  resolve(view: View, base: Json, turn: number): ModelContext {
    const candidates = this.candidates(view);
    const baseTokens = this.tokens(base);
    const available = this.options.maxInputTokens - baseTokens;
    if (available < 0)
      throw new RuntimeError('CONTEXT_LIMIT', 'Agent instructions and contracts exceed context');
    let selected: Candidate[];
    if (this.options.policy) {
      const refs = this.options.policy.select({
        sources: Object.freeze(
          candidates.map(({ group: _group, ...candidate }) => Object.freeze(candidate)),
        ),
        turn,
        inputTokenBudget: available,
      });
      if (!Array.isArray(refs) || new Set(refs).size !== refs.length)
        throw new RuntimeError('INVALID_CONTEXT', 'ContextPolicy must return unique source refs');
      const byRef = new Map(candidates.map((candidate) => [candidate.ref, candidate]));
      selected = refs.map((ref) => {
        const candidate = byRef.get(ref);
        if (!candidate)
          throw new RuntimeError('INVALID_CONTEXT', 'ContextPolicy returned an unknown source ref');
        return candidate;
      });
      if (candidates.some((candidate) => candidate.required && !refs.includes(candidate.ref)))
        throw new RuntimeError('CONTEXT_LIMIT', 'ContextPolicy omitted required Work input');
    } else {
      selected = [...candidates];
      let used = selected.reduce((sum, candidate) => sum + candidate.estimatedTokens, 0);
      const optionalGroups = [
        ...new Set(
          selected.filter((candidate) => !candidate.required).map((candidate) => candidate.group),
        ),
      ];
      while (used > available && optionalGroups.length) {
        const group = optionalGroups.shift()!;
        const removed = selected.filter((candidate) => candidate.group === group);
        selected = selected.filter((candidate) => candidate.group !== group);
        used -= removed.reduce((sum, candidate) => sum + candidate.estimatedTokens, 0);
      }
    }
    const selectedTokens = selected.reduce((sum, candidate) => sum + candidate.estimatedTokens, 0);
    if (selectedTokens > available)
      throw new RuntimeError('CONTEXT_LIMIT', 'Required context exceeds the model input budget');
    return Object.freeze({
      object: 'model_context',
      objective: view.objective,
      items: Object.freeze(selected.map((candidate) => candidate.item)),
      policy: this.options.policy?.id ?? 'harngine.default-context-v1',
      budget: {
        inputTokens: this.options.maxInputTokens,
        estimatedTokens: baseTokens + selectedTokens,
        accounting: this.options.accountingId ?? 'harngine.utf8-estimate-v1',
      },
    });
  }

  private tokens(value: Json | ContextItem): number {
    const counted = this.options.countTokens?.(value as unknown as Json);
    if (counted !== undefined) {
      if (!Number.isSafeInteger(counted) || counted < 0)
        throw new RuntimeError(
          'INVALID_CONTEXT',
          'Model token accounting returned an invalid count',
        );
      return Math.max(1, counted);
    }
    return Math.max(1, Math.ceil(Buffer.byteLength(JSON.stringify(value), 'utf8') / 4));
  }

  private candidates(view: View): Candidate[] {
    const candidates: Candidate[] = view.context.map((content, index) => {
      const item = {
        type: 'reference',
        content,
        source: { type: 'work_context', index },
      } as ContextItem;
      return {
        ref: `session:${index}`,
        item,
        required: false,
        estimatedTokens: this.tokens(item),
        group: `session:${index}`,
      };
    });
    candidates.push(
      ...view.inputs.map((input) => {
        const item = {
          type: 'input',
          content: input.payload,
          source: { type: 'work_input', id: input.id },
        } as ContextItem;
        return {
          ref: `input:${input.id}`,
          item,
          required: true,
          estimatedTokens: this.tokens(item),
          group: `input:${input.id}`,
        };
      }),
    );
    for (const call of Object.values(view.calls).sort((a, b) => a.slot.localeCompare(b.slot))) {
      const turn = call.slot.split(':')[1] ?? call.slot;
      if (call.slot.startsWith('model:') && call.outcome?.status === 'success') {
        const item = {
          type: 'output',
          content: call.outcome.value,
          source: { type: 'work_call', id: call.id },
        } as ContextItem;
        candidates.push({
          ref: `call:${call.id}`,
          item,
          required: false,
          estimatedTokens: this.tokens(item),
          group: `turn:${turn}`,
        });
      } else if (call.slot.startsWith('tool:') && call.outcome) {
        const item = {
          type: 'tool_outcome',
          call: {
            id: call.id,
            slot: call.slot,
            tool: call.tool as { id: string; version: string } & Json,
            input: call.input,
          },
          outcome: call.outcome,
          source: { type: 'work_call', id: call.id },
        } as ContextItem;
        candidates.push({
          ref: `call:${call.id}`,
          item,
          required: false,
          estimatedTokens: this.tokens(item),
          group: `turn:${turn}`,
        });
      }
    }
    return candidates;
  }
}
