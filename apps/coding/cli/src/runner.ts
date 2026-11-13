import type {
  CallInspectionEntry,
  Interaction,
  Json,
  ModelDelta,
  Work,
  WorkSnapshot,
} from 'harngine';

export type ApprovalMode = 'ask' | 'approve' | 'deny';

export interface CodingWorkActivity {
  readonly status: 'thinking' | 'working' | 'idle';
  readonly label?: string;
  /** Ephemeral detail shown while active, such as the latest reasoning summary. */
  readonly detail?: string;
}

export interface CodingToolProgress {
  readonly callId: string;
  readonly label: string;
  readonly phase: 'started' | 'succeeded' | 'failed' | 'uncertain' | 'reconciling';
}

export interface CodingWorkResult<R extends Json> {
  readonly result: R;
  readonly events: readonly string[];
  readonly elapsedMs: number;
  readonly usage?: WorkSnapshot<R, R>['usage'];
  readonly streamedText: string;
}

export interface RunCodingWorkOptions {
  readonly approval?: ApprovalMode;
  readonly ask?: (prompt: string) => Promise<string>;
  readonly progress?: (line: string) => void;
  readonly stream?: (text: string) => void;
  readonly activity?: (state: CodingWorkActivity) => void;
  readonly toolProgress?: (event: CodingToolProgress) => void;
  /** Print provider reasoning summaries in progress output. */
  readonly showThinking?: boolean;
}

export async function runCodingWork<O extends Json, R extends Json>(
  work: Work<O, R>,
  options: RunCodingWorkOptions = {},
): Promise<CodingWorkResult<R>> {
  const startedAt = Date.now();
  const approval = options.approval ?? 'deny';
  const progress = options.progress ?? (() => {});
  const activity = options.activity ?? (() => {});
  let streamedText = '';
  let streamStarted = false;
  let streamNeedsNewline = false;
  let streamActive = false;
  let previewCallId = '';
  let previewText = '';
  const showProgress = (line: string) => {
    streamActive = false;
    activity({ status: 'idle' });
    if (streamNeedsNewline) {
      options.stream?.('\n');
      streamNeedsNewline = false;
    }
    progress(line);
  };
  const reportTool = (event: CodingToolProgress) => {
    activity({ status: 'idle' });
    if (options.toolProgress) {
      options.toolProgress(event);
      return;
    }
    if (event.phase === 'started') progress(`→ ${event.label}`);
    else if (event.phase === 'succeeded') progress(`✓ ${event.label}`);
    else if (event.phase === 'failed') progress(`✕ ${event.label}`);
    else if (event.phase === 'uncertain') progress(`? ${event.label} · result needs review`);
    else progress(`… ${event.label} · reconciling`);
  };
  const handledInteractions = new Set<string>();
  const callStates = new Map<string, { started: boolean; finished: boolean }>();
  const seenProgress = new Set<string>();
  const events: string[] = [];
  let lastStatus = '';

  activity({ status: 'thinking', label: 'Thinking' });
  const watcherAbort = new AbortController();
  const watch = await work.watch({
    signal: watcherAbort.signal,
    onModelDelta(delta: ModelDelta) {
      if (delta.item.type !== 'text' || !delta.item.text) return;
      if (delta.callId !== previewCallId) {
        previewCallId = delta.callId;
        previewText = '';
      }
      previewText += delta.item.text;
      activity({
        status: 'thinking',
        label: 'Thinking',
        detail: thinkingPreview(previewText),
      });
      if (!options.stream) return;
      activity({ status: 'idle' });
      streamActive = true;
      streamedText += delta.item.text;
      streamNeedsNewline = !streamedText.endsWith('\n');
      if (!streamStarted) {
        streamStarted = true;
        options.stream('\nAgent\n');
      }
      options.stream(delta.item.text);
    },
  });

  const handleSnapshot = async (snapshot: WorkSnapshot<O, R>) => {
    if (snapshot.status !== lastStatus) {
      lastStatus = snapshot.status;
      if (snapshot.status === 'waiting' && snapshot.waitingFor) {
        if (snapshot.waitingFor === 'external-result') {
          if (streamActive) {
            streamActive = false;
          } else {
            activity({ status: 'thinking', label: 'Thinking' });
          }
        } else {
          activity({ status: 'idle' });
          if (snapshot.waitingFor !== 'approval' && snapshot.waitingFor !== 'question') {
            showProgress(`Waiting for ${describeWait(snapshot.waitingFor)}`);
          }
        }
      } else if (snapshot.status === 'queued') {
        showProgress('Queued behind active work');
        activity({ status: 'thinking', label: 'Waiting' });
      }
    }

    const reported = await reportInspectionChanges(
      work,
      callStates,
      seenProgress,
      activity,
      showProgress,
      reportTool,
      options.showThinking ?? false,
    );

    for (const interaction of snapshot.interactions) {
      if (handledInteractions.has(interaction.id)) continue;
      handledInteractions.add(interaction.id);
      await respondToInteraction(work, interaction, approval, options.ask, activity, showProgress);
    }
    if (snapshot.status === 'running' && snapshot.interactions.length === 0 && !streamActive)
      activity({ status: 'thinking', label: reported ? 'Working' : 'Thinking' });
  };

  const consume = (async () => {
    // A fast Tool or approval can settle before the watch iterator is consumed.
    await handleSnapshot(watch.value);
    for await (const update of watch) {
      events.push(update.value.event);
      await handleSnapshot(update.value.snapshot);
    }
    await reportInspectionChanges(
      work,
      callStates,
      seenProgress,
      activity,
      showProgress,
      reportTool,
      options.showThinking ?? false,
    );
    activity({ status: 'idle' });
  })();

  try {
    const [result] = await Promise.all([work.result(), consume]);
    if (streamNeedsNewline) options.stream?.('\n');
    const finalSnapshot = await work.snapshot();
    return {
      result,
      events,
      elapsedMs: Date.now() - startedAt,
      ...(finalSnapshot.usage ? { usage: finalSnapshot.usage } : {}),
      streamedText,
    };
  } catch (error) {
    activity({ status: 'idle' });
    watcherAbort.abort();
    await consume.catch(() => {});
    throw error;
  }
}

function describeWait(value: string) {
  if (value === 'external-result') return 'model response';
  if (value === 'approval') return 'edit approval';
  if (value === 'question') return 'your answer';
  return value.replaceAll('-', ' ');
}

async function reportInspectionChanges<O extends Json, R extends Json>(
  work: Work<O, R>,
  states: Map<string, { started: boolean; finished: boolean }>,
  seenProgress: Set<string>,
  activity: (state: CodingWorkActivity) => void,
  progress: (line: string) => void,
  reportTool: (event: CodingToolProgress) => void,
  showThinking: boolean,
) {
  const inspection = await work.inspect({ detail: 'diagnostic', limit: 100 });
  let reported = false;
  for (const entry of inspection.entries) {
    if (entry.type === 'call') {
      const state = states.get(entry.callId) ?? { started: false, finished: false };
      states.set(entry.callId, state);
      const label = describeCall(entry);
      if (!state.started) {
        state.started = true;
        reportTool({ callId: entry.callId, label, phase: 'started' });
        reported = true;
      }
      if (
        !state.finished &&
        (entry.phase === 'settled' || entry.phase === 'resolved' || entry.phase === 'rejected')
      ) {
        state.finished = true;
        reportTool({
          callId: entry.callId,
          label,
          phase: entry.phase === 'rejected' ? 'failed' : 'succeeded',
        });
        reported = true;
      } else if (!state.finished && entry.phase === 'uncertain') {
        state.finished = true;
        reportTool({ callId: entry.callId, label, phase: 'uncertain' });
        reported = true;
      } else if (!state.finished && entry.phase === 'reconciling') {
        reportTool({ callId: entry.callId, label, phase: 'reconciling' });
        reported = true;
      }
    } else if (
      entry.type === 'model.progress' &&
      entry.phase === 'reasoning' &&
      entry.text?.trim() &&
      !seenProgress.has(entry.id)
    ) {
      seenProgress.add(entry.id);
      if (showThinking) {
        activity({ status: 'idle' });
        progress(`Thinking · ${thinkingPreview(entry.text)}`);
        reported = true;
      } else {
        activity({
          status: 'thinking',
          label: 'Thinking',
          detail: thinkingPreview(entry.text),
        });
      }
    }
  }
  return reported;
}

async function respondToInteraction<O extends Json, R extends Json>(
  work: Work<O, R>,
  interaction: Interaction,
  approval: ApprovalMode,
  ask: ((prompt: string) => Promise<string>) | undefined,
  activity: (state: CodingWorkActivity) => void,
  progress: (line: string) => void,
) {
  if (interaction.type === 'question') {
    if (!ask) throw new Error('This Work needs an answer; rerun in an interactive terminal.');
    activity({ status: 'idle' });
    const response = await ask(`${interaction.prompt}\n> `);
    await work.respond(interaction.id, response);
    progress('Answered agent question');
    activity({ status: 'thinking', label: 'Thinking' });
    return;
  }

  if (approval === 'deny') {
    progress(`Denied approval: ${interaction.title}`);
    await work.respond(interaction.id, false);
    activity({ status: 'thinking', label: 'Thinking' });
    return;
  }

  let approved = approval === 'approve';
  if (approval === 'ask') {
    if (!ask) throw new Error('Edit approval requires a terminal; rerun with --yes to approve.');
    activity({ status: 'idle' });
    progress(formatApproval(interaction));
    approved = /^y(?:es)?$/i.test((await ask('Approve this exact change? [y/N] ')).trim());
  }

  await work.respond(interaction.id, approved);
  progress(approved ? 'Approved exact edit' : 'Denied exact edit');
  activity({ status: 'thinking', label: 'Thinking' });
}

export function describeCall(entry: CallInspectionEntry): string {
  const input =
    entry.diagnostic?.input &&
    typeof entry.diagnostic.input === 'object' &&
    !Array.isArray(entry.diagnostic.input)
      ? (entry.diagnostic.input as Record<string, Json>)
      : {};
  const path = typeof input.path === 'string' ? input.path : '';
  const query = typeof input.query === 'string' ? input.query : '';
  const command = typeof input.command === 'string' ? input.command : '';
  const args = Array.isArray(input.args)
    ? input.args.filter((value): value is string => typeof value === 'string').join(' ')
    : '';

  if (entry.tool.id === 'coding.read') return `Read ${path || 'file'}`;
  if (entry.tool.id === 'coding.search') return `Search “${query || 'repository'}”`;
  if (entry.tool.id === 'coding.edit') return `Edit ${path || 'file'}`;
  if (entry.tool.id === 'coding.check')
    return `Check ${[command, args].filter(Boolean).join(' ') || 'repository'}`;
  return entry.tool.id;
}

export function formatApproval(interaction: Extract<Interaction, { type: 'approval' }>): string {
  const details =
    interaction.details &&
    typeof interaction.details === 'object' &&
    !Array.isArray(interaction.details)
      ? (interaction.details as Record<string, Json>)
      : {};
  const path = typeof details.path === 'string' ? details.path : 'repository change';
  const oldText = typeof details.oldText === 'string' ? details.oldText : '';
  const newText = typeof details.newText === 'string' ? details.newText : '';
  return [
    '',
    `Approval required · ${interaction.title}`,
    `File: ${path}`,
    oldText ? `Remove:\n${preview(oldText, '- ')}` : '',
    newText ? `Add:\n${preview(newText, '+ ')}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

function preview(value: string, prefix: string): string {
  const lines = value.split('\n');
  const shown = lines.slice(0, 12).map((line) => `${prefix}${line}`);
  if (lines.length > 12) shown.push(`${prefix.slice(0, 1)} … ${lines.length - 12} more lines`);
  return shown.join('\n');
}

function thinkingPreview(value: string) {
  const text = value.replace(/\s+/g, ' ').trim();
  return text.length > 240 ? `${text.slice(0, 237)}…` : text;
}
