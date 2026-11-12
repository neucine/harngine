import type {
  AnyTool,
  AnyWorkflow,
  ChildWorkRecord,
  Identity,
  Outcome,
  Proposal,
  Reason,
  InputRecord,
  ReconciliationResult,
  WaitPlan,
} from './contracts.js';
import { RuntimeError } from './contracts.js';
import { canonical, copy, key, resolveSchema, validate } from '../schema.js';
export function reason(error: unknown): Reason {
  return {
    code: error instanceof RuntimeError ? error.code : 'BEHAVIOR_ERROR',
    message: error instanceof Error ? error.message : String(error),
  };
}
export function checkedProposal(
  definition: AnyWorkflow,
  raw: unknown,
  tools: ReadonlyMap<string, AnyTool>,
  workflow: (reference: Identity) => AnyWorkflow | undefined,
  inputs: readonly InputRecord[] = [],
  hasMoreInputs = false,
  children: Readonly<Record<string, ChildWorkRecord>> = {},
): Proposal {
  const proposal = copy(raw) as Proposal;
  if (!proposal || typeof proposal !== 'object')
    throw new RuntimeError('INVALID_PROPOSAL', 'Expected a proposal');
  if (proposal.type === 'complete') {
    exact(proposal, ['type', 'result', 'dispositions']);
    validate(definition.result, proposal.result);
  } else if (proposal.type === 'fail') {
    exact(proposal, ['type', 'reason', 'dispositions']);
    checkReason(proposal.reason);
  } else if (proposal.type === 'call') {
    exact(proposal, ['type', 'state', 'call', 'dispositions']);
    exact(proposal.call, ['slot', 'tool', 'input']);
    validate(definition.state, proposal.state);
    if (!proposal.call.slot || typeof proposal.call.slot !== 'string')
      throw new RuntimeError('INVALID_PROPOSAL', 'A request slot is required');
    const target = key(proposal.call.tool);
    if (!definition.tools.some((ref) => key(ref) === target))
      throw new RuntimeError('TOOL_DENIED', 'Tool is not permitted');
    const tool = tools.get(target);
    if (!tool) throw new RuntimeError('UNAVAILABLE', 'Pinned tool is missing');
    validate(tool.input, proposal.call.input);
  } else if (proposal.type === 'child') {
    exact(proposal, ['type', 'state', 'child', 'dispositions']);
    exact(proposal.child, ['slot', 'definition', 'objective', 'mode']);
    validate(definition.state, proposal.state);
    if (!proposal.child.slot || typeof proposal.child.slot !== 'string')
      throw new RuntimeError('INVALID_PROPOSAL', 'A child Work slot is required');
    const target = key(proposal.child.definition);
    if (!definition.children?.some((ref) => key(ref) === target))
      throw new RuntimeError('CHILD_DENIED', 'Child Workflow is not permitted');
    const child = workflow(proposal.child.definition);
    if (!child) throw new RuntimeError('UNAVAILABLE', 'Pinned child Workflow is missing');
    validate(child.objective, proposal.child.objective);
    if (
      proposal.child.mode !== undefined &&
      !['sequential', 'concurrent'].includes(proposal.child.mode)
    )
      throw new RuntimeError('INVALID_PROPOSAL', 'Unsupported child Work mode');
  } else if (proposal.type === 'children') {
    exact(proposal, ['type', 'state', 'children', 'dispositions']);
    validate(definition.state, proposal.state);
    if (
      !Array.isArray(proposal.children) ||
      !proposal.children.length ||
      proposal.children.length > 100
    )
      throw new RuntimeError('INVALID_PROPOSAL', 'A child batch requires 1–100 entries');
    const slots = new Set<string>();
    for (const planned of proposal.children) {
      exact(planned, ['slot', 'definition', 'objective', 'mode']);
      if (!planned.slot || typeof planned.slot !== 'string' || !slots.add(planned.slot))
        throw new RuntimeError('INVALID_PROPOSAL', 'Child Work slots must be unique');
      const target = key(planned.definition);
      if (!definition.children?.some((ref) => key(ref) === target))
        throw new RuntimeError('CHILD_DENIED', 'Child Workflow is not permitted');
      const child = workflow(planned.definition);
      if (!child) throw new RuntimeError('UNAVAILABLE', 'Pinned child Workflow is missing');
      validate(child.objective, planned.objective);
      if (planned.mode !== undefined && !['sequential', 'concurrent'].includes(planned.mode))
        throw new RuntimeError('INVALID_PROPOSAL', 'Unsupported child Work mode');
    }
  } else if (proposal.type === 'join') {
    exact(proposal, ['type', 'state', 'join', 'dispositions']);
    exact(proposal.join, ['slot', 'child']);
    validate(definition.state, proposal.state);
    if (typeof proposal.join.slot !== 'string' || !proposal.join.slot)
      throw new RuntimeError('INVALID_PROPOSAL', 'A Workflow join slot is required');
    if (typeof proposal.join.child !== 'string' || !proposal.join.child)
      throw new RuntimeError('INVALID_PROPOSAL', 'A child Work slot is required for join');
    const child = children[proposal.join.child];
    if (!child) throw new RuntimeError('INVALID_PROPOSAL', 'Join target has not started');
    if (child.mode !== 'concurrent')
      throw new RuntimeError('INVALID_PROPOSAL', 'Only concurrent child Calls can be joined');
  } else if (proposal.type === 'wait') {
    exact(proposal, ['type', 'state', 'dispositions', 'until']);
    validate(definition.state, proposal.state);
    if (proposal.until === undefined) {
      if (!definition.input)
        throw new RuntimeError('INPUT_UNSUPPORTED', 'Waiting for input requires an input contract');
    } else validateWaitPlan(definition, proposal.until);
  } else
    throw new RuntimeError(
      'UNSUPPORTED',
      'This slice supports one call, waiting for input, completion and failure',
    );
  const dispositions = proposal.dispositions === undefined ? [] : proposal.dispositions;
  if (!Array.isArray(dispositions) || dispositions.length !== inputs.length)
    throw new RuntimeError(
      'INVALID_DISPOSITIONS',
      'Dispose every input in the supplied batch exactly once',
    );
  const remaining = new Set(inputs.map((input) => input.id));
  for (const disposition of dispositions) {
    exact(
      disposition,
      disposition?.status === 'ignored' ? ['id', 'status', 'reason'] : ['id', 'status'],
    );
    if (
      !remaining.delete(disposition.id) ||
      !['incorporated', 'ignored'].includes(disposition.status)
    )
      throw new RuntimeError(
        'INVALID_DISPOSITIONS',
        'Disposition must identify a unique input in the current batch',
      );
    if (disposition.status === 'ignored') checkReason(disposition.reason);
  }
  if (proposal.type === 'complete' && hasMoreInputs)
    throw new RuntimeError(
      'INPUT_BACKLOG',
      'Process remaining batches before proposing successful completion',
    );
  return proposal;
}
export function checkedOutcome(tool: AnyTool, raw: unknown): Outcome {
  try {
    const outcome = copy(raw) as Outcome;
    if (outcome.status === 'success') {
      exact(outcome, ['status', 'value']);
      validate(tool.output, outcome.value);
    } else if (outcome.status === 'failure') {
      exact(outcome, ['status', 'effect', 'reason']);
      checkReason(outcome.reason);
      if (!['none', 'partial', 'occurred'].includes(outcome.effect))
        throw new RuntimeError('INVALID_OUTCOME', 'Effect status required');
    } else if (outcome.status === 'unknown') {
      exact(outcome, ['status', 'reason']);
      checkReason(outcome.reason);
    } else throw new RuntimeError('INVALID_OUTCOME', 'Unknown outcome status');
    return outcome;
  } catch (error) {
    return {
      status: 'unknown',
      reason: { code: 'INVALID_OUTCOME', message: reason(error).message },
    };
  }
}
export function checkedReconciliation(tool: AnyTool, raw: unknown): ReconciliationResult {
  const result = copy(raw) as ReconciliationResult;
  if (result.status === 'success') {
    exact(result, ['status', 'value']);
    validate(tool.output, result.value);
  } else if (result.status === 'failure') {
    exact(result, ['status', 'effect', 'reason']);
    checkReason(result.reason);
    if (!['partial', 'occurred'].includes(result.effect))
      throw new RuntimeError(
        'INVALID_OUTCOME',
        'Reconciled failure effect must be partial or occurred',
      );
  } else if (result.status === 'not-applied' || result.status === 'unknown') {
    exact(result, ['status', 'reason']);
    checkReason(result.reason);
  } else throw new RuntimeError('INVALID_OUTCOME', 'Unknown reconciliation status');
  return result;
}
export function exact(object: unknown, fields: readonly string[]): void {
  if (
    !object ||
    typeof object !== 'object' ||
    Array.isArray(object) ||
    Object.keys(object).some((k) => !fields.includes(k))
  )
    throw new RuntimeError('UNSUPPORTED', 'Unsupported fields or shape');
  canonical(object);
}
function checkReason(value: Reason): void {
  if (!value || typeof value.code !== 'string' || !value.code || typeof value.message !== 'string')
    throw new RuntimeError('INVALID_REASON', 'Expected code and message');
}

function boundedDelay(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > 365 * 24 * 60 * 60 * 1000)
    throw new RuntimeError('INVALID_TIME', 'Delay must be an integer from zero to one year');
}

/** Validate every branch before any wait can be registered, including already-satisfied branches. */
function validateWaitPlan(definition: AnyWorkflow, root: WaitPlan): void {
  let nodes = 0;
  const walk = (plan: WaitPlan, depth: number): void => {
    if (++nodes > 128 || depth > 16)
      throw new RuntimeError('WAIT_LIMIT', 'Wait conditions allow at most 128 nodes and 16 levels');
    if (!plan || typeof plan !== 'object')
      throw new RuntimeError('INVALID_WAIT', 'Expected a wait plan');
    if (plan.type === 'all' || plan.type === 'any') {
      exact(plan, ['type', 'conditions']);
      if (!Array.isArray(plan.conditions) || !plan.conditions.length)
        throw new RuntimeError('INVALID_WAIT', 'All/any requires a nonempty condition list');
      for (const child of plan.conditions) walk(child, depth + 1);
      return;
    }
    if (!('slot' in plan) || typeof plan.slot !== 'string' || !plan.slot)
      throw new RuntimeError('INVALID_WAIT', 'Wait slot required');
    if (plan.type === 'existing') exact(plan, ['type', 'slot']);
    else if (plan.type === 'timer') {
      exact(plan, ['type', 'slot', 'delayMs', 'operation']);
      boundedDelay(plan.delayMs);
      if (plan.operation !== undefined && !['sleep', 'now'].includes(plan.operation))
        throw new RuntimeError('INVALID_WAIT', 'Unsupported timer operation');
    } else if (plan.type === 'reply') {
      exact(plan, [
        'type',
        'slot',
        'schema',
        'prompt',
        'blocking',
        'interaction',
        'presentation',
        'responders',
        'timeoutMs',
      ]);
      exact(plan.schema, ['id', 'version']);
      if (
        !definition.replySchemas?.some((contract) => key(contract) === key(plan.schema)) &&
        !resolveSchema(plan.schema)
      )
        throw new RuntimeError('SCHEMA_DENIED', 'Reply schema is not registered by this Workflow');
      if (plan.prompt !== undefined && (!plan.prompt.trim() || plan.prompt.length > 10_000))
        throw new RuntimeError('INVALID_WAIT', 'Reply prompt must contain 1–10000 characters');
      if (plan.blocking !== undefined && typeof plan.blocking !== 'boolean')
        throw new RuntimeError('INVALID_WAIT', 'Reply blocking must be boolean');
      if (plan.interaction !== undefined && !['question', 'approval'].includes(plan.interaction))
        throw new RuntimeError('INVALID_WAIT', 'Unsupported Interaction type');
      if (plan.presentation !== undefined) canonical(plan.presentation);
      if (
        !Array.isArray(plan.responders) ||
        !plan.responders.length ||
        plan.responders.some((p) => typeof p !== 'string' || !p)
      )
        throw new RuntimeError('INVALID_WAIT', 'Reply needs eligible responders');
      if (plan.timeoutMs !== undefined) boundedDelay(plan.timeoutMs);
    } else throw new RuntimeError('INVALID_WAIT', 'Unsupported wait plan');
  };
  walk(root, 1);
}
/** Internal traversal of an already shape-validated, bounded plan. */
export function waitLeaves(
  plan: WaitPlan,
): Exclude<WaitPlan, { conditions: readonly WaitPlan[] }>[] {
  return 'conditions' in plan ? plan.conditions.flatMap(waitLeaves) : [plan];
}
