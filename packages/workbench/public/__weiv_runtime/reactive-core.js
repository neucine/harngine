function reportErrors(errors) {
  const error = new AggregateError(errors, "Weiv reactive update failed");
  const report = globalThis.reportError;
  if (report)
    report.call(globalThis, error);
  else
    queueMicrotask(() => {
      throw error;
    });
}
export function createReactiveScheduler(options = {}) {
  const enqueue = options.enqueue ?? ((task) => queueMicrotask(task));
  const report = options.reportErrors ?? reportErrors;
  const maxWaves = options.maxWaves ?? 100;
  if (!Number.isInteger(maxWaves) || maxWaves < 1)
    throw new RangeError("maxWaves must be a positive integer");
  const notifications = new Map;
  const jobs = new Map;
  let scheduled = false;
  let waves = 0;
  function schedule() {
    if (scheduled)
      return;
    scheduled = true;
    enqueue(flush);
  }
  function flush() {
    const errors = [];
    if (++waves > maxWaves) {
      notifications.clear();
      jobs.clear();
      scheduled = false;
      waves = 0;
      report([new Error(`Weiv reactive updates exceeded ${maxWaves} consecutive waves`)]);
      return;
    }
    const preparing = Array.from(notifications.values());
    notifications.clear();
    const deliveries = [];
    for (const prepare of preparing) {
      try {
        deliveries.push(prepare());
      } catch (error) {
        errors.push(error);
      }
    }
    for (const deliver of deliveries) {
      try {
        deliver();
      } catch (error) {
        errors.push(error);
      }
    }
    const running = Array.from(jobs);
    for (const [owner, job] of running) {
      if (jobs.get(owner) !== job)
        continue;
      jobs.delete(owner);
      try {
        job.run();
      } catch (error) {
        errors.push(error);
      }
    }
    scheduled = false;
    if (notifications.size || jobs.size)
      schedule();
    else
      waves = 0;
    if (errors.length)
      report(errors);
  }
  return {
    notify(owner, prepare) {
      notifications.set(owner, prepare);
      schedule();
    },
    queueJob(owner, job) {
      jobs.set(owner, { run: job });
      schedule();
    },
    cancelJob(owner) {
      jobs.delete(owner);
    }
  };
}
export function sharedRuntime(name, create) {
  const key = Symbol.for(name);
  const existing = Reflect.getOwnPropertyDescriptor(globalThis, key);
  if (existing)
    return existing.value;
  const value = create();
  Object.defineProperty(globalThis, key, { value, enumerable: false, configurable: false, writable: false });
  return value;
}
export const reactiveScheduler = sharedRuntime("weiv.reactivity.scheduler.v1", () => createReactiveScheduler());
