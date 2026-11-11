import type { WorkId } from './types.js';

/** Ephemeral post-commit signal. This is not durable execution evidence or authority. */
export interface TelemetryEvent {
  readonly object: 'telemetry_event';
  readonly type: 'progress.committed';
  readonly workId: WorkId;
  readonly eventId: string;
  readonly kind: string;
  readonly recordedAt: number;
  readonly decisionSequence: number | null;
}

export interface TelemetrySink {
  emit(event: TelemetryEvent): void;
}
