import { createServer } from 'node:http';
import { openDb } from '../src/db.js';
import { createApi } from '../src/api.js';
import { createScheduleService } from '../src/schedule.js';
import { readFileSync } from 'node:fs';

const read = (name) =>
  readFileSync(new URL(`./fixtures/${name}.csv`, import.meta.url), 'utf8');

export const testConfig = {
  groupCode: 'segredo',
  sheetId: 'x', gids: { planner: '1', grade: '2', subjects: '3' },
  phase: '4', holidayCode: 'Fer/Rec', periodMinutes: 50,
  frequencyLimit: 0.25, refreshMs: 60_000, tz: 'America/Sao_Paulo',
  sessionDays: 90, secureCookies: false,
  maxPhotoBytes: 64 * 1024, maxReasonLength: 120
};

const fixtureFetch = async (url) => ({
  ok: true, status: 200,
  text: async () => url.includes('gid=1') ? read('planner-hf4')
    : url.includes('gid=2') ? read('grade-4fase') : read('disciplinas')
});

// Sobe um servidor real numa porta livre. Testar pela rede é o que garante que
// cookies, códigos de status e cabeçalhos funcionam de verdade.
export async function startTestServer({ config = {} } = {}) {
  const db = openDb(':memory:');
  const merged = { ...testConfig, ...config };
  const schedule = createScheduleService({ db, config: merged, fetchImpl: fixtureFetch });
  await schedule.refresh();

  const api = createApi({ db, schedule, config: merged });
  const server = createServer(async (req, res) => {
    if (await api(req, res)) return;
    res.writeHead(404).end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  // Se um teste falhar antes do close(), o servidor não pode segurar o processo.
  server.unref();
  const base = `http://127.0.0.1:${server.address().port}`;

  const request = async (method, path, body, { cookie, origin } = {}) => {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (cookie) headers.Cookie = cookie;
    if (origin) headers.Origin = origin;

    const response = await fetch(base + path, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await response.text();
    let parsed = null;
    try { parsed = JSON.parse(text); } catch { parsed = text; }
    return {
      status: response.status,
      body: parsed,
      cookie: (response.headers.get('set-cookie') ?? '').split(';')[0] || null
    };
  };

  return {
    db, schedule, config: merged,
    get: (path, options) => request('GET', path, undefined, options),
    post: (path, body, options) => request('POST', path, body ?? {}, options),
    put: (path, body, options) => request('PUT', path, body ?? {}, options),
    patch: (path, body, options) => request('PATCH', path, body ?? {}, options),
    close: () => new Promise((resolve) => {
      // fetch mantém a conexão viva; sem fechar os sockets, close() nunca volta.
      server.closeAllConnections?.();
      server.close(resolve);
    })
  };
}
