import { setTimeout as delay } from 'node:timers/promises';
import { expect, test } from 'vitest';
import { Scheduler } from '../src/internal/scheduler.js';

async function until(check: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (check()) return;
    await delay(2);
  }
  throw new Error('Timed out');
}

test('Scheduler coalesces wakeups during a drain and finalizes shutdown once', async () => {
  let drives = 0;
  let release!: () => void;
  let finalized = 0;
  const scheduler = new Scheduler({
    drive: () => {
      drives++;
      return drives === 1
        ? new Promise<void>((resolve) => {
            release = resolve;
          })
        : Promise.resolve();
    },
    expireDeadlines: () => {},
    nextDeadline: () => null,
    clock: () => 0,
  });

  const supervision = scheduler.start();
  expect(scheduler.start()).toBe(supervision);
  await until(() => drives === 1);
  scheduler.wake();
  scheduler.wake();
  release();
  await until(() => drives === 2);

  const closing = scheduler.close(() => {
    finalized++;
  });
  expect(
    scheduler.close(() => {
      finalized++;
    }),
  ).toBe(closing);
  await closing;
  await supervision;
  expect(finalized).toBe(1);
  await expect(scheduler.drain()).rejects.toMatchObject({ code: 'CLOSED' });
});

test('Scheduler preserves the first background failure across supervision, drain, and close', async () => {
  const failure = new Error('drive failed');
  let finalized = 0;
  const scheduler = new Scheduler({
    drive: async () => {
      throw failure;
    },
    expireDeadlines: () => {},
    nextDeadline: () => null,
    clock: () => 0,
  });

  await expect(scheduler.start()).rejects.toBe(failure);
  await expect(scheduler.drain()).rejects.toBe(failure);
  await expect(
    scheduler.close(() => {
      finalized++;
    }),
  ).rejects.toBe(failure);
  expect(finalized).toBe(1);
});
