/**
 * Bounded-concurrency, backpressured, first-error-wins task queue for the
 * publisher's uploads (quick task 260913-nvn).
 *
 * `publishSeasons` builds artifacts synchronously; before this queue existed
 * every body in a (season, algorithm) block was held until the block's final
 * `Promise.all`, so building and uploading never overlapped. Here, `enqueue`
 * resolves as soon as a task is ACCEPTED — immediately while fewer than
 * `maxPending` tasks are queued or running, otherwise once one settles — and
 * that await is the build loop's yield point: uploads drain while the next
 * artifact builds, and at most `maxPending` bodies are held in memory.
 *
 * The queue knows nothing about R2. The caller's task does the put, so
 * `r2Client.ts`'s own retry/backoff policy is untouched; a task that still
 * rejects after those retries is the queue's first error. From then on every
 * `enqueue` rejects with it, tasks still waiting for a slot are dropped
 * without starting, and `drain` rejects with it. Every task promise is caught
 * internally, so a failure never surfaces as an unhandled rejection.
 */
export interface UploadQueueOptions {
  /** Tasks running at once. At least 1. */
  readonly concurrency: number;
  /** Tasks queued-plus-running before `enqueue` blocks. Defaults to `concurrency * 2`; must be at least `concurrency`. */
  readonly maxPending?: number;
}

type Task = () => Promise<void>;

export class UploadQueue {
  readonly #concurrency: number;
  readonly #maxPending: number;
  readonly #waiting: Task[] = [];
  #running = 0;
  #error: { readonly value: unknown } | undefined;
  #closed = false;
  /** `enqueue` callers blocked on backpressure; each is woken to re-check capacity. */
  #acceptWaiters: (() => void)[] = [];
  /** `drain`/`abandon` callers, woken whenever the queue may have gone idle. */
  #idleWaiters: (() => void)[] = [];

  constructor(options: UploadQueueOptions) {
    const { concurrency } = options;
    const maxPending = options.maxPending ?? concurrency * 2;
    if (!Number.isInteger(concurrency) || concurrency < 1) {
      throw new Error(`UploadQueue: concurrency must be an integer >= 1, got ${concurrency}`);
    }
    if (!Number.isInteger(maxPending) || maxPending < concurrency) {
      throw new Error(`UploadQueue: maxPending must be an integer >= concurrency (${concurrency}), got ${maxPending}`);
    }
    this.#concurrency = concurrency;
    this.#maxPending = maxPending;
  }

  /** Resolves once `task` is accepted (not once it completes); rejects with the queue's first error. */
  async enqueue(task: Task): Promise<void> {
    for (;;) {
      if (this.#error !== undefined) throw this.#error.value;
      if (this.#closed) throw new Error("UploadQueue: enqueue after abandon");
      if (this.#running + this.#waiting.length < this.#maxPending) break;
      await new Promise<void>((resolve) => this.#acceptWaiters.push(resolve));
    }
    this.#waiting.push(task);
    this.#pump();
  }

  /** Waits for every accepted task to settle; rejects with the first error. */
  async drain(): Promise<void> {
    await this.#waitForIdle();
    if (this.#error !== undefined) throw this.#error.value;
  }

  /**
   * Drops tasks still waiting for a slot, refuses further enqueues, and waits
   * for in-flight tasks to settle, ignoring their outcomes. For the caller's
   * own failure path: the caller rethrows its original error afterwards.
   */
  async abandon(): Promise<void> {
    this.#closed = true;
    this.#waiting.length = 0;
    this.#wakeAcceptWaiters();
    await this.#waitForIdle();
  }

  #pump(): void {
    while (this.#running < this.#concurrency && this.#waiting.length > 0 && this.#error === undefined) {
      const task = this.#waiting.shift()!;
      this.#running++;
      void this.#run(task);
    }
  }

  async #run(task: Task): Promise<void> {
    try {
      await task();
    } catch (err) {
      if (this.#error === undefined) {
        this.#error = { value: err };
        this.#waiting.length = 0;
      }
    } finally {
      this.#running--;
      this.#wakeAcceptWaiters();
      this.#pump();
      if (this.#running === 0 && this.#waiting.length === 0) {
        const idle = this.#idleWaiters;
        this.#idleWaiters = [];
        for (const resolve of idle) resolve();
      }
    }
  }

  #wakeAcceptWaiters(): void {
    const waiters = this.#acceptWaiters;
    this.#acceptWaiters = [];
    for (const resolve of waiters) resolve();
  }

  #waitForIdle(): Promise<void> {
    if (this.#running === 0 && this.#waiting.length === 0) return Promise.resolve();
    return new Promise<void>((resolve) => this.#idleWaiters.push(resolve));
  }
}
