// Mutex de un solo trabajo a la vez. tryAcquire() devuelve false si ya hay uno corriendo.
export class JobLock {
  #busy = false;

  get busy() {
    return this.#busy;
  }

  tryAcquire() {
    if (this.#busy) return false;
    this.#busy = true;
    return true;
  }

  release() {
    this.#busy = false;
  }
}
