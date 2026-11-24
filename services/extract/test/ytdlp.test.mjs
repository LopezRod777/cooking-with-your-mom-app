import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FORMAT_SELECTOR, MAX_FILESIZE, MAX_BYTES } from '../lib/ytdlp.mjs';

test('selector de formato usa width<=720 (video vertical), no height', () => {
  assert.equal(FORMAT_SELECTOR, 'bv*[width<=720][ext=mp4]+ba[ext=m4a]/b[width<=720][ext=mp4]/b');
  assert.ok(FORMAT_SELECTOR.includes('width<=720'));
  assert.ok(!FORMAT_SELECTOR.includes('height'));
});

test('limite de tamaño de descarga es 60 MB', () => {
  assert.equal(MAX_FILESIZE, '60m');
  assert.equal(MAX_BYTES, 60 * 1024 * 1024);
});
