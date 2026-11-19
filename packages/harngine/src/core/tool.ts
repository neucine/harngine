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
