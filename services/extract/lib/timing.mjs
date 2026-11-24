// Mide en milisegundos el tiempo de una promesa. Devuelve { value, ms }.
export async function timed(fn) {
  const t0 = performance.now();
  const value = await fn();
  return { value, ms: Math.round(performance.now() - t0) };
}
