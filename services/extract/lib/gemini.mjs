import fs from 'node:fs/promises';
import { JobError } from './errors.mjs';

const BASE = 'https://generativelanguage.googleapis.com';
const MODEL = 'gemini-3.5-flash';
const ACTIVE_WAIT_MS = 90_000;
const REQUEST_TIMEOUT_MS = 120_000;

export const PROMPT =
  'Watch this cooking video. Return JSON with keys: transcript (everything spoken, verbatim, original language), ' +
  'onScreenText (all text shown on screen, in order, deduplicated), ingredients (array of strings with quantities ' +
  'exactly as said or shown), steps (array of short imperative sentences in the order performed), dish (short name), ' +
  'notes (temperatures, times, substitutions). Use empty strings or arrays when absent. Do not invent.';

const toArray = (v) => {
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
  if (typeof v === 'string' && v.trim()) return [v.trim()];
  return [];
};
const toStr = (v) => {
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.map((x) => String(x)).join('\n');
  return '';
};

// Normaliza la respuesta del modelo. onScreenText se devuelve como lista (decisión del servicio).
export function normalizeAnalysis(o) {
  const obj = o && typeof o === 'object' ? o : {};
  return {
    transcript: toStr(obj.transcript),
    onScreenText: toArray(obj.onScreenText),
    ingredients: toArray(obj.ingredients),
    steps: toArray(obj.steps),
    dish: toStr(obj.dish),
    notes: toStr(obj.notes),
  };
}

// Acepta JSON directo o envuelto en ```json ... ``` (o con texto alrededor).
export function parseGeminiJson(text) {
  let s = String(text ?? '').trim();
  const fence = s.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fence) s = fence[1];
  let parsed;
  try {
    parsed = JSON.parse(s);
  } catch {
    const a = s.indexOf('{');
    const b = s.lastIndexOf('}');
    if (a === -1 || b <= a) throw new JobError('gemini_bad_json', 502, 'respuesta sin JSON');
    try {
      parsed = JSON.parse(s.slice(a, b + 1));
    } catch {
      throw new JobError('gemini_bad_json', 502, 'JSON invalido');
    }
  }
  return normalizeAnalysis(parsed);
}

const timeout = (signal) =>
  signal ? AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]) : AbortSignal.timeout(REQUEST_TIMEOUT_MS);

async function apiError(res, label) {
  let msg = '';
  try {
    msg = (await res.json())?.error?.message ?? '';
  } catch {
    // sin cuerpo JSON
  }
  return new JobError('gemini_failed', 502, `${label} HTTP ${res.status}${msg ? `: ${String(msg).slice(0, 200)}` : ''}`);
}

// Sube el mp4 con el protocolo resumable de la Files API. Devuelve { name, uri, mimeType }.
export async function uploadVideo({ apiKey, file, displayName, signal }) {
  const bytes = await fs.readFile(file);
  const start = await fetch(`${BASE}/upload/v1beta/files?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: {
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(bytes.length),
      'X-Goog-Upload-Header-Content-Type': 'video/mp4',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ file: { display_name: displayName } }),
    signal: timeout(signal),
  });
  if (!start.ok) throw await apiError(start, 'upload start');
  const uploadUrl = start.headers.get('x-goog-upload-url');
  if (!uploadUrl) throw new JobError('gemini_failed', 502, 'sin X-Goog-Upload-URL');

  const up = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'X-Goog-Upload-Offset': '0',
      'X-Goog-Upload-Command': 'upload, finalize',
      'Content-Type': 'video/mp4',
    },
    body: bytes,
    signal: timeout(signal),
  });
  if (!up.ok) throw await apiError(up, 'upload');
  const { file: f } = await up.json();
  if (!f?.name || !f?.uri) throw new JobError('gemini_failed', 502, 'upload sin file.name');
  return { name: f.name, uri: f.uri, mimeType: f.mimeType || 'video/mp4', state: f.state };
}

// Espera hasta que el archivo esté ACTIVE (máximo 90 s).
export async function waitActive({ apiKey, name, signal }) {
  const deadline = Date.now() + ACTIVE_WAIT_MS;
  for (;;) {
    const res = await fetch(`${BASE}/v1beta/${name}?key=${encodeURIComponent(apiKey)}`, { signal: timeout(signal) });
    if (!res.ok) throw await apiError(res, 'files.get');
    const f = await res.json();
    if (f.state === 'ACTIVE') return;
    if (f.state === 'FAILED') throw new JobError('gemini_failed', 502, 'Gemini no pudo procesar el video');
    if (Date.now() > deadline) throw new JobError('gemini_failed', 502, 'video no ACTIVE en 90 s');
    signal?.throwIfAborted();
    await new Promise((r) => setTimeout(r, 500));
  }
}

// Sin "verbatim": el filtro de recitación de Gemini (finishReason RECITATION, respuesta vacía) corta algunos videos
// cuando se pide la transcripción palabra por palabra. Solo se usa como último intento.
export const PROMPT_SOFT = PROMPT.replace(
  'transcript (everything spoken, verbatim, original language)',
  'transcript (what is spoken, in the original language; paraphrase closely rather than quote word for word)',
);

async function generate({ apiKey, fileUri, mimeType, prompt, signal }) {
  const res = await fetch(`${BASE}/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            { file_data: { mime_type: mimeType, file_uri: fileUri } },
            { text: prompt },
          ],
        },
      ],
      generationConfig: { responseMimeType: 'application/json' },
    }),
    signal: timeout(signal),
  });
  if (!res.ok) throw await apiError(res, 'generateContent');
  const data = await res.json();
  const cand = data.candidates?.[0];
  return { finish: cand?.finishReason, text: (cand?.content?.parts ?? []).map((p) => p.text ?? '').join('') };
}

// Pide el análisis y devuelve el objeto normalizado. Respuesta vacía (casi siempre RECITATION): otra vez el mismo
// prompt (medido 2026-11-13: con un video el prompt original dio RECITATION 5 de 9 veces, al azar), y al final el suave.
export async function analyze({ apiKey, fileUri, mimeType, signal, generateFn = generate }) {
  let last;
  for (const prompt of [PROMPT, PROMPT, PROMPT_SOFT]) {
    const out = await generateFn({ apiKey, fileUri, mimeType, prompt, signal });
    if (out.text.trim()) return parseGeminiJson(out.text);
    last = out.finish;
  }
  throw new JobError('gemini_failed', 502, `respuesta vacia (${last ?? 'sin finishReason'})`);
}

// Borra el archivo subido. Mejor esfuerzo: nunca lanza.
export async function deleteFile({ apiKey, name }) {
  try {
    await fetch(`${BASE}/v1beta/${name}?key=${encodeURIComponent(apiKey)}`, {
      method: 'DELETE',
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    // ignorado a propósito
  }
}

// Flujo completo: subir, esperar, analizar, borrar al final.
export async function analyzeVideo({ apiKey, file, displayName, signal }) {
  const uploaded = await uploadVideo({ apiKey, file, displayName, signal });
  try {
    await waitActive({ apiKey, name: uploaded.name, signal });
    return await analyze({ apiKey, fileUri: uploaded.uri, mimeType: uploaded.mimeType, signal });
  } finally {
    await deleteFile({ apiKey, name: uploaded.name });
  }
}
