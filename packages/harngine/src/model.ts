import type { Json } from './types.js';
import type { ArtifactReference } from './artifact.js';

export type ModelItem =
  | { readonly type: 'text'; readonly text: string }
  | {
      readonly type: 'tool-call';
      readonly providerCallId: string;
      readonly tool: string;
      readonly input: Json;
    }
  | { readonly type: 'data'; readonly value: Json };

export type ModelFinishReason = 'stop' | 'tool-calls' | 'length' | 'content-filter' | 'other';

export interface ModelCapabilities {
  readonly tools: boolean;
  readonly structuredOutput: boolean;
  readonly streaming: boolean;
  readonly contextWindow?: number;
  readonly defaultOutputReserve?: number;
}

export type ContextSource =
  | { readonly type: 'work_context'; readonly index: number }
  | { readonly type: 'work_input'; readonly id: string }
  | { readonly type: 'work_call'; readonly id: string }
  | { readonly type: 'work_child'; readonly id: string }
  | { readonly type: 'reply'; readonly waitId: string };

export type ContextItem =
  | {
      readonly type: 'input' | 'result' | 'output' | 'reference';
      readonly content: Json;
      readonly source: ContextSource;
    }
  | {
      readonly type: 'tool_outcome';
      readonly call: {
        readonly id: string;
        readonly slot: string;
        readonly tool: { readonly id: string; readonly version: string };
        readonly input: Json;
      };
      readonly outcome:
        | { readonly status: 'success'; readonly value: Json }
        | {
            readonly status: 'failure';
            readonly effect: 'none' | 'partial' | 'occurred';
            readonly reason: { readonly code: string; readonly message: string };
          }
        | {
            readonly status: 'unknown';
            readonly reason: { readonly code: string; readonly message: string };
          };
      readonly source: ContextSource;
    }
  | {
      readonly type: 'reply';
      readonly question: string;
      readonly content: Json;
      readonly source: ContextSource;
    }
  | {
      readonly type: 'child_outcome';
      readonly call: {
        readonly id: string;
        readonly slot: string;
        readonly target: {
          readonly kind: 'agent' | 'workflow';
          readonly id: string;
          readonly version: string;
        };
        readonly objective: Json;
        readonly mode: 'sequential' | 'concurrent';
      };
      readonly closure:
        | { readonly status: 'completed'; readonly result: Json }
        | {
            readonly status: 'failed' | 'canceled';
            readonly reason: { readonly code: string; readonly message: string };
          };
      readonly source: ContextSource;
    }
  | {
      readonly type: 'summary';
      readonly content: Json;
      readonly sources: readonly ContextSource[];
    };

export interface ModelContext {
  readonly object: 'model_context';
  readonly objective: Json;
  readonly items: readonly ContextItem[];
  /** Deduplicated references embedded in the selected objective and Context Items. */
  readonly artifacts: readonly ArtifactReference[];
  readonly policy: string;
  readonly budget: {
    readonly inputTokens: number;
    readonly estimatedTokens: number;
    readonly accounting?: string;
  };
}

export interface ContextCandidate {
  readonly ref: string;
  readonly item: ContextItem;
  readonly required: boolean;
  readonly estimatedTokens: number;
}

export interface ContextPolicy {
  readonly id: string;
  select(input: {
    readonly sources: readonly ContextCandidate[];
    readonly turn: number;
    readonly inputTokenBudget: number;
  }): readonly string[];
}

export interface ContextConfiguration {
  readonly session?: { readonly recent: number } | false;
  readonly reserveForOutput?: number;
  readonly maxInputTokens?: number;
  readonly policy?: ContextPolicy;
}

export interface ModelRequest {
  readonly object: 'model_request';
  readonly instructions: readonly string[];
  readonly context: ModelContext;
  readonly tools: readonly {
    readonly id: string;
    readonly kind: 'tool' | 'agent' | 'workflow';
    readonly description: string;
    readonly inputSchema: Json;
    readonly outputSchema: Json;
  }[];
  readonly result?: Json;
}

export interface ModelResponse {
  readonly object: 'model_response';
  readonly items: readonly ModelItem[];
  readonly finishReason: ModelFinishReason;
  readonly usage?: ModelUsage;
  readonly provider?: { readonly name: string; readonly model: string };
}

export interface ModelUsage {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly totalTokens?: number;
  readonly cost?: { readonly amountMicros: number; readonly currency: string };
}

export interface ModelProgress {
  readonly type: 'started' | 'reasoning' | 'completed';
  readonly text?: string;
  readonly usage?: ModelUsage;
}

export interface ModelAdapter {
  readonly id: string;
  readonly capabilities: ModelCapabilities;
  /** Optional provider/model-aware accounting used for Context selection. */
  readonly tokenizer?: { readonly id: string; readonly count: (value: Json) => number };
  generate(
    request: ModelRequest,
    options: {
      /** Aborted when Work is canceled or the App closes; stop provider work promptly. */
      readonly signal: AbortSignal;
      readonly emit: (item: ModelItem) => void;
      readonly progress?: (event: ModelProgress) => void;
    },
  ): Promise<ModelResponse>;
}
