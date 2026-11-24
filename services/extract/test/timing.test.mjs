import { test } from 'node:test';
import assert from 'node:assert/strict';
import { timed } from '../lib/timing.mjs';

test('timed devuelve el valor y los milisegundos transcurridos', async () => {
  const { value, ms } = await timed(async () => {
    await new Promise((r) => setTimeout(r, 30));
    return 'listo';
  });
  assert.equal(value, 'listo');
  assert.ok(Number.isInteger(ms));
  assert.ok(ms >= 25, `ms=${ms}`);
});

test('timed propaga errores', async () => {
  await assert.rejects(timed(async () => { throw new Error('boom'); }), /boom/);
});
