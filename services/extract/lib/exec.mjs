import { spawn } from 'node:child_process';

// Ejecuta un binario sin shell. Mata el proceso si vence el timeout o si se aborta la señal.
// Resuelve { stdout, stderr } si sale con 0; si no, rechaza con err.code ('exit' | 'timeout' | 'aborted' | 'output_too_big').
export function run(bin, args, { timeoutMs, signal, maxBytes = 64 * 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const out = [];
    const err = [];
    let size = 0;
    let done = false;
    let timer = null;

    const finish = (error, value) => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      if (error) reject(error);
      else resolve(value);
    };
    const kill = (code) => {
      try { child.kill('SIGKILL'); } catch { /* ya terminó */ }
      const e = new Error(`${bin} ${code}`);
      e.code = code;
      finish(e);
    };
    const onAbort = () => kill('aborted');

    if (timeoutMs) timer = setTimeout(() => kill('timeout'), timeoutMs);
    if (signal?.aborted) return kill('aborted');
    signal?.addEventListener('abort', onAbort, { once: true });

    child.stdout.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) return kill('output_too_big');
      out.push(chunk);
    });
    child.stderr.on('data', (chunk) => err.push(chunk));
    child.on('error', (e) => finish(e));
    child.on('close', (code) => {
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
