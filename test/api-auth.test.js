import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from './helpers.js';

test('cadastro exige o código do grupo', async () => {
  const app = await startTestServer();
  const bad = await app.post('/api/signup',
    { groupCode: 'errado', name: 'Ana', pin: '1234' });
  assert.equal(bad.status, 403);

  const good = await app.post('/api/signup',
    { groupCode: 'segredo', name: 'Ana', pin: '1234' });
  assert.equal(good.status, 201);
  assert.equal(good.body.user.name, 'Ana');
  assert.ok(good.cookie, 'já vem logado');
  await app.close();
});

test('cadastro recusa PIN e nome inválidos', async () => {
  const app = await startTestServer();
  for (const pin of ['123', '1234567', 'abcd', '']) {
    const res = await app.post('/api/signup', { groupCode: 'segredo', name: 'Ana', pin });
    assert.equal(res.status, 400, `PIN ${pin} deveria ser recusado`);
  }
  const longName = await app.post('/api/signup',
    { groupCode: 'segredo', name: 'x'.repeat(30), pin: '1234' });
  assert.equal(longName.status, 400);
  await app.close();
});

test('cadastro recusa nome repetido', async () => {
  const app = await startTestServer();
  await app.post('/api/signup', { groupCode: 'segredo', name: 'Ana', pin: '1234' });
  const again = await app.post('/api/signup', { groupCode: 'segredo', name: 'ana', pin: '9999' });
  assert.equal(again.status, 409);
  await app.close();
});

test('a resposta nunca traz hash nem salt', async () => {
  const app = await startTestServer();
  const res = await app.post('/api/signup', { groupCode: 'segredo', name: 'Ana', pin: '1234' });
  const text = JSON.stringify(res.body);
  assert.ok(!text.includes('pin_hash') && !text.includes('pinHash'));
  assert.ok(!text.includes('1234'));
  await app.close();
});

test('login aceita o PIN certo e recusa o errado', async () => {
  const app = await startTestServer();
  await app.post('/api/signup', { groupCode: 'segredo', name: 'Ana', pin: '1234' });

  const wrong = await app.post('/api/login', { name: 'Ana', pin: '9999' });
  assert.equal(wrong.status, 401);

  const right = await app.post('/api/login', { name: 'ana', pin: '1234' });
  assert.equal(right.status, 200);
  assert.ok(right.cookie);
  await app.close();
});

test('login de nome inexistente devolve 401, não 404', async () => {
  // 404 contaria a quem tenta quais nomes existem
  const app = await startTestServer();
  const res = await app.post('/api/login', { name: 'ninguém', pin: '1234' });
  assert.equal(res.status, 401);
  await app.close();
});

test('rate limit corta tentativas repetidas de login', async () => {
  const app = await startTestServer();
  await app.post('/api/signup', { groupCode: 'segredo', name: 'Ana', pin: '1234' });
  const codes = [];
  for (let i = 0; i < 8; i++) {
    codes.push((await app.post('/api/login', { name: 'Ana', pin: '0000' })).status);
  }
  assert.ok(codes.includes(429), `esperava um 429 entre ${codes}`);
  await app.close();
});

test('/api/me exige sessão e devolve o usuário', async () => {
  const app = await startTestServer();
  assert.equal((await app.get('/api/me')).status, 401);

  const signup = await app.post('/api/signup', { groupCode: 'segredo', name: 'Ana', pin: '1234' });
  const me = await app.get('/api/me', { cookie: signup.cookie });
  assert.equal(me.status, 200);
  assert.equal(me.body.user.name, 'Ana');
  await app.close();
});

test('cookie inválido é tratado como deslogado', async () => {
  const app = await startTestServer();
  const res = await app.get('/api/me', { cookie: 'sessao=inventado' });
  assert.equal(res.status, 401);
  await app.close();
});

test('logout invalida a sessão no servidor', async () => {
  const app = await startTestServer();
  const signup = await app.post('/api/signup', { groupCode: 'segredo', name: 'Ana', pin: '1234' });
  await app.post('/api/logout', {}, { cookie: signup.cookie });
  assert.equal((await app.get('/api/me', { cookie: signup.cookie })).status, 401);
  await app.close();
});

test('foto é guardada, servida e recusada quando grande demais', async () => {
  const app = await startTestServer();
  const signup = await app.post('/api/signup', { groupCode: 'segredo', name: 'Ana', pin: '1234' });

  const tiny = 'data:image/webp;base64,' + Buffer.from('imagem-falsa').toString('base64');
  const saved = await app.patch('/api/me', { photo: tiny }, { cookie: signup.cookie });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.user.hasPhoto, true);

  const photo = await app.get(`/api/photo/${saved.body.user.id}`);
  assert.equal(photo.status, 200);

  // Um pouco acima do limite: o app decodifica e explica.
  const over = 'data:image/webp;base64,'
    + Buffer.alloc(app.config.maxPhotoBytes + 2048).toString('base64');
  const rejected = await app.patch('/api/me', { photo: over }, { cookie: signup.cookie });
  assert.equal(rejected.status, 400);
  assert.match(rejected.body.error, /grande demais/);

  // Absurdamente acima: nem chega a ser lido inteiro.
  const huge = 'data:image/webp;base64,' + Buffer.alloc(400 * 1024).toString('base64');
  const cut = await app.patch('/api/me', { photo: huge }, { cookie: signup.cookie });
  assert.equal(cut.status, 413);
  await app.close();
});

test('foto em formato não suportado é recusada', async () => {
  const app = await startTestServer();
  const signup = await app.post('/api/signup', { groupCode: 'segredo', name: 'Ana', pin: '1234' });
  const svg = 'data:image/svg+xml;base64,' + Buffer.from('<svg onload=alert(1)>').toString('base64');
  const res = await app.patch('/api/me', { photo: svg }, { cookie: signup.cookie });
  assert.equal(res.status, 400);
  await app.close();
});

test('escrita vinda de outro site é recusada', async () => {
  const app = await startTestServer();
  const res = await app.post('/api/signup',
    { groupCode: 'segredo', name: 'Ana', pin: '1234' },
    { origin: 'https://malicioso.com' });
  assert.equal(res.status, 403);
  await app.close();
});
