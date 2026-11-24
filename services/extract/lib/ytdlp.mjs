import fs from 'node:fs/promises';
import path from 'node:path';
import { run } from './exec.mjs';
import { JobError, wrapStep } from './errors.mjs';

// Video vertical: TikTok es 9:16, así que el filtro es por ancho (width), no por alto.
export const FORMAT_SELECTOR = 'bv*[width<=720][ext=mp4]+ba[ext=m4a]/b[width<=720][ext=mp4]/b';
export const MAX_FILESIZE = '60m';
export const MAX_BYTES = 60 * 1024 * 1024;

const META_TIMEOUT_MS = 120_000;
const DOWNLOAD_TIMEOUT_MS = 150_000;
const THUMB_TIMEOUT_MS = 60_000;

const handleFromUrl = (s) => {
  const m = String(s ?? '').match(/\/@([^/?#]+)/);
  return m ? m[1] : null;
};

// Metadatos sin descargar el video.
export async function fetchMeta({ bin, url, signal }) {
  return wrapStep('ytdlp_failed', 502, async () => {
    const { stdout } = await run(
      bin,
      ['--dump-single-json', '--no-playlist', '--skip-download', '--no-warnings', url],
      { timeoutMs: META_TIMEOUT_MS, signal },
    );
    const j = JSON.parse(stdout);
    const id = String(j.id ?? '');
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) throw new JobError('ytdlp_failed', 502, 'id no valido');
    return {
      id,
      webpageUrl: j.webpage_url || url,
      title: j.title ?? '',
      description: j.description ?? '',
      author: j.uploader || j.channel || '',
      authorHandle: handleFromUrl(j.webpage_url || url) || (j.uploader_id ? String(j.uploader_id) : null),
      likes: j.like_count ?? null,
      views: j.view_count ?? null,
      comments: j.comment_count ?? null,
      durationS: typeof j.duration === 'number' ? j.duration : null,
    };
  });
}

// Descarga el video con FORMAT_SELECTOR a outFile (.mp4). Revisa tamaño real después.
export async function download({ bin, url, outFile, signal }) {
  try {
    await run(
      bin,
      [
        '-f', FORMAT_SELECTOR,
        '--merge-output-format', 'mp4',
        '--max-filesize', MAX_FILESIZE,
        '--no-playlist',
        '--no-warnings',
        '-o', outFile,
        url,
      ],
      { timeoutMs: DOWNLOAD_TIMEOUT_MS, signal },
    );
  } catch (err) {
    const stderr = String(err.stderr ?? '');
    if (/max-filesize|larger than max|file is larger/i.test(stderr)) {
      throw new JobError('too_large', 413, 'video mayor a 60 MB');
    }
    const last = stderr.trim().split('\n').pop() || err.code || 'error';
    throw new JobError('ytdlp_failed', 502, last.slice(0, 300));
  }
  const stat = await fs.stat(outFile).catch(() => null);
  if (!stat) throw new JobError('ytdlp_failed', 502, 'no se generó el archivo');
  if (stat.size > MAX_BYTES) throw new JobError('too_large', 413, 'video mayor a 60 MB');
  return { bytes: stat.size };
}

// Duración y formato reales con ffprobe (la metadata de Instagram puede traer duration null).
export async function probeMedia({ bin, file, signal }) {
  return wrapStep('ytdlp_failed', 502, async () => {
    const { stdout } = await run(
      bin,
      ['-v', 'error', '-print_format', 'json', '-show_entries', 'format=duration,format_name', file],
      { timeoutMs: 30_000, signal },
    );
    const f = JSON.parse(stdout).format ?? {};
    const d = Number(f.duration);
    return {
      durationS: Number.isFinite(d) ? d : null,
      formatName: String(f.format_name ?? ''),
    };
  });
}

// Miniatura: yt-dlp primero; si falla, un fotograma de ffmpeg. Devuelve ruta jpg o null (no falla el trabajo).
export async function thumbnail({ bin, ffmpeg, url, dir, id, mp4, signal }) {
  const jpg = path.join(dir, `${id}.jpg`);
  try {
    await run(
      bin,
      [
        '--skip-download', '--write-thumbnail', '--convert-thumbnails', 'jpg',
        '--no-playlist', '--no-warnings',
        '-o', path.join(dir, `${id}.%(ext)s`),
        url,
      ],
      { timeoutMs: THUMB_TIMEOUT_MS, signal },
    );
    if (await fs.stat(jpg).catch(() => null)) return jpg;
  } catch {
    // cae al fallback
  }
  try {
    await run(ffmpeg, ['-y', '-ss', '1', '-i', mp4, '-frames:v', '1', jpg], { timeoutMs: 30_000, signal });
    if (await fs.stat(jpg).catch(() => null)) return jpg;
  } catch {
    // sin miniatura
  }
  return null;
}
