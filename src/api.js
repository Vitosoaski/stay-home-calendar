import {
  createUser, findUserByName, getUser, listUsers, updateUser, getPhoto,
  createSession, findSession, touchSession, deleteSession,
  setAbsence, setReason, absencesBetween, absenceCounts
} from './db.js';
import {
  hashPin, verifyPin, newToken, hashToken, sessionCookie, clearedCookie,
  readCookie, constantEquals, createRateLimiter, validPin, validName, COOKIE_NAME
} from './auth.js';
import { HttpError, readJson, sendJson, sendEmpty, sameOrigin, clientIp, securityHeaders } from './http.js';
import { PALETTE } from '../config.js';

const ALLOWED_IMAGE_TYPES = ['image/webp', 'image/jpeg', 'image/png'];

export function createApi({ db, schedule, config }) {
  const loginLimit = createRateLimiter({ max: 5, windowMs: 60_000 });
  // Dois limites separados: um contra quem tenta adivinhar o código do grupo,
  // outro contra criação de perfis em massa por quem já tem o código. Erros de
  // digitação em nome ou PIN não consomem nenhum dos dois.
  const groupCodeLimit = createRateLimiter({ max: 10, windowMs: 60 * 60_000 });
  const signupLimit = createRateLimiter({ max: 3, windowMs: 60 * 60_000 });

  function sessionUser(req) {
    const token = readCookie(req.headers.cookie, COOKIE_NAME);
    if (!token) return null;
    const session = findSession(db, hashToken(token));
    if (!session) return null;
    touchSession(db, hashToken(token));
    return getUser(db, session.user_id);
  }

  function requireUser(req) {
    const user = sessionUser(req);
    if (!user) throw new HttpError(401, 'Entre para continuar');
    return user;
  }

  function pickColor() {
    const used = new Set(listUsers(db).map((u) => u.color));
    return PALETTE.find((color) => !used.has(color))
      ?? PALETTE[Math.floor(Math.random() * PALETTE.length)];
  }

  // O corpo cabe uma foto no limite em base64 (4/3 do tamanho) mais folga para
  // o resto do JSON. Acima disso é 413; dentro disso, o app explica o porquê.
  const bodyLimit = Math.ceil(config.maxPhotoBytes * 4 / 3) + 8 * 1024;

  // Aceita data URL, confere o tipo e o tamanho já decodificado.
  function decodePhoto(dataUrl) {
    if (dataUrl === null) return { photo: null, photoType: null };
    const match = /^data:([^;,]+);base64,(.+)$/s.exec(String(dataUrl));
    if (!match) throw new HttpError(400, 'Foto em formato inesperado');

    const [, type, base64] = match;
    if (!ALLOWED_IMAGE_TYPES.includes(type)) {
      throw new HttpError(400, 'Use uma foto JPEG, PNG ou WebP');
    }
    const bytes = Buffer.from(base64, 'base64');
    if (bytes.length === 0) throw new HttpError(400, 'Foto vazia');
    if (bytes.length > config.maxPhotoBytes) throw new HttpError(400, 'Foto grande demais');
    return { photo: new Uint8Array(bytes), photoType: type };
  }

  async function startSession(res, user, status) {
    const token = newToken();
    createSession(db, hashToken(token), user.id);
    sendJson(res, status, { user }, {
      'Set-Cookie': sessionCookie(token,
        { secure: config.secureCookies, days: config.sessionDays })
    });
  }

  async function handleSignup(req, res) {
    const body = await readJson(req, { limit: bodyLimit });

    if (!constantEquals(body.groupCode ?? '', config.groupCode)) {
      if (!groupCodeLimit.allow(clientIp(req))) {
        throw new HttpError(429, 'Muitas tentativas. Tente daqui a pouco.');
      }
      throw new HttpError(403, 'Código do grupo incorreto');
    }
    if (!validName(body.name)) throw new HttpError(400, 'Nome entre 1 e 24 caracteres');
    if (!validPin(body.pin)) throw new HttpError(400, 'O PIN precisa ter de 4 a 6 dígitos');
    if (!signupLimit.allow(clientIp(req))) {
      throw new HttpError(429, 'Muitos cadastros. Tente daqui a pouco.');
    }

    const { photo, photoType } = body.photo ? decodePhoto(body.photo) : { photo: null, photoType: null };
    const { hash, salt } = await hashPin(body.pin);

    let user;
    try {
      user = createUser(db, {
        name: body.name, color: pickColor(), pinHash: hash, pinSalt: salt, photo, photoType
      });
    } catch {
      throw new HttpError(409, 'Já existe alguém com esse nome');
    }
    await startSession(res, user, 201);
  }

  async function handleLogin(req, res) {
    if (!loginLimit.allow(clientIp(req))) {
      throw new HttpError(429, 'Muitas tentativas. Espere um minuto.');
    }
    const body = await readJson(req, { limit: bodyLimit });
    const row = validName(body.name) ? findUserByName(db, body.name) : undefined;

    // Nome inexistente ainda gasta o tempo de um scrypt, senão a rapidez da
    // resposta contaria a quem tenta quais nomes têm conta.
    if (!row) {
      await hashPin(String(body.pin ?? ''));
      throw new HttpError(401, 'Nome ou PIN incorretos');
    }
    if (!await verifyPin(body.pin ?? '', row.pin_hash, row.pin_salt)) {
      throw new HttpError(401, 'Nome ou PIN incorretos');
    }
    await startSession(res, getUser(db, row.id), 200);
  }

  function handleLogout(req, res) {
    const token = readCookie(req.headers.cookie, COOKIE_NAME);
    if (token) deleteSession(db, hashToken(token));
    sendEmpty(res, 204, { 'Set-Cookie': clearedCookie({ secure: config.secureCookies }) });
  }

  async function handleUpdateMe(req, res) {
    const user = requireUser(req);
    const body = await readJson(req, { limit: bodyLimit });
    const patch = {};

    if (body.photo !== undefined) Object.assign(patch, decodePhoto(body.photo));
    if (body.color !== undefined) {
      if (!PALETTE.includes(body.color)) throw new HttpError(400, 'Cor inválida');
      patch.color = body.color;
    }
    sendJson(res, 200, { user: updateUser(db, user.id, patch) });
  }

  function handlePhoto(req, res, id) {
    const row = getPhoto(db, Number(id));
    if (!row?.photo) { sendEmpty(res, 404); return; }

    const etag = `"foto-${id}-${row.photo_version}"`;
    if (req.headers['if-none-match'] === etag) { sendEmpty(res, 304, { ETag: etag }); return; }

    res.writeHead(200, {
      'Content-Type': row.photo_type ?? 'image/webp',
      'Content-Length': row.photo.length,
      ETag: etag,
      'Cache-Control': 'private, max-age=86400',
      ...securityHeaders()
    });
    res.end(Buffer.from(row.photo));
  }

  return async function handle(req, res) {
    const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
    if (!url.pathname.startsWith('/api/')) return false;

    try {
      // Escritas só valem vindas do próprio site.
      if (req.method !== 'GET' && !sameOrigin(req)) {
        throw new HttpError(403, 'Origem não permitida');
      }

      const route = `${req.method} ${url.pathname}`;
      const photoMatch = /^GET \/api\/photo\/(\d+)$/.exec(route);

      if (route === 'POST /api/signup') await handleSignup(req, res);
      else if (route === 'POST /api/login') await handleLogin(req, res);
      else if (route === 'POST /api/logout') handleLogout(req, res);
      else if (route === 'GET /api/me') sendJson(res, 200, { user: requireUser(req) });
      else if (route === 'PATCH /api/me') await handleUpdateMe(req, res);
      else if (photoMatch) handlePhoto(req, res, photoMatch[1]);
      else sendJson(res, 404, { error: 'Rota não encontrada' });
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      if (status === 500) console.error('erro na API:', error);
      sendJson(res, status, { error: status === 500 ? 'Erro interno' : error.message });
    }
    return true;
  };
}
