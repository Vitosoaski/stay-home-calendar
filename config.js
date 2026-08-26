const env = process.env;

export default {
  port: Number(env.PORT ?? 3000),
  dbPath: env.DB_PATH ?? 'data/app.db',

  // Código que a pessoa digita para se cadastrar. Trocar em produção.
  groupCode: env.GROUP_CODE ?? 'trocar-em-producao',

  sheetId: env.SHEET_ID ?? '1aBruvw1ZgEuZp2PM9d3ABqQ1akhmbhmbwWBxra5SpE8',
  gids: {
    planner: env.GID_PLANNER ?? '267797752',   // HF4 — planejamento 4ª fase
    grade: env.GID_GRADE ?? '1283325522',      // 4 FASE — sala e professor
    subjects: env.GID_SUBJECTS ?? '1802549288' // disciplinas, CH oficial
  },
  phase: env.PHASE ?? '4',

  refreshMs: Number(env.REFRESH_MS ?? 5 * 60 * 1000),
  periodMinutes: 50,
  holidayCode: 'Fer/Rec',
  frequencyLimit: 0.25,
  tz: 'America/Sao_Paulo',
  sessionDays: 90,
  secureCookies: env.SECURE_COOKIES === '1',

  // A foto já chega com 96x96 vinda do navegador; o teto é folga contra abuso.
  maxPhotoBytes: 64 * 1024,
  maxReasonLength: 120
};

export function csvUrl(sheetId, gid) {
  return `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`;
}
