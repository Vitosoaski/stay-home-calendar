import { parseCsv } from './csv.js';
import { isTime, isDayMonth, isoDate, addMinutes } from './dates.js';

export const cell = (rows, r, c) => (rows[r]?.[c] ?? '').trim();

// Encontra a linha que nomeia os dias, os blocos de cada dia e suas colunas de
// horário. Tudo por conteúdo: se a planilha ganhar linhas ou colunas, continua
// funcionando.
export function findPlannerLayout(rows) {
  const headerRow = rows.findIndex(
    (r) => r.filter((c) => /-FEIRA|SÁBADO/i.test(c)).length >= 3);
  if (headerRow === -1) {
    throw new Error('planejamento: linha dos dias da semana não encontrada');
  }

  const timeRow = rows.findIndex(
    (r, i) => i > headerRow && r.some((c) => c.trim() === 'Data/Hr'));
  if (timeRow === -1) {
    throw new Error('planejamento: linha de horários (Data/Hr) não encontrada');
  }

  const days = [];
  rows[headerRow].forEach((label, col) => {
    if (!/-FEIRA|SÁBADO/i.test(label)) return;

    // A coluna de data é o primeiro 'Data/Hr' a partir da coluna do dia.
    let dateCol = -1;
    for (let j = col; j < rows[timeRow].length; j++) {
      if (cell(rows, timeRow, j) === 'Data/Hr') { dateCol = j; break; }
    }
    if (dateCol === -1) {
      throw new Error(`planejamento: 'Data/Hr' não encontrado para ${label.trim()}`);
    }

    // Os horários são as colunas seguintes, até a primeira que não for horário.
    const slots = [];
    for (let j = dateCol + 1; j < rows[timeRow].length; j++) {
      const value = cell(rows, timeRow, j);
      if (!isTime(value)) break;
      slots.push({ time: value, col: j });
    }

    days.push({ label: label.trim(), weekday: days.length + 2, dateCol, slots });
  });

  return { headerRow, timeRow, dataStartRow: timeRow + 2, days };
}

// O ano não está nas datas (só dd/MM), então vem do cabeçalho:
// "2º Semestre de 2026".
export function parseYear(rows, headerRow) {
  for (let r = 0; r < headerRow; r++) {
    for (const value of rows[r] ?? []) {
      const match = String(value).match(/(20\d{2})/);
      if (match) return Number(match[1]);
    }
  }
  return new Date().getFullYear();
}
