import { randomBytes, scrypt, createHash, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);
const KEY_LENGTH = 32;
export const COOKIE_NAME = 'sessao';

export async function hashPin(pin) {
  const salt = randomBytes(16).toString('hex');
  const derived = await scryptAsync(String(pin), salt, KEY_LENGTH);
  return { hash: derived.toString('hex'), salt };
}

export async function verifyPin(pin, hash, salt) {
  const derived = await scryptAsync(String(pin), salt, KEY_LENGTH);
  return constantEquals(derived.toString('hex'), hash);
}

export function newToken() {
  return randomBytes(32).toString('base64url');
}

// O banco guarda só o hash do token: vazou o banco, ninguém rouba sessão.
export function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

export function sessionCookie(token, { secure, days }) {
  const parts = [
    `${COOKIE_NAME}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${days * 86400}`
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function clearedCookie({ secure }) {
  const parts = [`${COOKIE_NAME}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function readCookie(header, name) {
  if (!header) return null;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    if (part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return null;
}

// timingSafeEqual exige buffers do mesmo tamanho, e comparar segredos de
// tamanhos diferentes já vazaria informação. Comparando os hashes, o buffer tem
// sempre 32 bytes e o tempo não depende do conteúdo nem do comprimento.
export function constantEquals(a, b) {
  const digest = (value) => createHash('sha256').update(String(value)).digest();
  return timingSafeEqual(digest(a), digest(b));
}

export function createRateLimiter({ max, windowMs, now = () => Date.now() }) {
  const hits = new Map();
  return {
    allow(key) {
      const cutoff = now() - windowMs;
      const recent = (hits.get(key) ?? []).filter((t) => t > cutoff);
      if (recent.length >= max) { hits.set(key, recent); return false; }
      recent.push(now());
      hits.set(key, recent);
      return true;
    },
    reset() { hits.clear(); }
  };
}

export const validPin = (pin) => /^\d{4,6}$/.test(String(pin ?? ''));
export const validName = (name) => {
  const trimmed = String(name ?? '').trim();
  return trimmed.length >= 1 && trimmed.length <= 24;
};
