import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../server.mjs';
import { JobLock } from '../lib/lock.mjs';

const SECRET = 'test-secret-123';
const TIKTOK = 'https://www.tiktok.com/@doosifit/video/7183118805290339627';

async function start(runJob) {
  const logs = [];
  const server = createServer({
    config: { secret: SECRET },
    runJob,
    lock: new JobLock(),
    log: (line) => logs.push(line),
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const stop = () => new Promise((r) => { server.close(r); server.closeAllConnections(); });
  return { base, stop, logs };
}

const post = (base, body, token = SECRET) =>
  fetch(`${base}/extract`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });

test('health responde ok, version y busy', async () => {
  const s = await start(async () => ({}));
  try {
    const r = await fetch(`${s.base}/health`);
    const j = await r.json();
    assert.equal(r.status, 200);
    assert.equal(j.ok, true);
    assert.equal(typeof j.version, 'string');
    assert.equal(j.busy, false);
  } finally {
    await s.stop();
  }
});

test('extract sin o con secreto incorrecto responde 401', async () => {
  const s = await start(async () => ({}));
  try {
    const none = await fetch(`${s.base}/extract`, { method: 'POST', body: '{}' });
    assert.equal(none.status, 401);
    const bad = await post(s.base, { url: TIKTOK }, 'otro');
    assert.equal(bad.status, 401);
    assert.equal((await bad.json()).reason, 'unauthorized');
  } finally {
    await s.stop();
  }
});

test('URL de host no permitido responde 400 unsupported_host sin correr el pipeline', async () => {
  let called = false;
  const s = await start(async () => { called = true; return {}; });
  try {
    const r = await post(s.base, { url: 'https://example.com/x' });
    assert.equal(r.status, 400);
    assert.equal((await r.json()).reason, 'unsupported_host');
    assert.equal(called, false);
  } finally {
    await s.stop();
  }
});

test('segunda llamada concurrente responde 429 busy; la primera termina bien', async () => {
  let release;
  let started;
  const startedP = new Promise((r) => { started = r; });
  const s = await start(async ({ url }) => {
    started();
    await new Promise((r) => { release = r; });
    return { id: 'abc', url };
  });
  try {
    const first = post(s.base, { url: TIKTOK });
    await startedP;
    const second = await post(s.base, { url: TIKTOK });
    assert.equal(second.status, 429);
    assert.deepEqual(await second.json(), { ok: false, reason: 'busy' });

    const health = await (await fetch(`${s.base}/health`)).json();
    assert.equal(health.busy, true);

    release();
    const r1 = await first;
    assert.equal(r1.status, 200);
    const j1 = await r1.json();
    assert.equal(j1.ok, true);
    assert.equal(j1.id, 'abc');

    const after = await (await fetch(`${s.base}/health`)).json();
    assert.equal(after.busy, false);
  } finally {
    if (release) release();
    await s.stop();
  }
});

test('error del pipeline con razon JobError se devuelve con su status', async () => {
  const { JobError } = await import('../lib/errors.mjs');
  const s = await start(async () => { throw new JobError('too_long', 413, 'demasiado'); });
  try {
    const r = await post(s.base, { url: TIKTOK });
    assert.equal(r.status, 413);
    assert.equal((await r.json()).reason, 'too_long');
    assert.equal(s.logs.length, 1);
  } finally {
    await s.stop();
  }
});
