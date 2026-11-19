import type { Json } from './types.js';

export type EffectResolution =
  | { readonly status: 'success'; readonly value: Json }
  | {
      readonly status: 'failure';
      readonly effect: 'partial' | 'occurred';
      readonly reason: { readonly code: string; readonly message: string };
    }
  | {
      readonly status: 'not-applied';
      readonly reason: { readonly code: string; readonly message: string };
    };
