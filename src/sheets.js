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

// A legenda fica à direita da célula 'LEGENDA'. As células mescladas deixam
// espaçamento irregular, então juntamos as não-vazias em ordem e pareamos
// duas a duas: sigla, nome, sigla, nome...
export function parseLegend(rows, headerRow) {
  const legend = new Map();

  let legendCol = -1;
  for (let r = 0; r < headerRow && legendCol === -1; r++) {
    for (let c = 0; c < (rows[r]?.length ?? 0); c++) {
      if (cell(rows, r, c).toUpperCase() === 'LEGENDA') { legendCol = c; break; }
    }
  }
  if (legendCol === -1) return legend;

  for (let r = 0; r < headerRow; r++) {
    const items = [];
    for (let c = legendCol; c < (rows[r]?.length ?? 0); c++) {
      const value = cell(rows, r, c);
      if (value && value.toUpperCase() !== 'LEGENDA') items.push(value);
    }
    for (let i = 0; i + 1 < items.length; i += 2) {
      const [code, name] = [items[i], items[i + 1]];
      if (code.length <= 12 && name && name !== code) legend.set(code, name);
    }
  }

  return legend;
}

// Percorre as semanas e produz um dia por bloco de dia, já com as aulas agrupadas.
export function parsePlanner(csvText, { holidayCode = 'Fer/Rec', periodMinutes = 50 } = {}) {
  const rows = parseCsv(csvText);
  const layout = findPlannerLayout(rows);
  const legend = parseLegend(rows, layout.headerRow);

  let year = parseYear(rows, layout.headerRow);
  let lastMonth = 0;
  const days = [];

  for (let r = layout.dataStartRow; r < rows.length; r++) {
    for (const day of layout.days) {
      const raw = cell(rows, r, day.dateCol);
      if (!isDayMonth(raw)) continue;

      const [dayOfMonth, month] = raw.split('/').map(Number);
      // As datas trazem só dd/MM. Se o mês voltar, o ano virou.
      if (lastMonth && month < lastMonth) year++;
      lastMonth = month;

      const periods = day.slots.map((s) => ({ time: s.time, code: cell(rows, r, s.col) }));
      days.push(buildDay({
        date: isoDate(dayOfMonth, month, year),
        weekday: day.weekday,
        label: day.label,
        periods
      }, { holidayCode, periodMinutes, legend }));
    }
  }

  const periodCounts = new Map();
  for (const day of days) {
    for (const block of day.blocks) {
      periodCounts.set(block.subject,
        (periodCounts.get(block.subject) ?? 0) + block.slots.length);
    }
  }

  return { year, legend, periodCounts, days };
}

function buildDay({ date, weekday, label, periods }, { holidayCode, periodMinutes, legend }) {
  const groups = [];
  for (const period of periods) {
    if (!period.code) continue;
    const previous = groups.at(-1);
    // Só funde se este período começa exatamente quando o anterior termina.
    // É isso que separa as aulas em torno do intervalo, sem codificar horários.
    const contiguous = previous
      && previous.subject === period.code
      && addMinutes(previous.slots.at(-1), periodMinutes) === period.time;

    if (contiguous) previous.slots.push(period.time);
    else groups.push({ subject: period.code, slots: [period.time] });
  }

  const holiday = groups.length > 0 && groups.every((g) => g.subject === holidayCode);

  return {
    date,
    weekday,
    label,
    holiday,
    blocks: holiday ? [] : groups.map((g) => ({
      id: `${date}|${g.slots[0]}`,
      subject: g.subject,
      name: legend.get(g.subject) ?? g.subject,
      slots: g.slots,
      start: g.slots[0],
      end: addMinutes(g.slots.at(-1), periodMinutes)
    }))
  };
}
