// Error con razón legible para el cliente. `status` es el HTTP que devuelve el servidor.
export class JobError extends Error {
  constructor(reason, status = 500, detail = '') {
    super(detail || reason);
    this.name = 'JobError';
    this.reason = reason;
    this.status = status;
    this.detail = detail;
  }
}

// Envuelve cualquier error inesperado de un paso como JobError(reason).
export async function wrapStep(reason, status, fn) {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof JobError) throw err;
    throw new JobError(reason, status, String(err?.message ?? err).slice(0, 300));
  }
}
