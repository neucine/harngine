import { agentCompilation, type Agent as PublicAgent } from '../agent.js';
import { assertSchema, frozen, identity, key } from '../schema.js';
import { toolIdentity, toolInternals, type Tool as PublicTool } from '../tool.js';
import { workflowInternals, type Workflow as PublicWorkflow } from '../workflow.js';
import { agentInternals } from './agent.js';
import {
  RuntimeError,
  type Agent,
  type AnyAgent,
  type AnyTool,
  type AnyWorkflow,
  type Identity,
  type Json,
} from './contracts.js';
import type { SqliteStore } from './store.js';

export interface DefinitionRegistryOptions {
  readonly definitions?: readonly (AnyWorkflow | PublicWorkflow<any, any>)[];
  readonly agents?: readonly (AnyAgent | PublicAgent<any, any>)[];
  readonly tools?: readonly (AnyTool | PublicTool<any, any>)[];
}

export interface DefinitionRecord {
  readonly kind: 'agent' | 'workflow' | 'tool';
  readonly id: string;
  readonly version: string;
  readonly manifest: Json;
  readonly available: boolean;
}

export function registeredIdentity(value: object): Identity {
  const agent = agentCompilation(value);
  if (agent) return identity(agent.workflow);
  const workflow = workflowInternals(value);
  if (workflow) return identity(workflow.workflow);
  const tool = toolInternals(value);
  if (tool) return identity(tool.tool);
  return identity(value as Identity);
}

/** Owns immutable executable revisions and their durable manifests. */
export class DefinitionRegistry {
  private readonly workflows = new Map<string, AnyWorkflow>();
  private readonly registrations = new Map<
    string,
    AnyWorkflow | AnyAgent | PublicWorkflow<any, any> | PublicAgent<any, any>
  >();
  private readonly agents = new Map<string, AnyAgent | PublicAgent<any, any>>();
  private readonly toolRevisions = new Map<string, AnyTool>();

  constructor(
    private readonly store: SqliteStore,
    options: DefinitionRegistryOptions,
  ) {
    const records: { kind: string; id: string; version: string; manifest: unknown }[] = [];
    const addSchema = (contract: AnyWorkflow['objective']) => {
      assertSchema(contract);
      records.push({ kind: 'schema', ...identity(contract), manifest: contract });
    };
    const allTools = [...(options.tools ?? [])];
    for (const value of options.definitions ?? []) {
      const internal = workflowInternals(value);
      if (internal) allTools.push(...internal.tools);
    }
    for (const value of options.agents ?? []) {
      const internal = agentCompilation(value) ?? agentInternals(value);
      if (!internal)
        throw new RuntimeError(
          'INVALID_DEFINITION',
          'Use agent() to create an immutable registration',
        );
      allTools.push(...internal.tools);
    }
    for (const registeredTool of allTools) {
      if (!Object.isFrozen(registeredTool))
        throw new RuntimeError(
          'INVALID_DEFINITION',
          'Use tool() to create an immutable registration',
        );
      const executable = (toolInternals(registeredTool)?.tool ?? registeredTool) as AnyTool;
      const registration = registeredIdentity(registeredTool);
      const existing = this.toolRevisions.get(key(registration));
      if (existing) {
        if (existing !== executable)
          throw new RuntimeError('REGISTRATION_CONFLICT', 'Duplicate tool');
        continue;
      }
      this.toolRevisions.set(key(registration), executable);
      addSchema(executable.input);
      addSchema(executable.output);
      records.push({
        kind: 'tool',
        ...registration,
        manifest: {
          ...registration,
          artifactDigest: executable.artifactDigest,
          ...(executable.description === undefined ? {} : { description: executable.description }),
          input: executable.input,
          output: executable.output,
          effect: executable.effect,
          capabilities:
            executable.capabilities ??
            (executable.effect === 'read'
              ? { effect: 'read', invocation: 'repeatable' }
              : {
                  effect: 'write',
                  idempotency: 'none',
                  reconciliation: executable.reconcile ? 'automatic' : 'manual',
                  reversibility: 'unknown',
                }),
          reconcilable: Boolean(executable.reconcile),
          ...(executable.retry ? { retry: executable.retry } : {}),
          ...(executable.approval ? { approval: executable.approval } : {}),
          ...(executable.guardrails?.length
            ? {
                guardrails: executable.guardrails.map((item) => ({
                  id: item.id,
                  revision: item.revision,
                  stages: item.stages,
                })),
              }
            : {}),
        },
      });
    }
    for (const registration of options.definitions ?? []) {
      if (!Object.isFrozen(registration))
        throw new RuntimeError(
          'INVALID_DEFINITION',
          'Use workflow() to create an immutable registration',
        );
      const definition = (workflowInternals(registration)?.workflow ?? registration) as AnyWorkflow;
      const registrationIdentity = registeredIdentity(registration);
      if (this.workflows.has(key(registrationIdentity)))
        throw new RuntimeError('REGISTRATION_CONFLICT', 'Duplicate Workflow');
      this.workflows.set(key(registrationIdentity), definition);
      this.registrations.set(key(registrationIdentity), registration);
    }
    for (const value of options.agents ?? []) {
      const internal = agentCompilation(value) ?? agentInternals(value)!;
      const registrationIdentity = registeredIdentity(value);
      if (this.workflows.has(key(registrationIdentity)))
        throw new RuntimeError('REGISTRATION_CONFLICT', 'Duplicate Agent or Workflow');
      this.workflows.set(key(registrationIdentity), internal.workflow);
      this.registrations.set(key(registrationIdentity), value);
      this.agents.set(key(registrationIdentity), value);
    }
    for (const registration of options.definitions ?? []) {
      const definition = (workflowInternals(registration)?.workflow ?? registration) as AnyWorkflow;
      const registrationIdentity = registeredIdentity(registration);
      for (const reference of definition.tools)
        if (!this.toolRevisions.has(key(reference)))
          throw new RuntimeError('UNAVAILABLE', 'Workflow tool is missing');
      for (const reference of definition.children ?? [])
        if (!this.workflows.has(key(reference)))
          throw new RuntimeError('UNAVAILABLE', 'Child Workflow is missing');
      this.addWorkflowSchemas(definition, addSchema);
      records.push({
        kind: 'workflow',
        ...registrationIdentity,
        manifest: {
          ...registrationIdentity,
          artifactDigest: definition.artifactDigest,
          objective: definition.objective,
          state: definition.state,
          result: definition.result,
          policy: definition.policy,
          tools: definition.tools,
          ...(definition.children
            ? {
                children: definition.children.map((child) => ({
                  id: child.id,
                  version: child.version,
                  kind: this.agents.has(key(child)) ? 'agent' : 'workflow',
                })),
              }
            : {}),
          ...(definition.input ? { input: definition.input } : {}),
          ...(definition.replySchemas ? { replySchemas: definition.replySchemas } : {}),
        },
      });
    }
    for (const value of options.agents ?? []) {
      const publicInternal = agentCompilation(value);
      const internal = publicInternal ?? agentInternals(value)!;
      const definition = internal.workflow;
      const registrationIdentity = registeredIdentity(value);
      for (const reference of definition.tools)
        if (!this.toolRevisions.has(key(reference)))
          throw new RuntimeError('UNAVAILABLE', 'Agent tool is missing');
      for (const reference of definition.children ?? [])
        if (!this.workflows.has(key(reference)))
          throw new RuntimeError('UNAVAILABLE', 'Agent delegate is missing');
      this.addWorkflowSchemas(definition, addSchema);
      records.push({
        kind: 'agent',
        ...registrationIdentity,
        manifest: {
          ...registrationIdentity,
          artifactDigest: definition.artifactDigest,
          instructions: value.instructions,
          objective: value.objective,
          result: value.result,
          policy: definition.policy,
          ...('context' in value
            ? {
                context: publicInternal
                  ? {
                      session: (value as PublicAgent<any, any>).context.session,
                      reserveForOutput: (value as PublicAgent<any, any>).context.reserveForOutput,
                      maxInputTokens: (value as PublicAgent<any, any>).context.maxInputTokens,
                      policy: (value as PublicAgent<any, any>).context.policy?.id ?? null,
                    }
                  : (value as Agent).context,
              }
            : {}),
          model: publicInternal
            ? {
                id: (value as PublicAgent<any, any>).model.id,
                capabilities: (value as PublicAgent<any, any>).model.capabilities,
              }
            : identity(value.model as Agent['model']),
          ...('modelResponse' in value ? { modelResponse: value.modelResponse } : {}),
          tools: value.tools.map(toolIdentity),
          guardrails: ('guardrails' in value ? value.guardrails : []).map((item) => ({
            id: item.id,
            revision: item.revision,
            stages: item.stages,
          })),
          ...(definition.children
            ? {
                delegates: definition.children.map((child) => ({
                  id: child.id,
                  version: child.version,
                  kind: this.agents.has(key(child)) ? 'agent' : 'workflow',
                })),
              }
            : {}),
          ...('input' in value && value.input ? { input: value.input } : {}),
          ...('reply' in value && value.reply ? { reply: value.reply } : {}),
        },
      });
    }
    this.store.register(records);
  }

  get tools(): ReadonlyMap<string, AnyTool> {
    return this.toolRevisions;
  }

  workflow(reference: Identity): AnyWorkflow | undefined {
    return this.workflows.get(key(reference));
  }

  tool(reference: Identity): AnyTool | undefined {
    return this.toolRevisions.get(key(reference));
  }

  agent(reference: Identity): AnyAgent | PublicAgent<any, any> | undefined {
    return this.agents.get(key(reference));
  }

  registration(
    reference: Identity,
  ): AnyWorkflow | AnyAgent | PublicWorkflow<any, any> | PublicAgent<any, any> | undefined {
    return this.registrations.get(key(reference));
  }

  isRegistration(reference: Identity, value: object): boolean {
    return this.registrations.get(key(reference)) === value;
  }

  isAgent(value: object): boolean {
    return this.agents.get(key(registeredIdentity(value))) === value;
  }

  records(): readonly DefinitionRecord[] {
    const rows = this.store.db
      .prepare(
        "SELECT kind,id,version,manifest FROM definitions WHERE kind IN ('agent','workflow','tool') ORDER BY kind,id,version",
      )
      .all() as {
      kind: DefinitionRecord['kind'];
      id: string;
      version: string;
      manifest: string;
    }[];
    return frozen(
      rows.map((row) => {
        const registrationKey = key({ id: row.id, version: row.version });
        const available =
          row.kind === 'agent'
            ? this.agents.has(registrationKey)
            : row.kind === 'workflow'
              ? this.registrations.has(registrationKey) && !this.agents.has(registrationKey)
              : this.toolRevisions.has(registrationKey);
        return {
          kind: row.kind,
          id: row.id,
          version: row.version,
          manifest: JSON.parse(row.manifest),
          available,
        };
      }),
    );
  }

  executable(reference: {
    kind: 'agent' | 'workflow';
    id: string;
    revision: string;
  }): PublicAgent<any, any> | PublicWorkflow<any, any> | undefined {
    const registrationKey = key({ id: reference.id, version: reference.revision });
    if (reference.kind === 'agent')
      return this.agents.get(registrationKey) as PublicAgent<any, any> | undefined;
    if (this.agents.has(registrationKey)) return undefined;
    return this.registrations.get(registrationKey) as PublicWorkflow<any, any> | undefined;
  }

  private addWorkflowSchemas(
    definition: AnyWorkflow,
    addSchema: (contract: AnyWorkflow['objective']) => void,
  ): void {
    addSchema(definition.objective);
    addSchema(definition.state);
    addSchema(definition.result);
    if (definition.input) addSchema(definition.input.schema);
    for (const contract of definition.replySchemas ?? []) addSchema(contract);
  }
}
