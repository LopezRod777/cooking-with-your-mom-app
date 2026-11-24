import http from 'node:http';
import crypto from 'node:crypto';
import { chmodSync, readFileSync, rmSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { validateUrl } from './lib/url.mjs';
import { JobQueue } from './lib/lock.mjs';
import { JobError } from './lib/errors.mjs';
import { runJob as defaultRunJob } from './lib/pipeline.mjs';

// The app waits 155 s in all: 60 in line plus 90 working, so a job that got its turn last still has time to answer.
export const TOTAL_TIMEOUT_MS = 90_000;
// A slot is only given back when the job really ended. One that ignores its abort this long would hold the slot for good.
export const STUCK_AFTER_ABORT_MS = 60_000;
const MAX_BODY_BYTES = 64 * 1024;

const VERSION = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version;

export function loadConfig(env = process.env) {
  return {
    secret: env.EXTRACT_SECRET || '',
    blobToken: env.BLOB_READ_WRITE_TOKEN || '',
    geminiKey: env.GEMINI_API_KEY || '',
    port: Number(env.PORT || 8787),
    bind: env.BIND || '127.0.0.1',
    // Unix socket path. When set, the service listens only there, so its unit can deny all loopback traffic.
    socket: env.SOCKET || '',
    ytdlp: env.YTDLP || 'yt-dlp',
    ffmpeg: env.FFMPEG || '/usr/bin/ffmpeg',
    ffprobe: env.FFPROBE || '/usr/bin/ffprobe',
  };
}

// Comparación en tiempo constante: se comparan los hashes para no filtrar la longitud del secreto.
function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb) && String(a).length === String(b).length;
}

function send(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(data) });
  res.end(data);
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new JobError('invalid_json', 413, 'body demasiado grande');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

// Un trabajo que no termina ni abortado: systemd reinicia el servicio y mata a sus procesos hijos.
function restart() {
  process.exit(1);
}

// Crea el servidor. Las dependencias se inyectan para las pruebas.
export function createServer({
  config,
  runJob = defaultRunJob,
  lock = new JobQueue(),
  log = console.log,
  totalMs = TOTAL_TIMEOUT_MS,
  stuckMs = STUCK_AFTER_ABORT_MS,
  onStuck = restart,
} = {}) {
  const logJob = (fields) => log(JSON.stringify({ ts: new Date().toISOString(), ...fields }));

  async function handleExtract(req, res) {
    const started = Date.now();
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    if (!config.secret || !token || !safeEqual(token, config.secret)) {
      return send(res, 401, { ok: false, reason: 'unauthorized' });
    }

    let body;
    try {
      body = JSON.parse((await readBody(req)) || '{}');
    } catch (err) {
      if (err instanceof JobError) return send(res, err.status, { ok: false, reason: err.reason });
      return send(res, 400, { ok: false, reason: 'invalid_json' });
    }

    const v = validateUrl(body?.url);
    if (!v.ok) return send(res, 400, { ok: false, reason: v.reason });

    // Cancelled when the job runs out of time or the caller hangs up (in line or while it works).
    const ctl = new AbortController();
    let stop;
    const stopped = new Promise((_, reject) => {
      stop = (err) => {
        ctl.abort(err);
        reject(err);
      };
    });
    stopped.catch(() => {});
    const onClose = () => {
      if (!res.writableEnded) stop(new JobError('aborted', 499));
    };
    res.on('close', onClose);
    if (res.destroyed) onClose();

    let timer;
    let waitMs = 0;
    try {
      const release = await lock.acquire(ctl.signal);
      waitMs = Date.now() - started;
      timer = setTimeout(() => stop(new JobError('timeout', 504, `supero ${totalMs / 1000} s`)), totalMs);
      const job = (async () => runJob({ config, url: v.url, platform: v.platform, signal: ctl.signal }))();
      let stuck;
      const watch = () => {
        stuck = setTimeout(() => {
          logJob({ route: '/extract', ok: false, reason: 'stuck', totalMs: Date.now() - started });
          onStuck();
        }, stuckMs);
      };
      ctl.signal.addEventListener('abort', watch, { once: true });
      const ended = () => {
        ctl.signal.removeEventListener('abort', watch);
        clearTimeout(stuck);
        release();
      };
      job.then(ended, ended);
      const result = await Promise.race([job, stopped]);
      logJob({ route: '/extract', platform: v.platform, host: new URL(v.url).host, ok: true, id: result.id, totalMs: Date.now() - started, waitMs, timings: result.timings });
      return send(res, 200, { ok: true, ...result });
    } catch (err) {
      const jobErr = err instanceof JobError ? err : new JobError('internal', 500, String(err?.message ?? err).slice(0, 300));
      logJob({ route: '/extract', platform: v.platform, host: new URL(v.url).host, ok: false, reason: jobErr.reason, detail: jobErr.detail.slice(0, 300), totalMs: Date.now() - started, waitMs });
      if (res.destroyed) return undefined;
      // Busy carries no detail, as before.
      return send(res, jobErr.status, jobErr.reason === 'busy' ? { ok: false, reason: 'busy' } : { ok: false, reason: jobErr.reason, detail: jobErr.detail.slice(0, 300) });
    } finally {
      clearTimeout(timer);
      res.off('close', onClose);
    }
  }

  return http.createServer(async (req, res) => {
    try {
      const path = new URL(req.url || '/', 'http://x').pathname;
      if (req.method === 'GET' && path === '/health') {
        return send(res, 200, { ok: true, version: VERSION, busy: lock.busy, running: lock.running, waiting: lock.waiting });
      }
      if (req.method === 'POST' && path === '/extract') {
        return await handleExtract(req, res);
      }
      return send(res, 404, { ok: false, reason: 'not_found' });
    } catch (err) {
      logJob({ route: 'internal', ok: false, reason: 'internal', detail: String(err?.message ?? err).slice(0, 300) });
      if (!res.headersSent) send(res, 500, { ok: false, reason: 'internal' });
    }
  });
}

function main() {
  const config = loadConfig();
  const missing = ['secret', 'blobToken', 'geminiKey'].filter((k) => !config[k]);
  if (missing.length) {
    console.error(`faltan variables de entorno: ${missing.map((k) => ({ secret: 'EXTRACT_SECRET', blobToken: 'BLOB_READ_WRITE_TOKEN', geminiKey: 'GEMINI_API_KEY' })[k]).join(', ')}`);
    process.exit(1);
  }
  const server = createServer({ config });
  if (config.socket) {
    rmSync(config.socket, { force: true });
    server.listen(config.socket, () => {
      chmodSync(config.socket, 0o660);
      console.log(JSON.stringify({ ts: new Date().toISOString(), event: 'listening', version: VERSION, socket: config.socket }));
    });
    return;
  }
  server.listen(config.port, config.bind, () => {
    console.log(JSON.stringify({ ts: new Date().toISOString(), event: 'listening', version: VERSION, bind: config.bind, port: config.port }));
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
