import { JobError } from './errors.mjs';

// Fila FIFO con un número fijo de lugares. acquire() espera su turno y resuelve con una función release de un solo uso;
// rechaza con JobError('busy', 429) si la fila está llena o venció la espera, y con 'aborted' si el cliente se fue.
export class JobQueue {
  #running = 0;
  #waiting = [];

  constructor({ slots = 2, maxWaiting = 4, waitMs = 60_000 } = {}) {
    this.slots = slots;
    this.maxWaiting = maxWaiting;
    this.waitMs = waitMs;
  }

  get running() {
    return this.#running;
  }

  get waiting() {
    return this.#waiting.length;
  }

  get busy() {
    return this.#running >= this.slots;
  }

  #take() {
    this.#running++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.#running--;
      this.#waiting.shift()?.grant();
    };
  }

  acquire(signal) {
    if (signal?.aborted) return Promise.reject(new JobError('aborted', 499));
    if (this.#running < this.slots) return Promise.resolve(this.#take());
    if (this.#waiting.length >= this.maxWaiting) return Promise.reject(new JobError('busy', 429));
    return new Promise((resolve, reject) => {
      const entry = {
        grant: () => {
          done();
          resolve(this.#take());
        },
      };
      const leave = (err) => {
        done();
        const i = this.#waiting.indexOf(entry);
        if (i >= 0) this.#waiting.splice(i, 1);
        reject(err);
      };
      const onAbort = () => leave(new JobError('aborted', 499));
      const timer = setTimeout(() => leave(new JobError('busy', 429)), this.waitMs);
      const done = () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      this.#waiting.push(entry);
    });
  }
}
