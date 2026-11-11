import { RuntimeError } from './contracts.js';

export interface SchedulerOptions {
  readonly drive: () => Promise<void>;
  readonly expireDeadlines: () => void;
  readonly nextDeadline: () => number | null;
  readonly clock: () => number;
}

/** Owns the lifecycle of the embedded process scheduler, not Work transitions. */
export class Scheduler {
  private driving: Promise<void> | null = null;
  private background: Promise<void> | null = null;
  private finishBackground: (() => void) | null = null;
  private failBackground: ((error: unknown) => void) | null = null;
  private failureState: { error: unknown } | null = null;
  private wakePending = false;
  private wakeHandle: ReturnType<typeof setImmediate> | null = null;
  private deadlineHandle: ReturnType<typeof setTimeout> | null = null;
  private closePromise: Promise<void> | null = null;
  private closedState = false;

  constructor(private readonly options: SchedulerOptions) {}

  get closed(): boolean {
    return this.closedState;
  }

  get failure(): { readonly error: unknown } | null {
    return this.failureState;
  }

  get shouldContinue(): boolean {
    return !this.closedState && !this.failureState;
  }

  /** Start automatic execution. Supervise this promise until close or failure. */
  start(): Promise<void> {
    if (this.closedState) return Promise.reject(new RuntimeError('CLOSED', 'Runtime is closed'));
    if (!this.background) {
      this.background = new Promise<void>((resolve, reject) => {
        this.finishBackground = resolve;
        this.failBackground = reject;
      });
      try {
        this.refreshDeadline();
        this.wake();
      } catch (error) {
        this.fail(error);
      }
    }
    return this.background;
  }

  wake(): void {
    if (!this.background || this.closedState || this.failureState) return;
    if (this.driving) {
      this.wakePending = true;
      return;
    }
    if (this.wakeHandle) return;
    this.wakeHandle = setImmediate(() => {
      this.wakeHandle = null;
      void this.drain().catch((error) => this.fail(error));
    });
  }

  expireNow(): void {
    this.options.expireDeadlines();
  }

  refreshDeadline(): void {
    if (!this.background || this.closedState || this.failureState) return;
    if (this.deadlineHandle) clearTimeout(this.deadlineHandle);
    this.deadlineHandle = null;
    const deadline = this.options.nextDeadline();
    if (deadline === null) return;
    // Node clamps larger delays to 1ms. Long deadlines instead recheck in bounded intervals.
    const delayMs = Math.max(1, Math.min(2_147_483_647, deadline - this.options.clock()));
    this.deadlineHandle = setTimeout(() => {
      this.deadlineHandle = null;
      try {
        this.expireNow();
        this.refreshDeadline();
        this.wake();
      } catch (error) {
        this.fail(error);
      }
    }, delayMs);
  }

  /** Drive all currently eligible Work; concurrent requests share one drain. */
  drain(): Promise<void> {
    if (this.closedState) return Promise.reject(new RuntimeError('CLOSED', 'Runtime is closed'));
    if (this.failureState) return Promise.reject(this.failureState.error);
    if (!this.driving)
      this.driving = this.options
        .drive()
        .catch((error) => {
          if (this.background) this.fail(error);
          throw error;
        })
        .finally(() => {
          this.driving = null;
          try {
            this.refreshDeadline();
            if (this.wakePending) {
              this.wakePending = false;
              this.wake();
            }
          } catch (error) {
            if (this.background) this.fail(error);
            throw error;
          }
        });
    return this.driving;
  }

  close(finalize: () => void): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.closedState = true;
    this.stop();
    this.closePromise = (async () => {
      try {
        await this.driving;
        if (this.failureState) throw this.failureState.error;
      } finally {
        try {
          finalize();
        } finally {
          this.finishBackground?.();
        }
      }
    })();
    return this.closePromise;
  }

  private stop(): void {
    if (this.wakeHandle) clearImmediate(this.wakeHandle);
    if (this.deadlineHandle) clearTimeout(this.deadlineHandle);
    this.wakeHandle = null;
    this.deadlineHandle = null;
    this.wakePending = false;
  }

  private fail(error: unknown): void {
    if (this.failureState) return;
    this.failureState = { error };
    this.stop();
    this.failBackground?.(error);
  }
}
