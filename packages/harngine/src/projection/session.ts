import type { SessionId } from '../core/types.js';
import type { WorkRef } from '../core/execution.js';
import type { SessionState, DefinitionReference } from '../application/contracts.js';
import { ConflictError } from '../core/errors.js';
import { reference } from './definition.js';

export function sessionState(value: {
  id: SessionId;
  title: string;
  status: 'active' | 'closed';
  agent: { id: string; version: string } | null;
  foregroundWork: WorkRef | null;
  queuedWork: readonly WorkRef[];
  createdAt: number;
  updatedAt: number;
}): SessionState {
  if (!value.agent)
    throw new ConflictError({ code: 'SESSION_AGENT_MISSING', message: 'Session has no Agent' });
  return Object.freeze({
    object: 'session',
    id: value.id,
    title: value.title,
    status: value.status === 'active' ? 'open' : 'closed',
    agent: reference('agent', value.agent.id, value.agent.version) as DefinitionReference & {
      type: 'agent';
    },
    foregroundWorkId: value.foregroundWork?.id ?? null,
    queuedWorkIds: Object.freeze(value.queuedWork.map((work) => work.id)),
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  });
}
