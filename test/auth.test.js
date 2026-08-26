import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  hashPin, verifyPin, newToken, hashToken, sessionCookie, clearedCookie,
  readCookie, constantEquals, createRateLimiter, validPin, validName
} from '../src/auth.js';

test('PIN confere consigo mesmo e recusa qualquer outro', async () => {
  const { hash, salt } = await hashPin('1234');
  assert.equal(await verifyPin('1234', hash, salt), true);
  assert.equal(await verifyPin('1235', hash, salt), false);
  assert.equal(await verifyPin('', hash, salt), false);
});

test('o mesmo PIN gera hashes diferentes, porque o salt é sorteado', async () => {
  const a = await hashPin('1234');
  const b = await hashPin('1234');
  assert.notEqual(a.hash, b.hash);
  assert.notEqual(a.salt, b.salt);
});

test('o PIN não aparece no hash', async () => {
  const { hash, salt } = await hashPin('123456');
  assert.ok(!hash.includes('123456'));
  assert.ok(!salt.includes('123456'));
});

test('tokens são longos, únicos e o hash não volta ao token', () => {
  const a = newToken();
  const b = newToken();
  assert.notEqual(a, b);
  assert.ok(a.length >= 32);
  assert.notEqual(hashToken(a), a);
  assert.equal(hashToken(a), hashToken(a));
});

test('o cookie de sessão é HttpOnly e SameSite', () => {
  const cookie = sessionCookie('abc', { secure: true, days: 90 });
  assert.match(cookie, /^sessao=abc;/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /Max-Age=7776000/);
});

test('sem HTTPS o cookie sai sem Secure, senão o navegador o descarta', () => {
  assert.ok(!sessionCookie('abc', { secure: false, days: 90 }).includes('Secure'));
});

test('o cookie de saída expira imediatamente', () => {
  assert.match(clearedCookie({ secure: false }), /Max-Age=0/);
});

test('lê o cookie certo entre vários', () => {
  assert.equal(readCookie('a=1; sessao=xyz; b=2', 'sessao'), 'xyz');
  assert.equal(readCookie('a=1', 'sessao'), null);
  assert.equal(readCookie(undefined, 'sessao'), null);
});

test('comparação constante trata tamanhos diferentes sem estourar', () => {
  assert.equal(constantEquals('abc', 'abc'), true);
  assert.equal(constantEquals('abc', 'abd'), false);
  assert.equal(constantEquals('abc', 'abcd'), false);
  assert.equal(constantEquals('', ''), true);
});

test('rate limit libera até o teto e depois bloqueia', () => {
  const limiter = createRateLimiter({ max: 3, windowMs: 60_000 });
  assert.deepEqual([1, 2, 3].map(() => limiter.allow('ip')), [true, true, true]);
  assert.equal(limiter.allow('ip'), false);
  assert.equal(limiter.allow('outro-ip'), true, 'cada chave tem sua própria conta');
});

test('rate limit esquece tentativas antigas', () => {
  let clock = 0;
  const limiter = createRateLimiter({ max: 2, windowMs: 1000, now: () => clock });
  limiter.allow('ip'); limiter.allow('ip');
  assert.equal(limiter.allow('ip'), false);
  clock = 1500;
  assert.equal(limiter.allow('ip'), true);
});

test('valida PIN e nome', () => {
  assert.equal(validPin('1234'), true);
  assert.equal(validPin('123456'), true);
  assert.equal(validPin('123'), false);
  assert.equal(validPin('1234567'), false);
  assert.equal(validPin('12a4'), false);
  assert.equal(validName('Ana'), true);
  assert.equal(validName(' '), false);
  assert.equal(validName('x'.repeat(25)), false);
});
