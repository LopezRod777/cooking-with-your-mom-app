import fs from 'node:fs/promises';
import { put, head, BlobNotFoundError } from '@vercel/blob';
import { JobError } from './errors.mjs';

const ONE_YEAR_S = 365 * 24 * 60 * 60;

// Sube un archivo público si no existe ya. Si head() lo encuentra, reutiliza su URL.
export async function putOnce({ token, pathname, file, contentType, signal, api = { put, head } }) {
  try {
    const existing = await api.head(pathname, { token, abortSignal: signal });
    return { url: existing.url, reused: true };
  } catch (err) {
    if (!(err instanceof BlobNotFoundError)) {
      throw new JobError('blob_failed', 502, String(err?.message ?? err).slice(0, 300));
    }
  }
  try {
    const body = await fs.readFile(file);
    const res = await api.put(pathname, body, {
      access: 'public',
      addRandomSuffix: false,
      cacheControlMaxAge: ONE_YEAR_S,
      contentType,
      token,
      abortSignal: signal,
    });
    return { url: res.url, reused: false };
  } catch (err) {
    // Otro import del mismo video lo subió primero: se usa esa copia.
    const winner = await api.head(pathname, { token, abortSignal: signal }).catch(() => null);
    if (winner) return { url: winner.url, reused: true };
    throw new JobError('blob_failed', 502, String(err?.message ?? err).slice(0, 300));
  }
}
