import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../server.mjs';
import { JobQueue } from '../lib/lock.mjs';

const SECRET = 'test-secret-123';
const TIKTOK = 'https://www.tiktok.com/@doosifit/video/7183118805290339627';

async function start(runJob, { queue = {}, ...opts } = {}) {
  const logs = [];
  const server = createServer({
    config: { secret: SECRET },
    runJob,
    lock: new JobQueue(queue),
    log: (line) => logs.push(line),
    ...opts,
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

// Trabajos que se quedan abiertos hasta que la prueba los suelta, en orden de arranque.
function held() {
  const jobs = [];
  const seen = [];
  const runJob = ({ url, signal }) => new Promise((resolve, reject) => {
    seen.push(url);
    jobs.push({ url, signal, done: () => resolve({ id: url.split('/').pop() }), fail: reject });
  });
  return { runJob, jobs, seen };
}
const video = (n) => `https://www.tiktok.com/@a/video/${n}`;
const until = async (ok, ms = 3000) => {
  const end = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > end) throw new Error('no llegó a tiempo');
    await new Promise((r) => setTimeout(r, 5));
  }
};
const health = async (s) => (await fetch(`${s.base}/health`)).json();

test('dos a la vez, el tercero espera y entra cuando se suelta un lugar', async () => {
  const h = held();
  const s = await start(h.runJob);
  try {
    const a = post(s.base, { url: video(1) });
    await until(() => h.jobs.length === 1);
    const b = post(s.base, { url: video(2) });
    await until(() => h.jobs.length === 2);
    const c = post(s.base, { url: video(3) });
    let st;
    do st = await health(s); while (st.waiting !== 1);
    assert.deepEqual([st.busy, st.running, st.waiting], [true, 2, 1]);
    assert.equal(h.jobs.length, 2);
    h.jobs[0].done();
    assert.equal((await (await a).json()).id, '1');
    await until(() => h.jobs.length === 3);
    h.jobs[1].done();
    h.jobs[2].done();
    assert.equal((await b).status, 200);
    assert.equal((await (await c).json()).id, '3');
    const after = await health(s);
    assert.deepEqual([after.busy, after.running, after.waiting], [false, 0, 0]);
  } finally {
    await s.stop();
  }
});

test('fila llena o espera vencida responde 429 busy sin correr', async () => {
  const h = held();
  const s = await start(h.runJob, { queue: { slots: 1, maxWaiting: 1, waitMs: 150 } });
  try {
    const a = post(s.base, { url: video(1) });
    await until(() => h.jobs.length === 1);
    const b = post(s.base, { url: video(2) });
    while ((await health(s)).waiting !== 1);
    const full = await post(s.base, { url: video(3) });
    assert.equal(full.status, 429);
    assert.deepEqual(await full.json(), { ok: false, reason: 'busy' });
    const late = await b;
    assert.equal(late.status, 429);
    assert.deepEqual(await late.json(), { ok: false, reason: 'busy' });
    assert.deepEqual(h.seen, [video(1)]);
    h.jobs[0].done();
    assert.equal((await a).status, 200);
  } finally {
    await s.stop();
  }
});

test('la fila respeta el orden de llegada', async () => {
  const h = held();
  const s = await start(h.runJob, { queue: { slots: 1 } });
  try {
    const all = [];
    for (const n of [1, 2, 3, 4]) {
      all.push(post(s.base, { url: video(n) }));
      if (n === 1) await until(() => h.jobs.length === 1);
      else while ((await health(s)).waiting !== n - 1);
    }
    for (let i = 0; i < 4; i++) {
      await until(() => h.jobs.length === i + 1);
      h.jobs[i].done();
    }
    await Promise.all(all);
    assert.deepEqual(h.seen, [1, 2, 3, 4].map(video));
  } finally {
    await s.stop();
  }
});

test('quien se va de la fila no corre ni ocupa lugar', async () => {
  const h = held();
  const s = await start(h.runJob, { queue: { slots: 1 } });
  try {
    const a = post(s.base, { url: video(1) });
    await until(() => h.jobs.length === 1);
    const ctl = new AbortController();
    const gone = fetch(`${s.base}/extract`, { method: 'POST', headers: { Authorization: `Bearer ${SECRET}` }, body: JSON.stringify({ url: video(2) }), signal: ctl.signal }).catch(() => 'left');
    while ((await health(s)).waiting !== 1);
    ctl.abort();
    assert.equal(await gone, 'left');
    while ((await health(s)).waiting !== 0);
    h.jobs[0].done();
    assert.equal((await a).status, 200);
    assert.deepEqual(h.seen, [video(1)]);
    assert.equal((await health(s)).running, 0);
  } finally {
    await s.stop();
  }
});

test('quien se va a media corrida aborta el trabajo; el lugar se suelta hasta que el trabajo termina', async () => {
  const h = held();
  const s = await start(h.runJob, { queue: { slots: 1 } });
  try {
    const ctl = new AbortController();
    const gone = fetch(`${s.base}/extract`, { method: 'POST', headers: { Authorization: `Bearer ${SECRET}` }, body: JSON.stringify({ url: video(1) }), signal: ctl.signal }).catch(() => 'left');
    await until(() => h.jobs.length === 1);
    const b = post(s.base, { url: video(2) });
    while ((await health(s)).waiting !== 1);
    ctl.abort();
    await gone;
    await until(() => h.jobs[0].signal.aborted);
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(h.jobs.length, 1, 'la limpieza del primero sigue: nadie más entra');
    h.jobs[0].fail(new Error('abortado'));
    await until(() => h.jobs.length === 2);
    h.jobs[1].done();
    assert.equal((await b).status, 200);
  } finally {
    await s.stop();
  }
});

test('vencido el plazo responde 504 ya, y el lugar espera a que termine la limpieza', async () => {
  const h = held();
  const s = await start(h.runJob, { queue: { slots: 1 }, totalMs: 60 });
  try {
    const a = await post(s.base, { url: video(1) });
    assert.equal(a.status, 504);
    assert.equal((await a.json()).reason, 'timeout');
    assert.equal((await health(s)).running, 1);
    h.jobs[0].done();
    while ((await health(s)).running !== 0);
  } finally {
    await s.stop();
  }
});

test('un trabajo que ignora el aborto dispara el reinicio', async () => {
  const h = held();
  let stuck = 0;
  const s = await start(h.runJob, { totalMs: 30, stuckMs: 60, onStuck: () => { stuck++; } });
  try {
    assert.equal((await post(s.base, { url: video(1) })).status, 504);
    await until(() => stuck === 1);
    h.jobs[0].done();
    const ok = post(s.base, { url: video(2) });
    await until(() => h.jobs.length === 2);
    h.jobs[1].done();
    assert.equal((await ok).status, 200);
    await new Promise((r) => setTimeout(r, 120));
    assert.equal(stuck, 1, 'uno que termina bien no reinicia nada');
  } finally {
    await s.stop();
  }
});

test('soltar dos veces el mismo lugar no abre otro', async () => {
  const q = new JobQueue({ slots: 1 });
  const release = await q.acquire();
  release();
  release();
  assert.equal(q.running, 0);
  await q.acquire();
  assert.equal(q.busy, true);
});

test('nunca más de dos a la vez con 20 peticiones, con fallas mezcladas', async () => {
  let now = 0;
  let max = 0;
  const s = await start(async ({ url }) => {
    max = Math.max(max, ++now);
    await new Promise((r) => setTimeout(r, 5));
    now--;
    if (Number(url.split('/').pop()) % 3 === 0) throw new Error('falla');
    return { id: 'x' };
  }, { queue: { maxWaiting: 30 } });
  try {
    const rs = await Promise.all(Array.from({ length: 20 }, (_, i) => post(s.base, { url: video(i + 1) })));
    assert.equal(max, 2);
    assert.deepEqual(rs.map((r) => r.status).sort(), [...Array(14).fill(200), ...Array(6).fill(500)]);
    assert.equal((await health(s)).running, 0);
  } finally {
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
