import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateUrl } from '../lib/url.mjs';

test('acepta hosts permitidos y asigna plataforma', () => {
  const cases = [
    ['https://www.tiktok.com/@doosifit/video/7183118805290339627', 'tiktok'],
    ['https://vm.tiktok.com/ZMabc123/', 'tiktok'],
    ['https://m.tiktok.com/v/123.html', 'tiktok'],
    ['https://www.instagram.com/reel/C_y_B4xouRx/', 'instagram'],
    ['https://www.youtube.com/watch?v=fD4oo98_er8', 'youtube'],
    ['https://youtu.be/fD4oo98_er8', 'youtube'],
    ['http://tiktok.com/@a/video/1', 'tiktok'],
  ];
  for (const [raw, platform] of cases) {
    const v = validateUrl(raw);
    assert.equal(v.ok, true, raw);
    assert.equal(v.platform, platform, raw);
  }
});

test('rechaza hosts que no son de la lista', () => {
  for (const raw of [
    'https://example.com/video',
    'https://eviltiktok.com/@a/video/1',
    'https://tiktok.com.evil.net/video/1',
    'https://notyoutube.com/watch?v=1',
    'https://fakeyoutu.be/x',
  ]) {
    assert.deepEqual(validateUrl(raw), { ok: false, reason: 'unsupported_host' }, raw);
  }
});

test('rechaza esquemas que no son http/https, texto basura y credenciales', () => {
  for (const raw of [
    'ftp://www.tiktok.com/@a/video/1',
    'file:///etc/passwd',
    'javascript:alert(1)',
    'not a url',
    '',
    undefined,
    null,
    'https://user:pass@www.tiktok.com/@a/video/1',
  ]) {
    const v = validateUrl(raw);
    assert.equal(v.ok, false, String(raw));
    assert.equal(v.reason, 'invalid_url', String(raw));
  }
});
