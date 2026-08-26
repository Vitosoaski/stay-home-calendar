import { parseCsv } from './csv.js';
import { isTime, isDayMonth, isoDate, addMinutes } from './dates.js';

export const cell = (rows, r, c) => (rows[r]?.[c] ?? '').trim();

// Compara textos de cabeçalho ignorando acento, caixa, espaço em volta e espaço
// interno repetido, porque a planilha alterna entre 'HORÁRIO' e 'HORARIO',
// 'CH 50 MIN' e 'CH  50 MIN'. É a única estratégia de comparação do arquivo.
export const normalize = (s) => String(s).trim().toUpperCase()
  .normalize('NFD').replace(/\p{Diacritic}/gu, '')
  .replace(/\s+/g, ' ');

// Horários vêm ora como '7:30', ora como '07:30'. Normalizamos no parse para que
// os dois lados da junção planejamento x grade usem a mesma chave.
export const padTime = (s) => {
  const match = String(s).trim().match(/^(\d{1,2}):(\d{2})$/);
  return match ? `${match[1].padStart(2, '0')}:${match[2]}` : String(s).trim();
};

const WEEKDAYS = new Map([
  ['DOMINGO', 1], ['SEGUNDA', 2], ['TERCA', 3], ['QUARTA', 4],
  ['QUINTA', 5], ['SEXTA', 6], ['SABADO', 7]
]);

// Converte 'SEGUNDA-FEIRA', 'segunda-feira', 'SÁBADO' no número ISO do dia.
// Devolve null quando o rótulo não é um dia da semana reconhecível.
export function weekdayFromLabel(label) {
  const key = normalize(label).replace(/[-\s]*FEIRA$/, '').trim();
  return WEEKDAYS.get(key) ?? null;
}

// Encontra a linha que nomeia os dias, os blocos de cada dia e suas colunas de
// horário. Tudo por conteúdo: se a planilha ganhar linhas ou colunas, continua
// funcionando — e quando não reconhece a forma, lança erro em vez de devolver
// dado parcial.
export function findPlannerLayout(rows) {
  const headerRow = rows.findIndex(
    (r) => r.filter((c) => /-FEIRA|SÁBADO/i.test(c)).length >= 3);
  if (headerRow === -1) {
    throw new Error('planejamento: linha dos dias da semana não encontrada');
  }

  const timeRow = rows.findIndex(
    (r, i) => i > headerRow && r.some((c) => normalize(c) === 'DATA/HR'));
  if (timeRow === -1) {
    throw new Error('planejamento: linha de horários (Data/Hr) não encontrada');
  }

  const days = [];
  rows[headerRow].forEach((label, col) => {
    if (!/-FEIRA|SÁBADO/i.test(label)) return;

    // O número do dia vem do rótulo, nunca da posição: uma coluna a mais no
    // cabeçalho não pode renumerar a semana inteira.
    const weekday = weekdayFromLabel(label);
    if (weekday === null) {
      throw new Error(`planejamento: dia da semana não reconhecido: ${label.trim()}`);
    }

    // A coluna de data é o primeiro 'Data/Hr' a partir da coluna do dia.
    let dateCol = -1;
    for (let j = col; j < rows[timeRow].length; j++) {
      if (normalize(cell(rows, timeRow, j)) === 'DATA/HR') { dateCol = j; break; }
    }
    if (dateCol === -1) {
      throw new Error(`planejamento: 'Data/Hr' não encontrado para ${label.trim()}`);
    }

    // Os horários são as colunas seguintes até o próximo 'Data/Hr' (o dia
    // seguinte) ou o fim da linha. Células vazias são puladas — uma coluna em
    // branco no meio não pode encurtar o dia. Lixo no meio é erro, não corte.
    const slots = [];
    for (let j = dateCol + 1; j < rows[timeRow].length; j++) {
      const value = cell(rows, timeRow, j);
      if (!value) continue;
      if (normalize(value) === 'DATA/HR') break;
      if (!isTime(value)) {
        throw new Error(
          `planejamento: célula inesperada '${value}' na linha de horários de ${label.trim()}`);
      }
      slots.push({ time: padTime(value), col: j });
    }
    if (slots.length === 0) {
      throw new Error(`planejamento: nenhum horário encontrado para ${label.trim()}`);
    }

    days.push({ label: label.trim(), weekday, dateCol, slots });
  });

  // A linha logo abaixo da de horários já é descartada pelo guarda isDayMonth
  // quando é rótulo ('Data, Disciplinas'), então não pulamos linha nenhuma.
  return { headerRow, timeRow, dataStartRow: timeRow + 1, days };
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
      if (normalize(cell(rows, r, c)) === 'LEGENDA') { legendCol = c; break; }
    }
  }
  if (legendCol === -1) return legend;

  for (let r = 0; r < headerRow; r++) {
    const items = [];
    for (let c = legendCol; c < (rows[r]?.length ?? 0); c++) {
      const value = cell(rows, r, c);
      if (value && normalize(value) !== 'LEGENDA') items.push(value);
    }
    // Número ímpar de itens significa que o pareamento sigla/nome está
    // desalinhado: melhor ignorar a linha do que inventar pares errados.
    if (items.length % 2 !== 0) continue;
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

      // A planilha repete o número do dia na coluna à esquerda da data.
      // Conferir contra o rótulo transforma deriva estrutural em erro alto.
      const marker = cell(rows, r, day.dateCol - 1);
      if (/^[1-7]$/.test(marker) && Number(marker) !== day.weekday) {
        throw new Error(
          `planejamento: ${day.label} (${day.weekday}) traz marcador ${marker} em ${raw}`);
      }

      const [dayOfMonth, month] = raw.split('/').map(Number);
      // As datas trazem só dd/MM. O ano só vira na passagem de dezembro para
      // janeiro; qualquer outro mês para trás é erro de digitação, não virada.
      if (lastMonth && month < lastMonth) {
        if (lastMonth === 12 && month === 1) year++;
        else throw new Error(`planejamento: data fora de ordem: ${raw} após mês ${lastMonth}`);
      }
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

  // Recesso de meio período existe. Os grupos de feriado saem sempre — senão
  // viram aula fantasma para marcar falta e matéria fantasma na frequência.
  const holiday = groups.some((g) => g.subject === holidayCode);
  const classes = groups.filter((g) => g.subject !== holidayCode);

  return {
    date,
    weekday,
    label,
    holiday,
    blocks: classes.map((g) => ({
      id: `${date}|${g.slots[0]}`,
      subject: g.subject,
      name: legend.get(g.subject) ?? g.subject,
      slots: g.slots,
      start: g.slots[0],
      end: addMinutes(g.slots.at(-1), periodMinutes)
    }))
  };
}

function findHeaderRow(rows, required) {
  return rows.findIndex((row) => {
    const header = row.map(normalize);
    return required.every((key) => header.includes(key));
  });
}

function columnsOf(row, names) {
  const columns = {};
  row.forEach((value, index) => {
    const key = normalize(value);
    if (names.includes(key) && columns[key] === undefined) columns[key] = index;
  });
  return columns;
}

// Aba de grade: a semana típica, com sala e professor por horário. O dia vem da
// coluna 'DIA DA SEMANA' (mesclada, então preenchida para baixo), conferida
// contra o dígito da coluna 0 quando ele existe.
export function parseGrade(csvText) {
  const rows = parseCsv(csvText);
  const meta = new Map();

  const headerRow = findHeaderRow(rows, ['HORARIO', 'DISCIPLINA', 'LOCAL']);
  if (headerRow === -1) {
    throw new Error('grade: cabeçalho (HORÁRIO/DISCIPLINA/LOCAL) não encontrado');
  }

  const column = columnsOf(rows[headerRow],
    ['DIA DA SEMANA', 'HORARIO', 'DISCIPLINA', 'LOCAL']);
  const dayColumn = column['DIA DA SEMANA'];
  const teacherColumn = column.LOCAL + 1;

  let weekday = null;
  for (let r = headerRow + 1; r < rows.length; r++) {
    if (dayColumn !== undefined) {
      const label = cell(rows, r, dayColumn);
      // Célula mesclada: só a primeira linha do grupo traz o nome do dia.
      if (label) {
        const parsed = weekdayFromLabel(label);
        if (parsed === null) {
          throw new Error(`grade: dia da semana não reconhecido: ${label}`);
        }
        weekday = parsed;
      }
    }

    const marker = cell(rows, r, 0);
    if (/^[1-7]$/.test(marker)) {
      if (weekday === null) weekday = Number(marker);
      else if (Number(marker) !== weekday) {
        throw new Error(
          `grade: linha ${r + 1} diz ${marker} mas o cabeçalho do grupo diz ${weekday}`);
      }
    }

    const time = cell(rows, r, column.HORARIO);
    const subject = cell(rows, r, column.DISCIPLINA);
    if (weekday === null || !isTime(time) || !subject) continue;

    meta.set(`${weekday}|${padTime(time)}`, {
      subject,
      room: cell(rows, r, column.LOCAL) || null,
      teacher: cell(rows, r, teacherColumn) || null
    });
  }

  if (meta.size === 0) {
    throw new Error('grade: nenhuma aula encontrada — a planilha mudou de forma');
  }

  return meta;
}

// Aba mestra de disciplinas: a coluna 'CH 50 MIN' é a carga horária em períodos
// de 50 min, que é o denominador certo para o cálculo de frequência.
export function parseSubjects(csvText, phase) {
  const rows = parseCsv(csvText);
  const subjects = new Map();

  const headerRow = findHeaderRow(rows, ['SIGLA', 'FASE', 'DISCIPLINA', 'CH 50 MIN']);
  if (headerRow === -1) {
    throw new Error('disciplinas: cabeçalho (SIGLA/FASE/DISCIPLINA/CH 50 MIN) não encontrado');
  }

  const column = columnsOf(rows[headerRow],
    ['SIGLA', 'FASE', 'COD SIGAA', 'DISCIPLINA', 'CH 50 MIN', 'PROFESSOR']);

  for (let r = headerRow + 1; r < rows.length; r++) {
    const code = cell(rows, r, column.SIGLA);
    if (!code || cell(rows, r, column.FASE) !== String(phase)) continue;

    const hours = Number(cell(rows, r, column['CH 50 MIN']).replace(',', '.'));
    subjects.set(code, {
      name: cell(rows, r, column.DISCIPLINA) || code,
      sigaa: cell(rows, r, column['COD SIGAA']) || null,
      teacher: cell(rows, r, column.PROFESSOR) || null,
      hours: Number.isFinite(hours) && hours > 0 ? hours : null
    });
  }

  if (subjects.size === 0) {
    throw new Error(`disciplinas: nenhuma disciplina da fase ${phase} encontrada`);
  }

  return subjects;
}

// Junta as três abas numa estrutura pronta para serializar: é ela que vai para o
// cache do banco e para o navegador.
export function buildSchedule({
  plannerCsv, gradeCsv, subjectsCsv,
  phase, holidayCode = 'Fer/Rec', periodMinutes = 50, frequencyLimit = 0.25
}) {
  const planner = parsePlanner(plannerCsv, { holidayCode, periodMinutes });
  const grade = gradeCsv ? parseGrade(gradeCsv) : new Map();
  const official = subjectsCsv ? parseSubjects(subjectsCsv, phase) : new Map();

  const subjects = {};
  for (const [code, count] of planner.periodCounts) {
    const info = official.get(code);
    // A carga horária oficial é a referência. Quando a matéria não está na
    // tabela (COORD, por exemplo), a contagem do planejamento é a melhor
    // aproximação — e o parseSubjects já garante que a tabela não veio vazia.
    const hours = info?.hours ?? count;
    subjects[code] = {
      code,
      name: info?.name ?? planner.legend.get(code) ?? code,
      teacher: info?.teacher ?? null,
      official: Boolean(info?.hours),
      hours,
      limit: Math.floor(hours * frequencyLimit)
    };
  }

  const days = {};
  const dates = [];
  for (const day of planner.days) {
    dates.push(day.date);
    days[day.date] = {
      date: day.date,
      weekday: day.weekday,
      label: day.label,
      holiday: day.holiday,
      blocks: day.blocks.map((block) => {
        // A grade descreve a semana típica; o planejamento manda. Só aproveitamos
        // a sala quando as duas concordam sobre qual é a matéria.
        const slotMeta = grade.get(`${day.weekday}|${block.start}`);
        const matches = slotMeta?.subject === block.subject;
        return {
          ...block,
          name: subjects[block.subject]?.name ?? block.name,
          room: matches ? slotMeta.room : null,
          teacher: (matches ? slotMeta.teacher : null)
            ?? subjects[block.subject]?.teacher ?? null
        };
      })
    };
  }

  return { year: planner.year, subjects, days, dates };
}
