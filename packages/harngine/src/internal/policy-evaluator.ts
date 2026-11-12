import type { Identity, Json, SessionId, WorkId } from './contracts.js';

export interface RuntimeAccessPolicy {
  readonly revision: string;
  canStart(input: {
    principal: string;
    definition: Identity;
    objective: Json;
  }): boolean | Promise<boolean>;
  canCall(input: {
    principal: string;
    workId: WorkId;
    target: Identity & { readonly kind: 'tool' | 'agent' | 'workflow' };
    /** Compatibility alias retained during the pre-release API transition. */
    tool: Identity;
    input: Json;
  }): boolean | Promise<boolean>;
  canRespond(input: {
    principal: string;
    workId: WorkId;
    interactionId: string;
  }): boolean | Promise<boolean>;
  canHandoff?(input: {
    principal: string;
    sessionId: SessionId;
    fromAgent: Identity;
    toAgent: Identity;
    reason: string | undefined;
  }): boolean | Promise<boolean>;
}

const permissive: RuntimeAccessPolicy = Object.freeze({
  revision: 'legacy-permissive',
  canStart: () => true,
  canCall: () => true,
  canRespond: () => true,
  canHandoff: () => true,
});

/** Resolves application authorization policy independently from execution approval waits. */
export class PolicyEvaluator implements RuntimeAccessPolicy {
  private readonly policy: RuntimeAccessPolicy;

  constructor(policy?: RuntimeAccessPolicy) {
    this.policy = policy ?? permissive;
  }

  get revision(): string {
    return this.policy.revision;
  }

  canStart(input: Parameters<RuntimeAccessPolicy['canStart']>[0]): boolean | Promise<boolean> {
    return this.policy.canStart(input);
  }

  canCall(input: Parameters<RuntimeAccessPolicy['canCall']>[0]): boolean | Promise<boolean> {
    return this.policy.canCall(input);
  }

  canRespond(input: Parameters<RuntimeAccessPolicy['canRespond']>[0]): boolean | Promise<boolean> {
    return this.policy.canRespond(input);
  }

  canHandoff(
    input: Parameters<NonNullable<RuntimeAccessPolicy['canHandoff']>>[0],
  ): boolean | Promise<boolean> {
    return this.policy.canHandoff?.(input) ?? false;
  }
}
