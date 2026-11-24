import http from 'node:http';
import crypto from 'node:crypto';
import { chmodSync, readFileSync, rmSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { validateUrl } from './lib/url.mjs';
import { JobLock } from './lib/lock.mjs';
import { JobError } from './lib/errors.mjs';
import { runJob as defaultRunJob } from './lib/pipeline.mjs';

export const TOTAL_TIMEOUT_MS = 150_000;
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

// Crea el servidor. Las dependencias (runJob, lock) se inyectan para las pruebas.
export function createServer({ config, runJob = defaultRunJob, lock = new JobLock(), log = console.log } = {}) {
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

    if (!lock.tryAcquire()) return send(res, 429, { ok: false, reason: 'busy' });

    const ctl = new AbortController();
    let timer;
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => {
        const e = new JobError('timeout', 504, `supero ${TOTAL_TIMEOUT_MS / 1000} s`);
        ctl.abort(e);
        reject(e);
      }, TOTAL_TIMEOUT_MS);
    });
    deadline.catch(() => {});

    try {
      const result = await Promise.race([
        runJob({ config, url: v.url, platform: v.platform, signal: ctl.signal }),
        deadline,
      ]);
      logJob({ route: '/extract', platform: v.platform, host: new URL(v.url).host, ok: true, id: result.id, totalMs: Date.now() - started, timings: result.timings });
      return send(res, 200, { ok: true, ...result });
    } catch (err) {
      const jobErr = err instanceof JobError ? err : new JobError('internal', 500, String(err?.message ?? err).slice(0, 300));
      logJob({ route: '/extract', platform: v.platform, host: new URL(v.url).host, ok: false, reason: jobErr.reason, detail: jobErr.detail.slice(0, 300), totalMs: Date.now() - started });
      return send(res, jobErr.status, { ok: false, reason: jobErr.reason, detail: jobErr.detail.slice(0, 300) });
    } finally {
      clearTimeout(timer);
      lock.release();
    }
  }

  return http.createServer(async (req, res) => {
    try {
      const path = new URL(req.url || '/', 'http://x').pathname;
      if (req.method === 'GET' && path === '/health') {
        return send(res, 200, { ok: true, version: VERSION, busy: lock.busy });
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
