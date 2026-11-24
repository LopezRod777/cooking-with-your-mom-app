import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { run } from '../lib/exec.mjs';
import { putOnce } from '../lib/blob.mjs';
import { BlobNotFoundError } from '@vercel/blob';

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

test('abortar mata también a los hijos y rechaza cuando ya no corren', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'exec-'));
  const pidFile = path.join(dir, 'pid');
  const ctl = new AbortController();
  // El shell lanza un hijo (como yt-dlp lanza ffmpeg) y lo espera.
  const p = run('/bin/sh', ['-c', `sleep 300 & echo $! > ${pidFile}; wait`], { signal: ctl.signal });
  let pid = 0;
  while (!pid) {
    pid = Number(await fs.readFile(pidFile, 'utf8').catch(() => '0'));
    await new Promise((r) => setTimeout(r, 10));
  }
  assert.equal(alive(pid), true);
  const t0 = Date.now();
  ctl.abort();
  await assert.rejects(p, (e) => e.code === 'aborted');
  assert.ok(Date.now() - t0 < 5000);
  for (let i = 0; i < 50 && alive(pid); i++) await new Promise((r) => setTimeout(r, 10));
  assert.equal(alive(pid), false);
  await fs.rm(dir, { recursive: true });
});

test('timeout rechaza con su código; un binario que no existe rechaza', async () => {
  await assert.rejects(run('/bin/sleep', ['30'], { timeoutMs: 50 }), (e) => e.code === 'timeout');
  await assert.rejects(run('/no/existe', []), (e) => e.code === 'ENOENT');
});

test('dos imports del mismo video: el que pierde la carrera usa la copia del otro', async () => {
  let n = 0;
  const api = {
    head: async () => {
      if (n++ === 0) throw new BlobNotFoundError();
      return { url: 'https://blob/ganador.mp4' };
    },
    put: async () => { throw new Error('This blob already exists'); },
  };
  const file = new URL(import.meta.url).pathname;
  assert.deepEqual(await putOnce({ token: 't', pathname: 'a.mp4', file, contentType: 'video/mp4', api }), { url: 'https://blob/ganador.mp4', reused: true });
});

test('una subida que falla de verdad sigue fallando', async () => {
  const api = { head: async () => { throw new BlobNotFoundError(); }, put: async () => { throw new Error('sin red'); } };
  const file = new URL(import.meta.url).pathname;
  await assert.rejects(putOnce({ token: 't', pathname: 'a.mp4', file, contentType: 'video/mp4', api }), (e) => e.reason === 'blob_failed');
});

test('con la señal ya abortada no arranca nada y rechaza', async () => {
  const marker = path.join(os.tmpdir(), `cwym-no-${process.pid}`);
  await assert.rejects(run('/usr/bin/touch', [marker], { signal: AbortSignal.abort() }), (e) => e.code === 'aborted');
  await new Promise((r) => setTimeout(r, 50));
  await assert.rejects(fs.stat(marker));
});
