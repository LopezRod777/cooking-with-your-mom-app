// Hosts permitidos. Coincide el dominio exacto o cualquier subdominio (www., m., vm.).
const PLATFORM_DOMAINS = [
  { domain: 'tiktok.com', platform: 'tiktok' },
  { domain: 'instagram.com', platform: 'instagram' },
  { domain: 'youtube.com', platform: 'youtube' },
  { domain: 'youtu.be', platform: 'youtube' },
];

// Devuelve { ok: true, url, platform } o { ok: false, reason }.
// reason: 'invalid_url' (no es URL http/https o trae credenciales) | 'unsupported_host'.
export function validateUrl(raw) {
  let u;
  try {
    u = new URL(String(raw ?? '').trim());
  } catch {
    return { ok: false, reason: 'invalid_url' };
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, reason: 'invalid_url' };
  if (u.username || u.password) return { ok: false, reason: 'invalid_url' };
  const host = u.hostname.toLowerCase();
  const hit = PLATFORM_DOMAINS.find(({ domain }) => host === domain || host.endsWith(`.${domain}`));
  if (!hit) return { ok: false, reason: 'unsupported_host' };
  return { ok: true, url: u.toString(), platform: hit.platform };
}
