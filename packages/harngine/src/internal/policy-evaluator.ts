import type { Identity, Json, WorkId } from './contracts.js';

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
    tool: Identity;
    input: Json;
  }): boolean | Promise<boolean>;
  canRespond(input: {
    principal: string;
    workId: WorkId;
    interactionId: string;
  }): boolean | Promise<boolean>;
}

const permissive: RuntimeAccessPolicy = Object.freeze({
  revision: 'legacy-permissive',
  canStart: () => true,
  canCall: () => true,
  canRespond: () => true,
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
}
