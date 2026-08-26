import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import defaultConfig from './config.js';
import { openDb, purgeSessions } from './src/db.js';
import { createScheduleService } from './src/schedule.js';
import { createApi } from './src/api.js';
import { serveStatic, sendEmpty } from './src/http.js';

const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), 'public');

export function createServerApp({ config = defaultConfig } = {}) {
  const db = openDb(config.dbPath);
  purgeSessions(db, config.sessionDays);

  const schedule = createScheduleService({ db, config });
  const api = createApi({ db, schedule, config });

  const server = createServer(async (req, res) => {
    try {
      if (await api(req, res)) return;
      if (await serveStatic(req, res, PUBLIC_DIR)) return;
      sendEmpty(res, 404);
    } catch (error) {
      console.error('erro não tratado:', error);
      if (!res.headersSent) sendEmpty(res, 500);
    }
  });

  return { server, db, schedule, config };
}

// Só sobe sozinho quando executado direto, para os testes poderem importar.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const app = createServerApp();
  app.schedule.start();
  app.server.listen(app.config.port, app.config.host, () => {
    console.log(`Calendário de faltas em http://${app.config.host}:${app.config.port}`);
    if (app.config.groupCode === 'trocar-em-producao') {
      console.warn('Atenção: defina GROUP_CODE antes de expor este site.');
    }
  });

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      app.schedule.stop();
      app.server.close(() => process.exit(0));
    });
  }
}
