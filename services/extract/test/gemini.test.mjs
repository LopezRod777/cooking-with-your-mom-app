import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGeminiJson, normalizeAnalysis } from '../lib/gemini.mjs';

const payload = {
  transcript: 'Hoy hacemos pasta.',
  onScreenText: ['Pasta', '2 huevos'],
  ingredients: ['200 g de pasta', '2 huevos'],
  steps: ['Hierve el agua.', 'Mezcla los huevos.'],
  dish: 'Pasta con huevo',
  notes: '90 segundos',
};

test('parsea JSON directo', () => {
  assert.deepEqual(parseGeminiJson(JSON.stringify(payload)), payload);
});

test('parsea JSON envuelto en fences ```json', () => {
  const wrapped = '```json\n' + JSON.stringify(payload, null, 2) + '\n```';
  assert.deepEqual(parseGeminiJson(wrapped), payload);
});

test('parsea JSON con fence sin etiqueta y texto alrededor', () => {
  assert.deepEqual(parseGeminiJson('```\n' + JSON.stringify(payload) + '\n```'), payload);
  assert.deepEqual(parseGeminiJson('Aqui va: ' + JSON.stringify(payload) + ' fin'), payload);
});

test('llaves ausentes se normalizan a vacio, no inventan contenido', () => {
  const n = normalizeAnalysis({ dish: 'Tacos' });
  assert.deepEqual(n, {
    transcript: '',
    onScreenText: [],
    ingredients: [],
    steps: [],
    dish: 'Tacos',
    notes: '',
  });
});

test('JSON invalido lanza gemini_bad_json', () => {
  assert.throws(() => parseGeminiJson('no es json'), (e) => e.reason === 'gemini_bad_json');
});

test('analyze: RECITATION vacía -> reintenta el mismo prompt y al final el suave', async () => {
  const { analyze, PROMPT, PROMPT_SOFT } = await import('../lib/gemini.mjs');
  const seen = [];
  const ok = JSON.stringify({ transcript: 't', onScreenText: [], ingredients: ['1 potato'], steps: ['cook'], dish: 'd', notes: '' });
  const replies = [{ finish: 'RECITATION', text: '' }, { finish: 'RECITATION', text: '' }, { finish: 'STOP', text: ok }];
  const out = await analyze({ fileUri: 'u', mimeType: 'video/mp4', generateFn: async ({ prompt }) => { seen.push(prompt); return replies.shift(); } });
  assert.deepEqual(seen, [PROMPT, PROMPT, PROMPT_SOFT]);
  assert.deepEqual(out.ingredients, ['1 potato']);
});

test('analyze: primera respuesta buena -> una sola llamada', async () => {
  const { analyze } = await import('../lib/gemini.mjs');
  let calls = 0;
  const ok = JSON.stringify({ transcript: 't', onScreenText: [], ingredients: [], steps: [], dish: 'd', notes: '' });
  await analyze({ fileUri: 'u', mimeType: 'video/mp4', generateFn: async () => { calls++; return { finish: 'STOP', text: ok }; } });
  assert.equal(calls, 1);
});

test('analyze: tres vacías -> gemini_failed con el finishReason', async () => {
  const { analyze } = await import('../lib/gemini.mjs');
  await assert.rejects(
    analyze({ fileUri: 'u', mimeType: 'video/mp4', generateFn: async () => ({ finish: 'RECITATION', text: '' }) }),
    (e) => e.code === 'gemini_failed' || /RECITATION/.test(e.message),
  );
});
