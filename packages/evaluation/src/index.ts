import type {
  Agent,
  AppScope,
  CallInspectionEntry,
  Definition,
  DefinitionReference,
  InspectionEntry,
  Json,
  StartOptions,
  Work,
  WorkId,
  WorkSnapshot,
  WorkStatus,
  Workflow,
  Works,
} from 'harngine';

export type EvidenceDetail = 'story' | 'diagnostic';

export interface EvidenceOptions {
  /** Story evidence is safe for ordinary reports; diagnostic evidence includes recorded payloads. */
  readonly detail?: EvidenceDetail;
  /**
   * Capture the complete attached child-Work tree. Defaults to true so a parent result is not
   * credited from evidence that exists only in descendants.
   */
  readonly includeChildren?: boolean;
  /** Maximum inspection entries retained for each Work. Defaults to 10,000. */
  readonly maxEntriesPerWork?: number;
  /** Maximum Works retained in one trace. Defaults to 100. */
  readonly maxWorks?: number;
  /** Maximum attached child depth. Defaults to 8. */
  readonly maxDepth?: number;
}

export interface WorkEvidence {
  readonly object: 'work_evidence';
  readonly work: WorkSnapshot;
  readonly entries: readonly InspectionEntry[];
  /** Whether every available inspection entry for this Work was captured. */
  readonly complete: boolean;
}

export interface WorkTreeEvidence {
  readonly object: 'work_trace';
  readonly rootWorkId: WorkId;
  readonly detail: EvidenceDetail;
  readonly works: readonly WorkEvidence[];
  /**
   * False when a configured capture limit or page-boundary failure prevented collecting the
   * complete attached tree. Metrics retain this flag so a truncated trace is never reported as a
   * conclusive benchmark.
   */
  readonly complete: boolean;
}

export interface CallMetric {
  readonly callId: string;
  readonly tool: DefinitionReference & { readonly kind: 'tool' };
  readonly phase: CallInspectionEntry['phase'];
  readonly attemptCount: number;
}

export interface ChildMetric {
  readonly callId: string;
  readonly childWorkId: WorkId;
  readonly definition: DefinitionReference & { readonly kind: 'agent' | 'workflow' };
  readonly mode: 'sequential' | 'concurrent';
  readonly phase: 'started' | 'joined' | 'closed';
  readonly phases: readonly ('started' | 'joined' | 'closed')[];
  readonly status: 'completed' | 'failed' | 'canceled' | 'active';
}

export interface InteractionMetric {
  readonly interactionId: string;
  readonly type: 'question' | 'approval';
  readonly status: string;
}

export interface WorkEvidenceMetrics {
  readonly workId: WorkId;
  readonly definition: DefinitionReference & { readonly kind: 'agent' | 'workflow' };
  readonly status: WorkStatus;
  readonly recordedDurationMs: number | null;
  readonly inputs: Readonly<Record<string, number>>;
  readonly decisions: Readonly<Record<string, number>>;
  readonly calls: readonly CallMetric[];
  readonly children: readonly ChildMetric[];
  readonly interactions: readonly InteractionMetric[];
  readonly modelTurns: number;
  readonly toolExecutions: number;
  readonly tokenUsage: {
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly totalTokens: number;
    readonly costMicros: Readonly<Record<string, number>>;
  };
}

export interface WorkTreeMetrics {
  readonly object: 'evaluation_metrics';
  readonly complete: boolean;
  readonly works: number;
  readonly completed: number;
  readonly failed: number;
  readonly canceled: number;
  readonly stopped: number;
  readonly modelTurns: number;
  readonly toolExecutions: number;
  readonly childWork: number;
  readonly decisions: Readonly<Record<string, number>>;
  readonly calls: number;
  readonly retries: number;
  readonly uncertainCalls: number;
  readonly tokenUsage: WorkEvidenceMetrics['tokenUsage'];
  readonly byWork: readonly WorkEvidenceMetrics[];
}

export interface EvaluationScore {
  readonly score: number;
  readonly passed: boolean;
  readonly label?: string;
  readonly details?: Json;
}

export interface EvaluationContext {
  readonly trace: WorkTreeEvidence;
  readonly metrics: WorkTreeMetrics;
  /** Final result when the root Work completed. */
  readonly result?: Json;
  /** Public failure recorded by the root Work, if any. */
  readonly error?: { readonly code: string; readonly message: string };
}

export type EvaluationScorer = (
  context: EvaluationContext,
) => EvaluationScore | Promise<EvaluationScore>;

type AnyDefinition = Definition & { readonly id: string; readonly revision: string };
type ObjectiveOf<D extends AnyDefinition> =
  D extends Workflow<infer O, any> ? O : D extends Agent<infer O, any> ? O : never;

export interface EvaluationCase<D extends AnyDefinition = AnyDefinition> {
  readonly id: string;
  readonly definition: D;
  readonly objective: ObjectiveOf<D>;
  readonly limits?: StartOptions['limits'];
  readonly score?: EvaluationScorer;
}

export function evaluationCase<D extends AnyDefinition>(value: {
  readonly id: string;
  readonly definition: D;
  readonly objective: ObjectiveOf<D>;
  readonly limits?: StartOptions['limits'];
  readonly score?: EvaluationScorer;
}): EvaluationCase<D> {
  if (!value.id.trim()) throw new Error('Evaluation case id must not be empty');
  return Object.freeze({
    id: value.id,
    definition: value.definition,
    objective: value.objective,
    ...(value.limits ? { limits: Object.freeze({ ...value.limits }) } : {}),
    ...(value.score ? { score: value.score } : {}),
  });
}

export interface EvaluationCaseResult {
  readonly object: 'evaluation_case';
  readonly id: string;
  readonly passed: boolean;
  readonly durationMs: number;
  readonly result?: Json;
  readonly error?: { readonly code: string; readonly message: string };
  readonly trace: WorkTreeEvidence;
  readonly metrics: WorkTreeMetrics;
  readonly score?: EvaluationScore;
  readonly evaluationError?: { readonly code: string; readonly message: string };
}

export interface EvaluationReport {
  readonly object: 'evaluation_report';
  readonly cases: readonly EvaluationCaseResult[];
  readonly summary: {
    readonly total: number;
    readonly passed: number;
    readonly failed: number;
    readonly evaluationErrors: number;
    readonly incompleteTraces: number;
    readonly averageScore: number | null;
  };
}

export interface EvaluationOptions {
  readonly evidence?: EvidenceOptions;
  readonly now?: () => number;
  /** Bounds waiting for a case result without canceling the durable Work. */
  readonly signal?: AbortSignal;
}

const STORY_LIMIT = 100;
const TERMINAL_STATUSES = new Set<WorkStatus>(['completed', 'failed', 'canceled']);

function positiveInteger(value: number | undefined, fallback: number, name: string): number {
  const selected = value ?? fallback;
  if (!Number.isSafeInteger(selected) || selected < 1)
    throw new Error(`${name} must be a positive safe integer`);
  return selected;
}

function frozenRecord(value: Readonly<Record<string, number>>): Readonly<Record<string, number>> {
  return Object.freeze({ ...value });
}

function increment(record: Record<string, number>, key: string): void {
  record[key] = (record[key] ?? 0) + 1;
}

function publicError(error: unknown): { readonly code: string; readonly message: string } {
  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    typeof error.code === 'string' &&
    'message' in error &&
    typeof error.message === 'string'
  )
    return { code: error.code, message: error.message };
  return { code: 'EVALUATION_ERROR', message: 'Evaluation observed an unclassified error' };
}

async function captureWork(
  work: Work,
  detail: EvidenceDetail,
  maximum: number,
): Promise<WorkEvidence> {
  const snapshot = await work.snapshot();
  const entries: InspectionEntry[] = [];
  let after: string | undefined;
  let complete = true;
  while (entries.length < maximum) {
    const limit = Math.min(STORY_LIMIT, maximum - entries.length);
    const page = await work.inspect({
      detail,
      limit,
      ...(after ? { after } : {}),
    });
    entries.push(...page.entries);
    if (!page.hasMore)
      return Object.freeze({
        object: 'work_evidence',
        work: snapshot,
        entries: Object.freeze(entries),
        complete,
      });
    if (!page.next || page.next === after) {
      complete = false;
      break;
    }
    after = page.next;
  }
  if (entries.length >= maximum) complete = false;
  return Object.freeze({
    object: 'work_evidence',
    work: snapshot,
    entries: Object.freeze(entries),
    complete,
  });
}

/**
 * Capture durable public evidence for one Work and its attached descendants. The returned trace
 * contains only source inspection records; derived metrics and scorers never write to the Runtime.
 */
export async function captureWorkTrace(
  works: Works,
  rootWorkId: WorkId,
  options: EvidenceOptions = {},
): Promise<WorkTreeEvidence> {
  const detail = options.detail ?? 'story';
  const includeChildren = options.includeChildren ?? true;
  const maximumEntries = positiveInteger(options.maxEntriesPerWork, 10_000, 'maxEntriesPerWork');
  const maximumWorks = positiveInteger(options.maxWorks, 100, 'maxWorks');
  const maximumDepth = positiveInteger(options.maxDepth, 8, 'maxDepth');
  const selected: WorkEvidence[] = [];
  const seen = new Set<WorkId>();
  const queue: { readonly id: WorkId; readonly depth: number }[] = [{ id: rootWorkId, depth: 0 }];
  let complete = true;

  while (queue.length) {
    const next = queue.shift()!;
    if (seen.has(next.id)) continue;
    if (selected.length >= maximumWorks) {
      complete = false;
      break;
    }
    const evidence = await captureWork(await works.get(next.id), detail, maximumEntries);
    selected.push(evidence);
    seen.add(next.id);
    if (!evidence.complete) complete = false;
    if (!includeChildren) {
      if (evidence.work.childWorkIds.length) complete = false;
      continue;
    }
    for (const childWorkId of evidence.work.childWorkIds) {
      if (next.depth >= maximumDepth) {
        complete = false;
        continue;
      }
      if (!seen.has(childWorkId)) queue.push({ id: childWorkId, depth: next.depth + 1 });
    }
  }

  return Object.freeze({
    object: 'work_trace',
    rootWorkId,
    detail,
    works: Object.freeze(selected),
    complete,
  });
}

function workMetrics(
  evidence: WorkEvidence,
  workById: ReadonlyMap<WorkId, WorkEvidence>,
): WorkEvidenceMetrics {
  const inputs: Record<string, number> = {};
  const decisions: Record<string, number> = {};
  const callPhases = new Map<string, Extract<InspectionEntry, { type: 'call' }>>();
  const children = new Map<string, Extract<InspectionEntry, { type: 'child' }>[]>();
  const interactions = new Map<string, Extract<InspectionEntry, { type: 'interaction' }>>();
  const modelUsages = new Map<
    string,
    {
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
      costMicros: Record<string, number>;
    }
  >();
  let anonymousModel = 0;

  for (const entry of evidence.entries) {
    if (entry.type === 'input') increment(inputs, entry.status);
    if (entry.type === 'decision') increment(decisions, entry.proposal);
    if (entry.type === 'call') callPhases.set(entry.callId, entry);
    if (entry.type === 'child') {
      const phases = children.get(entry.callId) ?? [];
      phases.push(entry);
      children.set(entry.callId, phases);
    }
    if (entry.type === 'interaction') interactions.set(entry.interaction.id, entry);
    if (entry.type === 'model.progress' && entry.phase === 'completed' && entry.usage) {
      const key =
        entry.decisionSequence === undefined
          ? `anonymous:${anonymousModel++}`
          : String(entry.decisionSequence);
      const usage = modelUsages.get(key) ?? {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        costMicros: {},
      };
      usage.inputTokens += entry.usage.inputTokens ?? 0;
      usage.outputTokens += entry.usage.outputTokens ?? 0;
      usage.totalTokens +=
        entry.usage.totalTokens ?? (entry.usage.inputTokens ?? 0) + (entry.usage.outputTokens ?? 0);
      if (entry.usage.cost)
        usage.costMicros[entry.usage.cost.currency] =
          (usage.costMicros[entry.usage.cost.currency] ?? 0) + entry.usage.cost.amountMicros;
      modelUsages.set(key, usage);
    }
  }

  const tokenUsage = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    costMicros: {} as Record<string, number>,
  };
  for (const usage of modelUsages.values()) {
    tokenUsage.inputTokens += usage.inputTokens;
    tokenUsage.outputTokens += usage.outputTokens;
    tokenUsage.totalTokens += usage.totalTokens;
    for (const [currency, amount] of Object.entries(usage.costMicros))
      tokenUsage.costMicros[currency] = (tokenUsage.costMicros[currency] ?? 0) + amount;
  }

  const snapshot = evidence.work;
  return Object.freeze({
    workId: snapshot.id,
    definition: snapshot.definition,
    status: snapshot.status,
    recordedDurationMs:
      snapshot.updatedAt >= snapshot.createdAt ? snapshot.updatedAt - snapshot.createdAt : null,
    inputs: frozenRecord(inputs),
    decisions: frozenRecord(decisions),
    calls: Object.freeze(
      [...callPhases.values()]
        .sort((left, right) => (left.recordedAt ?? 0) - (right.recordedAt ?? 0))
        .map((entry) =>
          Object.freeze({
            callId: entry.callId,
            tool: entry.tool,
            phase: entry.phase,
            attemptCount: entry.attemptCount,
          }),
        ),
    ),
    children: Object.freeze(
      [...children.values()]
        .map((phases) =>
          phases.sort((left, right) => (left.recordedAt ?? 0) - (right.recordedAt ?? 0)),
        )
        .sort((left, right) => (left[0]?.recordedAt ?? 0) - (right[0]?.recordedAt ?? 0))
        .map((phases) => {
          const first = phases[0]!;
          const latest = phases.at(-1)!;
          const child = workById.get(first.childWorkId)?.work;
          const recordedStatus = phases.findLast((entry) => entry.status)?.status;
          return Object.freeze({
            callId: first.callId,
            childWorkId: first.childWorkId,
            definition: first.definition,
            mode: first.mode,
            phase: latest.phase,
            phases: Object.freeze(phases.map((entry) => entry.phase)),
            status:
              child?.status === 'completed' ||
              child?.status === 'failed' ||
              child?.status === 'canceled'
                ? child.status
                : (recordedStatus ?? 'active'),
          });
        }),
    ),
    interactions: Object.freeze(
      [...interactions.values()].map((entry) =>
        Object.freeze({
          interactionId: entry.interaction.id,
          type: entry.interaction.type,
          status: entry.status,
        }),
      ),
    ),
    modelTurns: snapshot.usage?.modelTurns ?? 0,
    toolExecutions: snapshot.usage?.toolExecutions ?? 0,
    tokenUsage: Object.freeze({
      inputTokens: tokenUsage.inputTokens,
      outputTokens: tokenUsage.outputTokens,
      totalTokens: tokenUsage.totalTokens,
      costMicros: frozenRecord(tokenUsage.costMicros),
    }),
  });
}

/** Derive JSON-safe benchmark facts from a captured Work tree. */
export function summarizeWorkTrace(trace: WorkTreeEvidence): WorkTreeMetrics {
  const workById = new Map(trace.works.map((evidence) => [evidence.work.id, evidence]));
  const byWork = trace.works.map((evidence) => workMetrics(evidence, workById));
  const decisions: Record<string, number> = {};
  const tokenUsage = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    costMicros: {} as Record<string, number>,
  };
  for (const work of byWork) {
    for (const [proposal, count] of Object.entries(work.decisions))
      decisions[proposal] = (decisions[proposal] ?? 0) + count;
    tokenUsage.inputTokens += work.tokenUsage.inputTokens;
    tokenUsage.outputTokens += work.tokenUsage.outputTokens;
    tokenUsage.totalTokens += work.tokenUsage.totalTokens;
    for (const [currency, amount] of Object.entries(work.tokenUsage.costMicros))
      tokenUsage.costMicros[currency] = (tokenUsage.costMicros[currency] ?? 0) + amount;
  }
  const statuses = byWork.map((work) => work.status);
  return Object.freeze({
    object: 'evaluation_metrics',
    complete: trace.complete,
    works: byWork.length,
    completed: statuses.filter((status) => status === 'completed').length,
    failed: statuses.filter((status) => status === 'failed').length,
    canceled: statuses.filter((status) => status === 'canceled').length,
    stopped: statuses.filter((status) => !TERMINAL_STATUSES.has(status)).length,
    modelTurns: byWork.reduce((total, work) => total + work.modelTurns, 0),
    toolExecutions: byWork.reduce((total, work) => total + work.toolExecutions, 0),
    childWork: Math.max(0, byWork.length - 1),
    decisions: frozenRecord(decisions),
    calls: byWork.reduce((total, work) => total + work.calls.length, 0),
    retries: trace.works.reduce(
      (total, work) =>
        total +
        work.entries.filter((entry) => entry.type === 'call' && entry.phase === 'retrying').length,
      0,
    ),
    uncertainCalls: byWork.reduce(
      (total, work) => total + work.calls.filter((call) => call.phase === 'uncertain').length,
      0,
    ),
    tokenUsage: Object.freeze({
      inputTokens: tokenUsage.inputTokens,
      outputTokens: tokenUsage.outputTokens,
      totalTokens: tokenUsage.totalTokens,
      costMicros: frozenRecord(tokenUsage.costMicros),
    }),
    byWork: Object.freeze(byWork),
  });
}

function validateScore(score: EvaluationScore): EvaluationScore {
  if (!Number.isFinite(score.score)) throw new Error('Evaluation score must be finite');
  if (typeof score.passed !== 'boolean')
    throw new Error('Evaluation score passed must be a boolean');
  return Object.freeze({
    score: score.score,
    passed: score.passed,
    ...(score.label ? { label: score.label } : {}),
    ...(score.details === undefined ? {} : { details: score.details }),
  });
}

/** Run one case against a principal-scoped App and retain its causal evidence and benchmark facts. */
export async function evaluateCase(
  app: AppScope,
  evaluation: EvaluationCase,
  options: EvaluationOptions = {},
): Promise<EvaluationCaseResult> {
  const start = options.now ?? Date.now;
  const startedAt = start();
  const work = await app.start(evaluation.definition, evaluation.objective, {
    ...(evaluation.limits ? { limits: evaluation.limits } : {}),
  });
  let result: Json | undefined;
  let error: { readonly code: string; readonly message: string } | undefined;
  try {
    result = await work.result(options.signal ? { signal: options.signal } : undefined);
  } catch (caught) {
    error = publicError(caught);
  }
  const trace = await captureWorkTrace(app.works, work.id, options.evidence);
  const metrics = summarizeWorkTrace(trace);
  let score: EvaluationScore | undefined;
  let evaluationError: { readonly code: string; readonly message: string } | undefined;
  if (evaluation.score) {
    try {
      score = validateScore(
        await evaluation.score({
          trace,
          metrics,
          ...(result === undefined ? {} : { result }),
          ...(error ? { error } : {}),
        }),
      );
    } catch (caught) {
      evaluationError = publicError(caught);
    }
  }
  const passed =
    evaluationError === undefined &&
    (score?.passed ?? (error === undefined && trace.works[0]?.work.status === 'completed'));
  return Object.freeze({
    object: 'evaluation_case',
    id: evaluation.id,
    passed,
    durationMs: Math.max(0, start() - startedAt),
    ...(result === undefined ? {} : { result }),
    ...(error ? { error } : {}),
    trace,
    metrics,
    ...(score ? { score } : {}),
    ...(evaluationError ? { evaluationError } : {}),
  });
}

/** Execute an ordered benchmark suite without changing definitions or closing the application. */
export async function runEvaluation(
  app: AppScope,
  cases: readonly EvaluationCase[],
  options: EvaluationOptions = {},
): Promise<EvaluationReport> {
  const ids = new Set<string>();
  for (const evaluation of cases) {
    if (ids.has(evaluation.id)) throw new Error(`Duplicate evaluation case id: ${evaluation.id}`);
    ids.add(evaluation.id);
  }
  const results: EvaluationCaseResult[] = [];
  for (const evaluation of cases) results.push(await evaluateCase(app, evaluation, options));
  const scored = results.flatMap((result) => (result.score ? [result.score.score] : []));
  return Object.freeze({
    object: 'evaluation_report',
    cases: Object.freeze(results),
    summary: Object.freeze({
      total: results.length,
      passed: results.filter((result) => result.passed).length,
      failed: results.filter((result) => !result.passed).length,
      evaluationErrors: results.filter((result) => result.evaluationError).length,
      incompleteTraces: results.filter((result) => !result.trace.complete).length,
      averageScore:
        scored.length === 0
          ? null
          : scored.reduce((total, score) => total + score, 0) / scored.length,
    }),
  });
}
