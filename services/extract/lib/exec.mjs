import { spawn } from 'node:child_process';

// Ejecuta un binario sin shell, en su propio grupo: al vencer el timeout o abortarse la señal se mata el grupo entero
// (yt-dlp lanza ffmpeg) y la promesa se rechaza hasta que el proceso cerró de verdad.
// Resuelve { stdout, stderr } si sale con 0; si no, rechaza con err.code ('exit' | 'timeout' | 'aborted' | 'output_too_big').
export function run(bin, args, { timeoutMs, signal, maxBytes = 64 * 1024 * 1024 } = {}) {
  // Nothing is started for a job that was already cancelled.
  if (signal?.aborted) return Promise.reject(Object.assign(new Error(`${bin} aborted`), { code: 'aborted' }));
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    const out = [];
    const err = [];
    let size = 0;
    let done = false;
    let timer = null;
    let killed = null;

    const finish = (error, value) => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      if (error) reject(error);
      else resolve(value);
    };
    const kill = (code) => {
      if (killed) return;
      killed = new Error(`${bin} ${code}`);
      killed.code = code;
      try { process.kill(-child.pid, 'SIGKILL'); } catch { /* ya terminó */ }
    };
    const onAbort = () => kill('aborted');

    if (timeoutMs) timer = setTimeout(() => kill('timeout'), timeoutMs);
    signal?.addEventListener('abort', onAbort, { once: true });

    child.stdout.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) return kill('output_too_big');
      out.push(chunk);
    });
    child.stderr.on('data', (chunk) => err.push(chunk));
    child.on('error', (e) => finish(killed ?? e));
    child.on('close', (code) => {
      if (killed) return finish(killed);
      const stdout = Buffer.concat(out).toString('utf8');
      const stderr = Buffer.concat(err).toString('utf8');
      if (code === 0) return finish(null, { stdout, stderr });
      const e = new Error(`${bin} exit ${code}`);
      e.code = 'exit';
      e.exitCode = code;
      e.stderr = stderr;
      finish(e);
    });
  });
}
