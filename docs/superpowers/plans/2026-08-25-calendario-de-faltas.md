# Calendário de Faltas — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Um site onde amigos da 4ª fase marcam antecipadamente quais aulas vão faltar, com a grade vinda automaticamente de uma planilha pública do Google Sheets.

**Architecture:** Servidor Node que baixa e interpreta três abas CSV da planilha a cada 5 minutos, mantém o horário parseado em memória (com cópia no SQLite para sobreviver a reinício), e serve uma API JSON mais arquivos estáticos. O navegador só fala com esse servidor. Faltas são gravadas por período de 50 min, marcadas por aula inteira.

**Tech Stack:** Node 24 (`node:http`, `node:sqlite`, `node:crypto`, `node:test`), HTML/CSS/JS puro sem build. Zero dependências npm.

**Spec:** `docs/superpowers/specs/2026-08-25-calendario-de-faltas-design.md`

## Global Constraints

- **Zero dependências npm.** `package.json` não declara `dependencies` nem `devDependencies`. Nada de Express, better-sqlite3, dotenv, bcrypt. Se parecer que falta uma lib, use o módulo `node:` equivalente.
- **Node 24+**, ESM (`"type": "module"`). `node:sqlite` importa sem flag.
- **Nenhum horário de aula fixo no código.** Siglas como `ExtPes` ou `BD2` só podem aparecer em fixtures de teste e em asserções de teste — nunca na lógica de produção. A única exceção é `Fer/Rec`, que é um marcador estrutural da planilha (feriado), e mesmo ele fica numa constante nomeada em `config.js`.
- **`user_id` de qualquer escrita vem sempre da sessão**, nunca do corpo da requisição. Nenhuma rota aceita `userId` como entrada.
- **Parser localiza por conteúdo, nunca por índice fixo.** Nada de `rows[8]` ou `cells[17]` na lógica de produção.
- **Fuso `America/Sao_Paulo`** para decidir o que é "hoje".
- **Duração do período: 50 minutos.** Constante nomeada em `config.js`.
- **Limite de frequência: 25%** da carga horária (`floor(total * 0.25)`).
- Textos de interface em **português do Brasil**.
- Commits em português, no imperativo, terminando com `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `config.js` | Constantes: gids, porta, código do grupo, intervalos, fuso |
| `src/csv.js` | Texto CSV → matriz de strings. Nada de domínio |
| `src/dates.js` | Datas e horários: `dd/MM`→ISO, somar minutos, segunda-feira da semana |
| `src/sheets.js` | Interpreta as três abas. Funções puras: recebem texto, devolvem estruturas. Não faz rede, não toca no banco |
| `src/db.js` | Schema e todas as queries SQL. Único arquivo com SQL |
| `src/auth.js` | PIN (scrypt), tokens de sessão, cookies, rate limit. Sem SQL |
| `src/http.js` | Helpers de requisição/resposta, estáticos, headers de segurança |
| `src/schedule.js` | Busca os CSVs, agenda o refresh de 5 min, versiona, guarda cache |
| `src/api.js` | Rotas `/api/*`. Onde auth, db e schedule se encontram |
| `server.js` | Monta tudo e escuta |
| `public/js/api.js` | Cliente HTTP do navegador |
| `public/js/photo.js` | Corte e redimensionamento de foto no canvas |
| `public/js/auth.js` | Telas de login e cadastro |
| `public/js/grid.js` | Renderização da grade semanal |
| `public/js/panels.js` | Painéis: hoje, por matéria, frequência |
| `public/js/app.js` | Estado, polling, troca de telas |
| `public/css/style.css` | Todo o visual |

`sheets.js` não faz rede de propósito: é o arquivo mais provável de precisar de conserto quando a planilha mudar, e testá-lo com fixtures salvas é o que torna esse conserto rápido e seguro.

---

### Task 1: Fundação do projeto e fixtures da planilha

Cria o esqueleto e **congela** cópias reais dos CSVs no repositório. As fixtures precisam ser congeladas: os testes do parser afirmam coisas concretas (72 períodos de MetNum), e baixar a planilha ao vivo durante o teste tornaria a suíte instável e dependente de rede.

**Files:**
- Create: `package.json`, `config.js`
- Create: `test/fixtures/planner-hf4.csv`, `test/fixtures/grade-4fase.csv`, `test/fixtures/disciplinas.csv`
- Test: `test/fixtures.test.js`

**Interfaces:**
- Consumes: nada
- Produces: `config.js` com export default contendo `sheetId`, `gids`, `phase`, `port`, `dbPath`, `groupCode`, `refreshMs`, `periodMinutes`, `holidayCode`, `frequencyLimit`, `tz`, `sessionDays`, `secureCookies`

- [ ] **Step 1: Criar `package.json`**

```json
{
  "name": "stay-home-calendar",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=24" },
  "scripts": {
    "start": "node server.js",
    "test": "node --test test/**/*.test.js"
  }
}
```

O caminho do teste é um glob, não a pasta: `node --test test/` no Node 24 tenta
carregar `test/` como módulo e falha com `MODULE_NOT_FOUND`. O `sh` que o npm usa
entrega o padrão literal ao Node, que faz o próprio glob e casa também os arquivos
na raiz de `test/`.

Não adicione `dependencies` nem `devDependencies`. Se em algum momento parecer necessário, é sinal de que o módulo `node:` correto não foi encontrado.

- [ ] **Step 2: Criar `config.js`**

```js
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
```

- [ ] **Step 3: Baixar e congelar as fixtures**

```bash
mkdir -p test/fixtures
ID=1aBruvw1ZgEuZp2PM9d3ABqQ1akhmbhmbwWBxra5SpE8
BASE="https://docs.google.com/spreadsheets/d/$ID/export?format=csv&gid"
curl -sSL "$BASE=267797752"  -o test/fixtures/planner-hf4.csv
curl -sSL "$BASE=1283325522" -o test/fixtures/grade-4fase.csv
curl -sSL "$BASE=1802549288" -o test/fixtures/disciplinas.csv
wc -c test/fixtures/*.csv
```

Esperado: três arquivos, aproximadamente 6200, 3400 e 6900 bytes. Se algum vier com menos de 500 bytes ou começando com `<`, a planilha deixou de ser pública — pare e reporte.

- [ ] **Step 4: Escrever o teste-guarda das fixtures**

`test/fixtures.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const files = ['planner-hf4', 'grade-4fase', 'disciplinas'];

test('as fixtures existem e são CSV, não HTML de login', () => {
  for (const name of files) {
    const text = readFileSync(new URL(`./fixtures/${name}.csv`, import.meta.url), 'utf8');
    assert.ok(text.length > 500, `${name} está pequeno demais: ${text.length} bytes`);
    assert.ok(!text.trimStart().startsWith('<'),
      `${name} veio como HTML — a planilha pode ter deixado de ser pública`);
    assert.ok(text.includes(','), `${name} não parece CSV`);
  }
});
```

- [ ] **Step 5: Rodar os testes**

Run: `npm test`
Expected: 1 teste, PASS.

- [ ] **Step 6: Commit**

```bash
git add package.json config.js test/
git commit -m "Adiciona esqueleto do projeto e fixtures da planilha

Fixtures congeladas no repositório para que os testes do parser não
dependam de rede nem mudem quando a planilha for editada.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Utilitários puros — CSV e datas

Dois módulos sem dependências e sem estado, usados por quase todo o resto.

O CSV do Google contém vírgulas dentro de aspas (`"CIÊNCIA, TECNOLOGIA E SOCIEDADE"`), então `text.split(',')` não serve. Escreva um parser de verdade — são ~30 linhas.

**Files:**
- Create: `src/csv.js`, `src/dates.js`
- Test: `test/csv.test.js`, `test/dates.test.js`

**Interfaces:**
- Consumes: nada
- Produces:
  - `parseCsv(text) -> string[][]`
  - `isoDate(day, month, year) -> 'YYYY-MM-DD'`
  - `addMinutes(hhmm, minutes) -> 'HH:MM'`
  - `mondayOf(iso) -> 'YYYY-MM-DD'`
  - `weekDates(mondayIso) -> string[]` (6 datas, segunda a sábado)
  - `todayIso(tz) -> 'YYYY-MM-DD'`
  - `isTime(text) -> boolean`
  - `isDayMonth(text) -> boolean`

- [ ] **Step 1: Escrever os testes que falham**

`test/csv.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv } from '../src/csv.js';

test('separa campos simples', () => {
  assert.deepEqual(parseCsv('a,b,c'), [['a', 'b', 'c']]);
});

test('preserva vírgula dentro de aspas', () => {
  assert.deepEqual(parseCsv('a,"CIÊNCIA, TECNOLOGIA",c'),
    [['a', 'CIÊNCIA, TECNOLOGIA', 'c']]);
});

test('trata aspas duplicadas como uma aspa literal', () => {
  assert.deepEqual(parseCsv('a,"diz ""oi""",c'), [['a', 'diz "oi"', 'c']]);
});

test('preserva quebra de linha dentro de aspas', () => {
  assert.deepEqual(parseCsv('a,"linha1\nlinha2"'), [['a', 'linha1\nlinha2']]);
});

test('aceita CRLF e ignora a última linha vazia', () => {
  assert.deepEqual(parseCsv('a,b\r\nc,d\r\n'), [['a', 'b'], ['c', 'd']]);
});

test('preserva células vazias, inclusive no fim', () => {
  assert.deepEqual(parseCsv('a,,c,'), [['a', '', 'c', '']]);
});

test('preserva linha inteiramente vazia no meio', () => {
  assert.deepEqual(parseCsv('a\n\nb'), [['a'], [''], ['b']]);
});
```

`test/dates.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isoDate, addMinutes, mondayOf, weekDates, isTime, isDayMonth } from '../src/dates.js';

test('isoDate monta a data com zero à esquerda', () => {
  assert.equal(isoDate(3, 8, 2026), '2026-08-03');
  assert.equal(isoDate(19, 12, 2026), '2026-12-19');
});

test('addMinutes soma dentro da hora', () => {
  assert.equal(addMinutes('07:30', 50), '08:20');
});

test('addMinutes vira a hora', () => {
  assert.equal(addMinutes('09:10', 50), '10:00');
  assert.equal(addMinutes('16:20', 50), '17:10');
});

test('mondayOf devolve a segunda da semana', () => {
  assert.equal(mondayOf('2026-08-26'), '2026-08-24'); // quarta -> segunda
  assert.equal(mondayOf('2026-08-24'), '2026-08-24'); // segunda -> ela mesma
  assert.equal(mondayOf('2026-08-30'), '2026-08-24'); // domingo -> segunda anterior
});

test('weekDates devolve segunda a sábado', () => {
  assert.deepEqual(weekDates('2026-08-24'), [
    '2026-08-24', '2026-08-25', '2026-08-26',
    '2026-08-27', '2026-08-28', '2026-08-29'
  ]);
});

test('isTime reconhece horário e recusa o resto', () => {
  assert.equal(isTime('07:30'), true);
  assert.equal(isTime('7:30'), true);
  assert.equal(isTime(' 13:30 '), true);
  assert.equal(isTime('Data/Hr'), false);
  assert.equal(isTime(''), false);
});

test('isDayMonth reconhece dd/MM e recusa data completa', () => {
  assert.equal(isDayMonth('03/08'), true);
  assert.equal(isDayMonth('3/8'), true);
  assert.equal(isDayMonth('01/01/2026'), false);
  assert.equal(isDayMonth('Data'), false);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/csv.js'`.

- [ ] **Step 3: Implementar `src/csv.js`**

```js
// Parser de CSV conforme RFC 4180: aspas protegem vírgulas e quebras de linha,
// e uma aspa literal dentro de um campo entre aspas é escrita como "".
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];

    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else {
        field += c;
      }
      continue;
    }

    if (c === '"') { quoted = true; }
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') { field += c; }
  }

  row.push(field);
  rows.push(row);

  // Uma última linha vazia é artefato do \n final, não um dado.
  if (rows.length && rows.at(-1).length === 1 && rows.at(-1)[0] === '') rows.pop();

  return rows;
}
```

- [ ] **Step 4: Implementar `src/dates.js`**

```js
const pad = (n) => String(n).padStart(2, '0');

export function isoDate(day, month, year) {
  return `${year}-${pad(month)}-${pad(day)}`;
}

export function addMinutes(hhmm, minutes) {
  const [h, m] = hhmm.split(':').map(Number);
  const total = h * 60 + m + minutes;
  return `${pad(Math.floor(total / 60) % 24)}:${pad(total % 60)}`;
}

// Interpreta 'YYYY-MM-DD' como data neutra (UTC), sem deixar o fuso da máquina
// deslocar o dia.
function toUtc(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function fromUtc(date) {
  return isoDate(date.getUTCDate(), date.getUTCMonth() + 1, date.getUTCFullYear());
}

export function mondayOf(iso) {
  const date = toUtc(iso);
  const weekday = date.getUTCDay();          // 0 = domingo
  const back = weekday === 0 ? 6 : weekday - 1;
  date.setUTCDate(date.getUTCDate() - back);
  return fromUtc(date);
}

export function addDays(iso, days) {
  const date = toUtc(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return fromUtc(date);
}

export function weekDates(mondayIso) {
  return Array.from({ length: 6 }, (_, i) => addDays(mondayIso, i));
}

export function todayIso(tz) {
  // en-CA formata como YYYY-MM-DD, que é exatamente o formato ISO que usamos.
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
}

export function isTime(text) {
  return /^\d{1,2}:\d{2}$/.test(String(text).trim());
}

export function isDayMonth(text) {
  return /^\d{1,2}\/\d{1,2}$/.test(String(text).trim());
}
```

- [ ] **Step 5: Rodar os testes**

Run: `npm test`
Expected: PASS em todos.

- [ ] **Step 6: Commit**

```bash
git add src/csv.js src/dates.js test/csv.test.js test/dates.test.js
git commit -m "Adiciona parser de CSV e utilitários de data

O CSV do Google traz vírgulas dentro de aspas (nomes de disciplina),
então split(',') não serve. Datas usam UTC internamente para o fuso da
máquina não deslocar o dia.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Localizar a estrutura do planejamento

A aba de planejamento tem blocos de dia lado a lado, cada um com uma coluna `Data/Hr` seguida das colunas de horário. As posições **vão mudar** quando alguém editar a planilha, então nada de índices fixos: tudo é encontrado por conteúdo.

**Files:**
- Create: `src/sheets.js`
- Test: `test/sheets-layout.test.js`

**Interfaces:**
- Consumes: `parseCsv` (Task 2), `isTime` (Task 2)
- Produces:
  - `findPlannerLayout(rows) -> { headerRow, timeRow, dataStartRow, days: [{ label, weekday, dateCol, slots: [{ time, col }] }] }`
  - `parseYear(rows, headerRow) -> number`
  - `cell(rows, r, c) -> string` (helper interno exportado para reuso nas próximas tasks)

`weekday` segue a convenção da própria planilha: 2 = segunda … 7 = sábado.

- [ ] **Step 1: Escrever o teste que falha**

`test/sheets-layout.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseCsv } from '../src/csv.js';
import { findPlannerLayout, parseYear } from '../src/sheets.js';

const rows = parseCsv(readFileSync(
  new URL('./fixtures/planner-hf4.csv', import.meta.url), 'utf8'));

test('encontra os seis dias da semana', () => {
  const layout = findPlannerLayout(rows);
  assert.equal(layout.days.length, 6);
  assert.deepEqual(layout.days.map(d => d.weekday), [2, 3, 4, 5, 6, 7]);
  assert.match(layout.days[0].label, /SEGUNDA/i);
  assert.match(layout.days[5].label, /SÁBADO/i);
});

test('encontra os horários de cada dia', () => {
  const layout = findPlannerLayout(rows);
  assert.deepEqual(layout.days[0].slots.map(s => s.time),
    ['07:30', '08:20', '09:10', '10:20', '11:10', '13:30', '14:20', '15:30', '16:20']);
  // sábado tem menos períodos que os outros dias
  assert.equal(layout.days[5].slots.length, 5);
});

test('as colunas de cada dia são distintas e crescentes', () => {
  const layout = findPlannerLayout(rows);
  const dateCols = layout.days.map(d => d.dateCol);
  assert.deepEqual(dateCols, [...dateCols].sort((a, b) => a - b));
  assert.equal(new Set(dateCols).size, 6);
  for (const day of layout.days) {
    assert.ok(day.slots[0].col > day.dateCol,
      'os horários vêm depois da coluna de data');
  }
});

test('lê o ano do cabeçalho', () => {
  const layout = findPlannerLayout(rows);
  assert.equal(parseYear(rows, layout.headerRow), 2026);
});

test('recusa uma planilha sem a linha dos dias', () => {
  assert.throws(() => findPlannerLayout([['a', 'b'], ['c', 'd']]),
    /dias da semana/);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/sheets.js'`.

- [ ] **Step 3: Implementar**

`src/sheets.js`:

```js
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
```

- [ ] **Step 4: Rodar os testes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sheets.js test/sheets-layout.test.js
git commit -m "Localiza a estrutura da aba de planejamento por conteúdo

Dias, colunas de data e horários são encontrados procurando o texto, não
por índice fixo, para sobreviver a edições na planilha.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Ler a legenda de siglas

Acima da grade há uma área `LEGENDA` que mapeia `BD2` → `BANCO DE DADOS II`. As células mescladas fazem o espaçamento variar (às vezes a sigla e o nome ficam a 2 colunas de distância, às vezes a 3), então a leitura não pode assumir deslocamento fixo: junte as células não-vazias em ordem e pareie duas a duas.

**Files:**
- Modify: `src/sheets.js`
- Test: `test/sheets-legend.test.js`

**Interfaces:**
- Consumes: `cell` (Task 3)
- Produces: `parseLegend(rows, headerRow) -> Map<string, string>`

- [ ] **Step 1: Escrever o teste que falha**

`test/sheets-legend.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseCsv } from '../src/csv.js';
import { findPlannerLayout, parseLegend } from '../src/sheets.js';

const rows = parseCsv(readFileSync(
  new URL('./fixtures/planner-hf4.csv', import.meta.url), 'utf8'));
const { headerRow } = findPlannerLayout(rows);

test('mapeia sigla para nome completo', () => {
  const legend = parseLegend(rows, headerRow);
  assert.equal(legend.get('BD2'), 'BANCO DE DADOS II');
  assert.equal(legend.get('SO'), 'SISTEMAS OPERACIONAIS');
  assert.equal(legend.get('DWeb-I'), 'DESENVOLVIMENTO WEB I');
});

test('lê nome que contém vírgula', () => {
  const legend = parseLegend(rows, headerRow);
  assert.equal(legend.get('CiTecSO'), 'CIÊNCIA, TECNOLOGIA E SOCIEDADE');
});

test('lê par cuja sigla e nome têm o mesmo tamanho', () => {
  // 'Fisica' e 'FÍSICA' têm 6 caracteres — um filtro por comprimento perderia este
  const legend = parseLegend(rows, headerRow);
  assert.equal(legend.get('Fisica'), 'FÍSICA');
});

test('inclui o marcador de feriado', () => {
  const legend = parseLegend(rows, headerRow);
  assert.equal(legend.get('Fer/Rec'), 'FERIADO / RECESSO');
});

test('ignora o título do curso, que fica à esquerda da legenda', () => {
  const legend = parseLegend(rows, headerRow);
  for (const name of legend.values()) {
    assert.ok(!name.includes('Campus Videira'),
      'o título do curso não é uma disciplina');
  }
});

test('devolve mapa vazio quando não há legenda', () => {
  assert.equal(parseLegend([['a'], ['b']], 2).size, 0);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test`
Expected: FAIL — `parseLegend is not a function`.

- [ ] **Step 3: Implementar (adicionar a `src/sheets.js`)**

```js
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
```

- [ ] **Step 4: Rodar os testes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sheets.js test/sheets-legend.test.js
git commit -m "Lê a legenda de siglas do planejamento

Pareamento por ordem em vez de deslocamento fixo, porque as células
mescladas fazem a distância entre sigla e nome variar.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Montar os dias e as aulas

Junta layout e legenda para produzir a lista de dias do semestre, com as aulas já agrupadas.

**Regra de agrupamento:** períodos consecutivos com a mesma sigla viram uma aula só, **mas apenas se o período seguinte começar exatamente quando o anterior termina**. Isso separa naturalmente as aulas em torno do intervalo (09:10 termina 10:00, o próximo começa 10:20) sem precisar codificar horários de intervalo. Verificado contra a planilha real: nenhuma matéria atravessa um intervalo, então a regra não fragmenta nada que devesse ficar junto.

**Files:**
- Modify: `src/sheets.js`
- Test: `test/sheets-planner.test.js`

**Interfaces:**
- Consumes: `findPlannerLayout`, `parseLegend`, `parseYear`, `isDayMonth`, `isoDate`, `addMinutes`
- Produces: `parsePlanner(csvText, { holidayCode, periodMinutes }) -> { year, legend, periodCounts: Map<string,number>, days: Day[] }`
  onde `Day = { date, weekday, label, holiday, blocks: Block[] }`
  e `Block = { id, subject, name, slots: string[], start, end }`, com `id = \`${date}|${start}\``

- [ ] **Step 1: Escrever o teste que falha**

`test/sheets-planner.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parsePlanner } from '../src/sheets.js';

const csv = readFileSync(
  new URL('./fixtures/planner-hf4.csv', import.meta.url), 'utf8');
const planner = parsePlanner(csv, { holidayCode: 'Fer/Rec', periodMinutes: 50 });
const byDate = new Map(planner.days.map((d) => [d.date, d]));

test('cobre o semestre inteiro', () => {
  assert.equal(planner.days.length, 120);   // 20 semanas x 6 dias
  assert.equal(planner.year, 2026);
  assert.equal(planner.days[0].date, '2026-08-03');
  assert.equal(planner.days.at(-1).date, '2026-12-19');
});

test('agrupa períodos consecutivos da mesma matéria numa aula só', () => {
  const blocks = byDate.get('2026-08-03').blocks;
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].subject, 'ExtPes');
  assert.deepEqual(blocks[0].slots, ['07:30', '08:20', '09:10']);
  assert.equal(blocks[0].start, '07:30');
  assert.equal(blocks[0].end, '10:00');
  assert.equal(blocks[1].subject, 'DWeb-I');
  assert.deepEqual(blocks[1].slots, ['10:20', '11:10']);
  assert.equal(blocks[1].end, '12:00');
});

test('não funde aulas através do intervalo', () => {
  for (const day of planner.days) {
    for (const block of day.blocks) {
      assert.ok(!block.slots.includes('09:10') || !block.slots.includes('10:20'),
        `${day.date}: aula atravessou o intervalo`);
    }
  }
});

test('resolve o nome completo pela legenda', () => {
  assert.equal(byDate.get('2026-08-03').blocks[0].name,
    'EXTENSÃO E PESQUISA EM COMPUTAÇÃO');
});

test('marca feriado e não gera aulas nele', () => {
  const day = byDate.get('2026-09-07');   // Independência
  assert.equal(day.holiday, true);
  assert.deepEqual(day.blocks, []);
});

test('dia sem aula não é feriado, é só vazio', () => {
  const saturday = byDate.get('2026-08-08');
  assert.equal(saturday.weekday, 7);
  assert.equal(saturday.holiday, false);
  assert.deepEqual(saturday.blocks, []);
});

test('acompanha a mudança de horário no meio do semestre', () => {
  // terça era Física até outubro e virou BD2 em novembro
  const october = byDate.get('2026-10-27').blocks.map((b) => b.subject);
  const november = byDate.get('2026-11-03').blocks.map((b) => b.subject);
  assert.ok(october.includes('Fisica'));
  assert.ok(!november.includes('Fisica'));
  assert.ok(november.includes('BD2'));
});

test('o id do bloco identifica data e início', () => {
  assert.equal(byDate.get('2026-08-03').blocks[0].id, '2026-08-03|07:30');
});

test('conta os períodos de cada matéria no semestre', () => {
  // confere com a carga horária oficial: 72, 72, 36 batem exatamente
  assert.equal(planner.periodCounts.get('MetNum'), 72);
  assert.equal(planner.periodCounts.get('BD2'), 72);
  assert.equal(planner.periodCounts.get('CiTecSO'), 36);
  assert.ok(!planner.periodCounts.has('Fer/Rec'),
    'feriado não é matéria e não entra na contagem');
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test`
Expected: FAIL — `parsePlanner is not a function`.

- [ ] **Step 3: Implementar (adicionar a `src/sheets.js`)**

```js
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
```

- [ ] **Step 4: Rodar os testes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sheets.js test/sheets-planner.test.js
git commit -m "Monta os dias e agrupa períodos em aulas

Períodos consecutivos da mesma matéria viram uma aula, desde que o
seguinte comece quando o anterior termina — o que separa as aulas em
torno do intervalo sem codificar horários de intervalo.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Ler sala, professor e carga horária oficial

Duas abas auxiliares. A de grade dá sala e professor por dia/horário; a mestra dá a carga horária oficial em períodos de 50 min, que é o denominador do contador de frequência.

**Files:**
- Modify: `src/sheets.js`
- Test: `test/sheets-meta.test.js`

**Interfaces:**
- Consumes: `parseCsv`, `cell`, `isTime`
- Produces:
  - `parseGrade(csvText) -> Map<string, { subject, room, teacher }>` com chave `` `${weekday}|${time}` ``
  - `parseSubjects(csvText, phase) -> Map<string, { name, sigaa, teacher, hours }>`

- [ ] **Step 1: Escrever o teste que falha**

`test/sheets-meta.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseGrade, parseSubjects } from '../src/sheets.js';

const read = (name) =>
  readFileSync(new URL(`./fixtures/${name}.csv`, import.meta.url), 'utf8');

test('grade dá sala e professor por dia e horário', () => {
  const grade = parseGrade(read('grade-4fase'));
  assert.deepEqual(grade.get('2|07:30'),
    { subject: 'ExtPes', room: 'D04', teacher: 'Leila L Rossi' });
  assert.deepEqual(grade.get('2|10:20'),
    { subject: 'DWeb-I', room: 'D04', teacher: 'Fabricio Bizotto' });
});

test('grade ignora horários sem disciplina', () => {
  const grade = parseGrade(read('grade-4fase'));
  assert.equal(grade.size, 25);   // 5 dias x 5 períodos de manhã
  for (const meta of grade.values()) assert.ok(meta.subject.length > 0);
});

test('grade devolve mapa vazio quando o cabeçalho não existe', () => {
  assert.equal(parseGrade('a,b\nc,d').size, 0);
});

test('disciplinas trazem carga horária oficial em períodos de 50 min', () => {
  const subjects = parseSubjects(read('disciplinas'), '4');
  assert.equal(subjects.size, 7);
  assert.deepEqual(subjects.get('Fisica'), {
    name: 'FÍSICA', sigaa: 'CCC0725', teacher: 'Cíntia F Silva', hours: 36
  });
  assert.equal(subjects.get('MetNum').hours, 72);
});

test('disciplinas filtram pela fase pedida', () => {
  const fourth = parseSubjects(read('disciplinas'), '4');
  const second = parseSubjects(read('disciplinas'), '2');
  assert.ok(fourth.has('BD2'));
  assert.ok(!second.has('BD2'));
  assert.ok(second.size > 0);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test`
Expected: FAIL — `parseGrade is not a function`.

- [ ] **Step 3: Implementar (adicionar a `src/sheets.js`)**

```js
// Compara cabeçalhos ignorando acento, caixa e espaço em volta, porque a
// planilha alterna entre 'HORÁRIO' e 'HORARIO', 'CH 50 MIN' e variações.
const normalize = (s) => String(s).trim().toUpperCase()
  .normalize('NFD').replace(/\p{Diacritic}/gu, '');

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

// Aba de grade: dia da semana na coluna 0 (2..7), depois horário, disciplina,
// sala e — sem cabeçalho próprio — professor logo após a sala.
export function parseGrade(csvText) {
  const rows = parseCsv(csvText);
  const meta = new Map();

  const headerRow = findHeaderRow(rows, ['HORARIO', 'DISCIPLINA', 'LOCAL']);
  if (headerRow === -1) return meta;

  const column = columnsOf(rows[headerRow], ['HORARIO', 'DISCIPLINA', 'LOCAL']);
  const teacherColumn = column.LOCAL + 1;

  for (let r = headerRow + 1; r < rows.length; r++) {
    const weekday = cell(rows, r, 0);
    const time = cell(rows, r, column.HORARIO);
    if (!/^[2-7]$/.test(weekday) || !isTime(time)) continue;

    const subject = cell(rows, r, column.DISCIPLINA);
    if (!subject) continue;

    meta.set(`${weekday}|${time}`, {
      subject,
      room: cell(rows, r, column.LOCAL) || null,
      teacher: cell(rows, r, teacherColumn) || null
    });
  }

  return meta;
}

// Aba mestra de disciplinas: a coluna 'CH 50 MIN' é a carga horária em períodos
// de 50 min, que é o denominador certo para o cálculo de frequência.
export function parseSubjects(csvText, phase) {
  const rows = parseCsv(csvText);
  const subjects = new Map();

  const headerRow = findHeaderRow(rows, ['SIGLA', 'FASE', 'DISCIPLINA', 'CH 50 MIN']);
  if (headerRow === -1) return subjects;

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

  return subjects;
}
```

- [ ] **Step 4: Rodar os testes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sheets.js test/sheets-meta.test.js
git commit -m "Lê sala, professor e carga horária oficial

A coluna CH 50 MIN da aba mestra é o denominador do contador de
frequência, porque é o número que a instituição usa para os 25%.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Combinar as três abas num horário só

Junta planejamento, grade e disciplinas numa estrutura serializável — é ela que vai para o cache e para o navegador.

**Detalhe que importa:** a aba de grade descreve a semana *típica*, mas o planejamento manda. Quando o planejamento diz `BD2` numa terça em que a grade ainda diz `Fisica`, a sala da grade seria a sala errada. Por isso a sala só é usada quando a disciplina bate; senão fica `null` e o professor vem da aba mestra.

**Files:**
- Modify: `src/sheets.js`
- Test: `test/sheets-build.test.js`

**Interfaces:**
- Consumes: `parsePlanner`, `parseGrade`, `parseSubjects`
- Produces: `buildSchedule({ plannerCsv, gradeCsv, subjectsCsv, phase, holidayCode, periodMinutes, frequencyLimit }) -> Schedule`

```js
Schedule = {
  year: number,
  subjects: { [code]: { code, name, teacher, hours, limit } },  // limit = floor(hours*0.25)
  days: { [isoDate]: { date, weekday, label, holiday, blocks: Block[] } },
  dates: string[],                       // todas as datas, em ordem
  Block = { id, subject, name, slots, start, end, room, teacher }
}
```

- [ ] **Step 1: Escrever o teste que falha**

`test/sheets-build.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildSchedule } from '../src/sheets.js';

const read = (name) =>
  readFileSync(new URL(`./fixtures/${name}.csv`, import.meta.url), 'utf8');

const schedule = buildSchedule({
  plannerCsv: read('planner-hf4'),
  gradeCsv: read('grade-4fase'),
  subjectsCsv: read('disciplinas'),
  phase: '4', holidayCode: 'Fer/Rec', periodMinutes: 50, frequencyLimit: 0.25
});

test('indexa os dias por data', () => {
  assert.equal(schedule.dates.length, 120);
  assert.equal(schedule.dates[0], '2026-08-03');
  assert.equal(schedule.days['2026-08-03'].weekday, 2);
});

test('acrescenta sala e professor às aulas', () => {
  const block = schedule.days['2026-08-03'].blocks[0];
  assert.equal(block.subject, 'ExtPes');
  assert.equal(block.room, 'D04');
  assert.equal(block.teacher, 'Leila L Rossi');
});

test('não usa a sala da grade quando a matéria do dia é outra', () => {
  // em novembro a terça virou BD2, mas a grade ainda descreve Física naquele horário
  const block = schedule.days['2026-11-03'].blocks
    .find((b) => b.subject === 'BD2' && b.start === '10:20');
  assert.ok(block, 'BD2 deveria aparecer na terça de novembro');
  assert.equal(block.room, null);
  assert.equal(block.teacher, 'Leila L Rossi');   // veio da aba mestra
});

test('calcula o limite de faltas de cada matéria', () => {
  assert.equal(schedule.subjects.Fisica.hours, 36);
  assert.equal(schedule.subjects.Fisica.limit, 9);
  assert.equal(schedule.subjects.MetNum.limit, 18);
});

test('inclui matéria que aparece no planejamento mas não na aba mestra', () => {
  // COORD é o Fórum COMPUTATALK: está na legenda e no calendário, não na tabela do SIGAA
  assert.ok(schedule.subjects.COORD, 'COORD deveria existir');
  assert.equal(schedule.subjects.COORD.hours, 17);   // cai para a contagem do planejamento
});

test('é serializável em JSON sem perder nada', () => {
  const round = JSON.parse(JSON.stringify(schedule));
  assert.deepEqual(round, schedule);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test`
Expected: FAIL — `buildSchedule is not a function`.

- [ ] **Step 3: Implementar (adicionar a `src/sheets.js`)**

```js
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
    // A carga horária oficial é a referência; sem ela, a contagem do
    // planejamento é a melhor aproximação disponível.
    const hours = info?.hours ?? count;
    subjects[code] = {
      code,
      name: info?.name ?? planner.legend.get(code) ?? code,
      teacher: info?.teacher ?? null,
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
```

- [ ] **Step 4: Rodar os testes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sheets.js test/sheets-build.test.js
git commit -m "Combina planejamento, grade e disciplinas num horário só

A sala da grade só é usada quando a disciplina bate com a do
planejamento, senão seria a sala de uma aula que mudou no meio do
semestre.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Banco de dados

Único arquivo com SQL. `node:sqlite` é síncrono, o que simplifica muito: sem callbacks, sem pool, e transações são só `BEGIN`/`COMMIT`.

**Files:**
- Create: `src/db.js`
- Test: `test/db.test.js`

**Interfaces:**
- Consumes: nada
- Produces:
  - `openDb(path) -> DatabaseSync` (cria diretórios, aplica schema e pragmas)
  - `createUser(db, { name, color, pinHash, pinSalt, photo, photoType }) -> PublicUser`
  - `findUserByName(db, name) -> row | undefined` (inclui `pin_hash`, `pin_salt`)
  - `getUser(db, id) -> PublicUser | undefined`
  - `listUsers(db) -> PublicUser[]`
  - `updateUser(db, id, { color, photo, photoType }) -> PublicUser`
  - `getPhoto(db, id) -> { photo, photo_type, photo_version } | undefined`
  - `createSession(db, tokenHash, userId)`, `findSession(db, tokenHash) -> { user_id } | undefined`
  - `touchSession(db, tokenHash)`, `deleteSession(db, tokenHash)`, `purgeSessions(db, maxAgeDays)`
  - `setAbsence(db, { userId, date, slots, subject, value, reason }) -> { changed: boolean }`
  - `setReason(db, { userId, date, slots, reason }) -> { changed: boolean }`
  - `absencesBetween(db, from, to) -> [{ user_id, date, slot, subject, reason }]`
  - `absenceCounts(db, userId) -> [{ subject, count }]`
  - `getCache(db, key) -> { value, fetched_at } | undefined`, `setCache(db, key, value)`

`PublicUser = { id, name, color, hasPhoto, photoVersion }` — nunca inclui hash nem salt.

- [ ] **Step 1: Escrever o teste que falha**

`test/db.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  openDb, createUser, findUserByName, getUser, listUsers, updateUser, getPhoto,
  createSession, findSession, deleteSession,
  setAbsence, setReason, absencesBetween, absenceCounts,
  getCache, setCache
} from '../src/db.js';

const fresh = () => openDb(':memory:');
const makeUser = (db, name) => createUser(db, {
  name, color: '#abc', pinHash: 'h', pinSalt: 's', photo: null, photoType: null
});

test('cria usuário e nunca devolve o hash do PIN', () => {
  const db = fresh();
  const user = makeUser(db, 'João');
  assert.equal(user.name, 'João');
  assert.equal(user.hasPhoto, false);
  assert.equal(user.pinHash, undefined);
  assert.equal(user.pin_hash, undefined);
  assert.deepEqual(getUser(db, user.id), user);
});

test('nome é único ignorando caixa e acento não conta como igual', () => {
  const db = fresh();
  makeUser(db, 'João');
  assert.throws(() => makeUser(db, 'joão'), /já existe/i);
  assert.doesNotThrow(() => makeUser(db, 'Joao'));
});

test('busca por nome ignora caixa e traz o hash para conferência', () => {
  const db = fresh();
  makeUser(db, 'João');
  const row = findUserByName(db, 'JOÃO');
  assert.equal(row.pin_hash, 'h');
  assert.equal(findUserByName(db, 'ninguém'), undefined);
});

test('guardar foto incrementa a versão, para invalidar cache do navegador', () => {
  const db = fresh();
  const user = makeUser(db, 'Ana');
  assert.equal(user.photoVersion, 0);
  const bytes = new Uint8Array([1, 2, 3]);
  const updated = updateUser(db, user.id, { photo: bytes, photoType: 'image/webp' });
  assert.equal(updated.hasPhoto, true);
  assert.equal(updated.photoVersion, 1);
  assert.deepEqual(getPhoto(db, user.id).photo, bytes);
});

test('marcar falta grava um período por vez e é idempotente', () => {
  const db = fresh();
  const user = makeUser(db, 'Ana');
  const args = { userId: user.id, date: '2026-08-03', slots: ['07:30', '08:20'], subject: 'MAT' };

  assert.equal(setAbsence(db, { ...args, value: true }).changed, true);
  assert.equal(setAbsence(db, { ...args, value: true }).changed, false);
  assert.equal(absencesBetween(db, '2026-08-01', '2026-08-31').length, 2);

  assert.equal(setAbsence(db, { ...args, value: false }).changed, true);
  assert.equal(absencesBetween(db, '2026-08-01', '2026-08-31').length, 0);
});

test('faltas de um usuário não tocam nas de outro', () => {
  const db = fresh();
  const ana = makeUser(db, 'Ana');
  const joao = makeUser(db, 'João');
  const args = { date: '2026-08-03', slots: ['07:30'], subject: 'MAT', value: true };

  setAbsence(db, { ...args, userId: ana.id });
  setAbsence(db, { ...args, userId: joao.id });
  setAbsence(db, { ...args, userId: ana.id, value: false });

  const rows = absencesBetween(db, '2026-08-03', '2026-08-03');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].user_id, joao.id);
});

test('o intervalo de busca é inclusivo nas duas pontas', () => {
  const db = fresh();
  const user = makeUser(db, 'Ana');
  for (const date of ['2026-08-02', '2026-08-03', '2026-08-08', '2026-08-09']) {
    setAbsence(db, { userId: user.id, date, slots: ['07:30'], subject: 'MAT', value: true });
  }
  const rows = absencesBetween(db, '2026-08-03', '2026-08-08');
  assert.deepEqual(rows.map((r) => r.date), ['2026-08-03', '2026-08-08']);
});

test('motivo é gravado na marcação e pode ser alterado depois', () => {
  const db = fresh();
  const user = makeUser(db, 'Ana');
  const slots = ['07:30', '08:20'];
  setAbsence(db, { userId: user.id, date: '2026-08-03', slots, subject: 'MAT', value: true, reason: 'consulta' });

  let rows = absencesBetween(db, '2026-08-03', '2026-08-03');
  assert.deepEqual(rows.map((r) => r.reason), ['consulta', 'consulta']);

  setReason(db, { userId: user.id, date: '2026-08-03', slots, reason: 'prova' });
  rows = absencesBetween(db, '2026-08-03', '2026-08-03');
  assert.deepEqual(rows.map((r) => r.reason), ['prova', 'prova']);
});

test('conta faltas por matéria', () => {
  const db = fresh();
  const user = makeUser(db, 'Ana');
  setAbsence(db, { userId: user.id, date: '2026-08-03', slots: ['07:30', '08:20'], subject: 'MAT', value: true });
  setAbsence(db, { userId: user.id, date: '2026-08-10', slots: ['07:30'], subject: 'MAT', value: true });
  setAbsence(db, { userId: user.id, date: '2026-08-04', slots: ['07:30'], subject: 'FIS', value: true });

  const counts = Object.fromEntries(absenceCounts(db, user.id).map((r) => [r.subject, r.count]));
  assert.deepEqual(counts, { MAT: 3, FIS: 1 });
});

test('apagar usuário leva junto faltas e sessões', () => {
  const db = fresh();
  const user = makeUser(db, 'Ana');
  setAbsence(db, { userId: user.id, date: '2026-08-03', slots: ['07:30'], subject: 'MAT', value: true });
  createSession(db, 'token-hash', user.id);

  db.prepare('DELETE FROM users WHERE id = ?').run(user.id);
  assert.equal(absencesBetween(db, '2026-08-03', '2026-08-03').length, 0);
  assert.equal(findSession(db, 'token-hash'), undefined);
});

test('sessão é encontrada pelo hash e some ao ser apagada', () => {
  const db = fresh();
  const user = makeUser(db, 'Ana');
  createSession(db, 'abc', user.id);
  assert.equal(findSession(db, 'abc').user_id, user.id);
  deleteSession(db, 'abc');
  assert.equal(findSession(db, 'abc'), undefined);
});

test('cache guarda e sobrescreve pelo mesmo nome', () => {
  const db = fresh();
  assert.equal(getCache(db, 'schedule'), undefined);
  setCache(db, 'schedule', '{"a":1}');
  setCache(db, 'schedule', '{"a":2}');
  assert.equal(getCache(db, 'schedule').value, '{"a":2}');
  assert.ok(getCache(db, 'schedule').fetched_at);
});

test('listUsers vem em ordem de nome', () => {
  const db = fresh();
  makeUser(db, 'Zeca'); makeUser(db, 'Ana'); makeUser(db, 'joão');
  assert.deepEqual(listUsers(db).map((u) => u.name), ['Ana', 'joão', 'Zeca']);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/db.js'`.

- [ ] **Step 3: Implementar `src/db.js`**

```js
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  name_key      TEXT NOT NULL UNIQUE,
  color         TEXT NOT NULL,
  photo         BLOB,
  photo_type    TEXT,
  photo_version INTEGER NOT NULL DEFAULT 0,
  pin_hash      TEXT NOT NULL,
  pin_salt      TEXT NOT NULL,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  last_seen  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS absences (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date       TEXT NOT NULL,
  slot       TEXT NOT NULL,
  subject    TEXT NOT NULL,
  reason     TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, date, slot)
);
CREATE INDEX IF NOT EXISTS idx_absences_date ON absences(date);
CREATE INDEX IF NOT EXISTS idx_absences_user_subject ON absences(user_id, subject);

CREATE TABLE IF NOT EXISTS cache (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  fetched_at TEXT NOT NULL
);
`;

const now = () => new Date().toISOString();

// Chave de unicidade do nome: só a caixa é ignorada. 'João' e 'Joao' continuam
// sendo pessoas diferentes, porque podem mesmo ser.
const nameKey = (name) => name.trim().toLowerCase();

export function openDb(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}

const PUBLIC_COLUMNS =
  'id, name, color, photo_version, (photo IS NOT NULL) AS has_photo';

const toPublic = (row) => row && {
  id: row.id,
  name: row.name,
  color: row.color,
  hasPhoto: Boolean(row.has_photo),
  photoVersion: row.photo_version
};

export function createUser(db, { name, color, pinHash, pinSalt, photo, photoType }) {
  const key = nameKey(name);
  const exists = db.prepare('SELECT 1 FROM users WHERE name_key = ?').get(key);
  if (exists) throw new Error('Esse nome já existe');

  const info = db.prepare(`
    INSERT INTO users (name, name_key, color, photo, photo_type, photo_version,
                       pin_hash, pin_salt, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(name.trim(), key, color, photo ?? null, photoType ?? null,
         photo ? 1 : 0, pinHash, pinSalt, now());

  return getUser(db, Number(info.lastInsertRowid));
}

export function findUserByName(db, name) {
  return db.prepare('SELECT * FROM users WHERE name_key = ?').get(nameKey(name));
}

export function getUser(db, id) {
  return toPublic(db.prepare(`SELECT ${PUBLIC_COLUMNS} FROM users WHERE id = ?`).get(id));
}

export function listUsers(db) {
  return db.prepare(`SELECT ${PUBLIC_COLUMNS} FROM users ORDER BY name_key`)
    .all().map(toPublic);
}

export function updateUser(db, id, { color, photo, photoType }) {
  if (color !== undefined) {
    db.prepare('UPDATE users SET color = ? WHERE id = ?').run(color, id);
  }
  if (photo !== undefined) {
    db.prepare(`
      UPDATE users SET photo = ?, photo_type = ?, photo_version = photo_version + 1
      WHERE id = ?
    `).run(photo, photoType ?? null, id);
  }
  return getUser(db, id);
}

export function getPhoto(db, id) {
  return db.prepare('SELECT photo, photo_type, photo_version FROM users WHERE id = ?').get(id);
}

export function createSession(db, tokenHash, userId) {
  db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, last_seen) VALUES (?, ?, ?, ?)')
    .run(tokenHash, userId, now(), now());
}

export function findSession(db, tokenHash) {
  return db.prepare('SELECT * FROM sessions WHERE token_hash = ?').get(tokenHash);
}

export function touchSession(db, tokenHash) {
  db.prepare('UPDATE sessions SET last_seen = ? WHERE token_hash = ?').run(now(), tokenHash);
}

export function deleteSession(db, tokenHash) {
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
}

export function purgeSessions(db, maxAgeDays) {
  const cutoff = new Date(Date.now() - maxAgeDays * 86400_000).toISOString();
  db.prepare('DELETE FROM sessions WHERE last_seen < ?').run(cutoff);
}

// Grava ou apaga todos os períodos de uma aula numa transação só: ou a aula
// inteira muda, ou nada muda.
export function setAbsence(db, { userId, date, slots, subject, value, reason = null }) {
  const insert = db.prepare(`
    INSERT INTO absences (user_id, date, slot, subject, reason, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (user_id, date, slot) DO NOTHING
  `);
  const remove = db.prepare('DELETE FROM absences WHERE user_id = ? AND date = ? AND slot = ?');

  let changed = 0;
  db.exec('BEGIN');
  try {
    for (const slot of slots) {
      const info = value
        ? insert.run(userId, date, slot, subject, reason, now())
        : remove.run(userId, date, slot);
      changed += info.changes;
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return { changed: changed > 0 };
}

export function setReason(db, { userId, date, slots, reason }) {
  const update = db.prepare(
    'UPDATE absences SET reason = ? WHERE user_id = ? AND date = ? AND slot = ?');
  let changed = 0;
  db.exec('BEGIN');
  try {
    for (const slot of slots) changed += update.run(reason, userId, date, slot).changes;
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return { changed: changed > 0 };
}

export function absencesBetween(db, from, to) {
  return db.prepare(`
    SELECT user_id, date, slot, subject, reason FROM absences
    WHERE date BETWEEN ? AND ?
    ORDER BY date, slot
  `).all(from, to);
}

export function absenceCounts(db, userId) {
  return db.prepare(`
    SELECT subject, COUNT(*) AS count FROM absences
    WHERE user_id = ? GROUP BY subject
  `).all(userId);
}

export function getCache(db, key) {
  return db.prepare('SELECT value, fetched_at FROM cache WHERE key = ?').get(key);
}

export function setCache(db, key, value) {
  db.prepare(`
    INSERT INTO cache (key, value, fetched_at) VALUES (?, ?, ?)
    ON CONFLICT (key) DO UPDATE SET value = excluded.value, fetched_at = excluded.fetched_at
  `).run(key, value, now());
}
```

- [ ] **Step 4: Rodar os testes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/db.js test/db.test.js
git commit -m "Adiciona camada de banco em SQLite

Chave (user_id, date, slot) torna a marcação idempotente e a transação
garante que uma aula inteira muda de uma vez. Consultas públicas nunca
selecionam pin_hash.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: PIN, sessões e rate limit

Criptografia e cookies. Nenhum SQL aqui.

**Files:**
- Create: `src/auth.js`
- Test: `test/auth.test.js`

**Interfaces:**
- Consumes: nada
- Produces:
  - `hashPin(pin) -> Promise<{ hash, salt }>`
  - `verifyPin(pin, hash, salt) -> Promise<boolean>`
  - `newToken() -> string`, `hashToken(token) -> string`
  - `sessionCookie(token, { secure, days }) -> string`, `clearedCookie({ secure }) -> string`
  - `readCookie(header, name) -> string | null`
  - `constantEquals(a, b) -> boolean`
  - `createRateLimiter({ max, windowMs }) -> { allow(key) -> boolean, reset() }`
  - `validPin(pin) -> boolean`, `validName(name) -> boolean`

- [ ] **Step 1: Escrever o teste que falha**

`test/auth.test.js`:

```js
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
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/auth.js'`.

- [ ] **Step 3: Implementar `src/auth.js`**

```js
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
```

- [ ] **Step 4: Rodar os testes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/auth.js test/auth.test.js
git commit -m "Adiciona PIN com scrypt, sessões e rate limit

O banco guarda apenas o hash do token de sessão, e a comparação de
segredos é feita em tempo constante.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: Camada HTTP

Helpers de requisição e resposta, arquivos estáticos e cabeçalhos de segurança. É o que o Express daria de graça — aqui são ~120 linhas.

**Files:**
- Create: `src/http.js`
- Test: `test/http.test.js`

**Interfaces:**
- Consumes: nada
- Produces:
  - `class HttpError extends Error` com `.status`
  - `readJson(req, { limit }) -> Promise<object>`
  - `sendJson(res, status, body, headers)`, `sendEmpty(res, status, headers)`
  - `securityHeaders() -> object`
  - `serveStatic(req, res, rootDir) -> Promise<boolean>`
  - `sameOrigin(req) -> boolean`
  - `clientIp(req) -> string`

- [ ] **Step 1: Escrever o teste que falha**

`test/http.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { HttpError, readJson, securityHeaders, sameOrigin, clientIp } from '../src/http.js';

const fakeRequest = (body, headers = {}) => {
  const stream = Readable.from([Buffer.from(body)]);
  stream.headers = headers;
  return stream;
};

test('lê JSON do corpo', async () => {
  assert.deepEqual(await readJson(fakeRequest('{"a":1}')), { a: 1 });
});

test('corpo vazio vira objeto vazio', async () => {
  assert.deepEqual(await readJson(fakeRequest('')), {});
});

test('JSON inválido vira erro 400', async () => {
  await assert.rejects(() => readJson(fakeRequest('{nao é json')),
    (error) => error instanceof HttpError && error.status === 400);
});

test('corpo grande demais vira erro 413', async () => {
  await assert.rejects(() => readJson(fakeRequest('x'.repeat(200)), { limit: 100 }),
    (error) => error.status === 413);
});

test('os cabeçalhos de segurança bloqueiam recurso externo e sniffing', () => {
  const headers = securityHeaders();
  assert.match(headers['Content-Security-Policy'], /default-src 'self'/);
  assert.match(headers['Content-Security-Policy'], /img-src 'self' data:/);
  assert.equal(headers['X-Content-Type-Options'], 'nosniff');
});

test('sameOrigin aceita requisição sem Origin e a do próprio host', () => {
  assert.equal(sameOrigin(fakeRequest('', { host: 'site.com' })), true);
  assert.equal(sameOrigin(fakeRequest('', { host: 'site.com', origin: 'https://site.com' })), true);
  assert.equal(sameOrigin(fakeRequest('', { host: 'site.com', origin: 'https://malicioso.com' })), false);
});

test('clientIp prefere o cabeçalho do proxy quando existe', () => {
  const request = fakeRequest('', { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' });
  request.socket = { remoteAddress: '10.0.0.1' };
  assert.equal(clientIp(request), '1.2.3.4');

  const direct = fakeRequest('', {});
  direct.socket = { remoteAddress: '10.0.0.1' };
  assert.equal(clientIp(direct), '10.0.0.1');
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/http.js'`.

- [ ] **Step 3: Implementar `src/http.js`**

```js
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export async function readJson(req, { limit = 128 * 1024 } = {}) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, 'Conteúdo grande demais');
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (!text) return {};
  try {
    const value = JSON.parse(text);
    if (value === null || typeof value !== 'object') throw new Error('não é objeto');
    return value;
  } catch {
    throw new HttpError(400, 'JSON inválido');
  }
}

export function securityHeaders() {
  return {
    // Todo o CSS e JS vive em arquivos próprios, então 'self' basta e nada
    // inline roda. img-src precisa de data: por causa da prévia da foto.
    'Content-Security-Policy': [
      "default-src 'self'",
      "img-src 'self' data:",
      "style-src 'self'",
      "script-src 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'"
    ].join('; '),
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin'
  };
}

export function sendJson(res, status, body, headers = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...securityHeaders(),
    ...headers
  });
  res.end(payload);
}

export function sendEmpty(res, status, headers = {}) {
  res.writeHead(status, { ...securityHeaders(), ...headers });
  res.end();
}

// Uma requisição de outro site não pode ser distinguida por SameSite sozinho em
// navegadores antigos, então escritas também conferem o Origin.
export function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;              // navegação direta e curl não mandam Origin
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

export function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return String(forwarded).split(',')[0].trim();
  return req.socket?.remoteAddress ?? 'desconhecido';
}

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon'
};

export async function serveStatic(req, res, rootDir) {
  const url = new URL(req.url, 'http://localhost');
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') pathname = '/index.html';

  // normalize resolve '..' antes de checarmos, então o prefixo é garantia real.
  const filePath = normalize(join(rootDir, pathname));
  if (!filePath.startsWith(normalize(rootDir))) {
    sendEmpty(res, 403);
    return true;
  }

  let info;
  try {
    info = await stat(filePath);
  } catch {
    return false;
  }
  if (!info.isFile()) return false;

  const etag = `"${info.size}-${info.mtimeMs}"`;
  if (req.headers['if-none-match'] === etag) {
    sendEmpty(res, 304, { ETag: etag });
    return true;
  }

  res.writeHead(200, {
    'Content-Type': CONTENT_TYPES[extname(filePath)] ?? 'application/octet-stream',
    'Content-Length': info.size,
    ETag: etag,
    'Cache-Control': 'no-cache',
    ...securityHeaders()
  });
  createReadStream(filePath).pipe(res);
  return true;
}
```

- [ ] **Step 4: Rodar os testes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/http.js test/http.test.js
git commit -m "Adiciona camada HTTP com estáticos e headers de segurança

CSP sem inline, proteção contra path traversal nos estáticos e limite de
tamanho no corpo das requisições.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 11: Serviço de horário com refresh de 5 minutos

Busca os CSVs, detecta mudança por hash, versiona, e guarda o último bom no banco. É o único módulo que faz rede.

**Files:**
- Create: `src/schedule.js`
- Test: `test/schedule.test.js`

**Interfaces:**
- Consumes: `buildSchedule` (Task 7), `getCache`/`setCache` (Task 8)
- Produces: `createScheduleService({ db, config, fetchImpl }) -> Service`

```js
Service = {
  refresh(): Promise<{ ok, changed, error? }>,   // uma passada, usada nos testes
  start(), stop(),                               // agenda e cancela o setInterval
  current(): { schedule, version, updatedAt, stale, error }
}
```

`version` é `"<bootId>:<contador>"`. O `bootId` é sorteado a cada processo: sem ele, um cliente com `v=3` na memória veria "nada mudou" contra um servidor recém-reiniciado que também está em 3, e ficaria olhando dados velhos para sempre.

- [ ] **Step 1: Escrever o teste que falha**

`test/schedule.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openDb, getCache } from '../src/db.js';
import { createScheduleService } from '../src/schedule.js';

const read = (name) =>
  readFileSync(new URL(`./fixtures/${name}.csv`, import.meta.url), 'utf8');

const config = {
  sheetId: 'x', gids: { planner: '1', grade: '2', subjects: '3' },
  phase: '4', holidayCode: 'Fer/Rec', periodMinutes: 50,
  frequencyLimit: 0.25, refreshMs: 1000
};

// Devolve o CSV certo conforme o gid pedido na URL.
function fakeFetch({ planner = read('planner-hf4'), fail = false } = {}) {
  let calls = 0;
  const impl = async (url) => {
    calls++;
    if (fail) throw new Error('rede fora do ar');
    const body = url.includes('gid=1') ? planner
      : url.includes('gid=2') ? read('grade-4fase')
      : read('disciplinas');
    return { ok: true, status: 200, text: async () => body };
  };
  impl.calls = () => calls;
  return impl;
}

test('a primeira busca monta o horário e marca versão', async () => {
  const db = openDb(':memory:');
  const service = createScheduleService({ db, config, fetchImpl: fakeFetch() });

  const result = await service.refresh();
  assert.equal(result.ok, true);
  assert.equal(result.changed, true);

  const state = service.current();
  assert.equal(state.stale, false);
  assert.equal(state.schedule.dates.length, 120);
  assert.match(state.version, /^[a-z0-9]+:1$/);
});

test('CSV igual não muda a versão', async () => {
  const db = openDb(':memory:');
  const service = createScheduleService({ db, config, fetchImpl: fakeFetch() });

  await service.refresh();
  const before = service.current().version;
  const second = await service.refresh();

  assert.equal(second.changed, false);
  assert.equal(service.current().version, before);
});

test('CSV diferente sobe a versão', async () => {
  const db = openDb(':memory:');
  const original = read('planner-hf4');
  let planner = original;
  const service = createScheduleService({
    db, config, fetchImpl: async (url) => ({
      ok: true, status: 200,
      text: async () => url.includes('gid=1') ? planner
        : url.includes('gid=2') ? read('grade-4fase') : read('disciplinas')
    })
  });

  await service.refresh();
  const before = service.current().version;
  planner = original.replace('ExtPes', 'OUTRA');
  await service.refresh();

  assert.notEqual(service.current().version, before);
});

test('guarda o último horário bom no banco', async () => {
  const db = openDb(':memory:');
  await createScheduleService({ db, config, fetchImpl: fakeFetch() }).refresh();
  const cached = JSON.parse(getCache(db, 'schedule').value);
  assert.equal(cached.schedule.dates.length, 120);
});

test('sobe do cache do banco sem precisar da rede', () => {
  const db = openDb(':memory:');
  const first = createScheduleService({ db, config, fetchImpl: fakeFetch() });
  return first.refresh().then(() => {
    const restarted = createScheduleService({ db, config, fetchImpl: fakeFetch({ fail: true }) });
    const state = restarted.current();
    assert.equal(state.schedule.dates.length, 120);
    assert.equal(state.stale, true, 'ainda não sincronizou nesta execução');
  });
});

test('falha de rede preserva o horário anterior e registra o erro', async () => {
  const db = openDb(':memory:');
  const service = createScheduleService({ db, config, fetchImpl: fakeFetch() });
  await service.refresh();
  const good = service.current().schedule;

  service.setFetch(fakeFetch({ fail: true }));
  const result = await service.refresh();

  assert.equal(result.ok, false);
  assert.match(result.error, /rede fora do ar/);
  assert.deepEqual(service.current().schedule, good, 'o horário bom continua no ar');
  assert.equal(service.current().stale, true);
});

test('resposta em HTML é tratada como falha, não como dado', async () => {
  const db = openDb(':memory:');
  const service = createScheduleService({
    db, config,
    fetchImpl: async () => ({ ok: true, status: 200, text: async () => '<!DOCTYPE html><html>login</html>' })
  });
  const result = await service.refresh();
  assert.equal(result.ok, false);
  assert.match(result.error, /não parece CSV|pública/i);
});

test('HTTP 404 é falha', async () => {
  const db = openDb(':memory:');
  const service = createScheduleService({
    db, config, fetchImpl: async () => ({ ok: false, status: 404, text: async () => '' })
  });
  assert.equal((await service.refresh()).ok, false);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/schedule.js'`.

- [ ] **Step 3: Implementar `src/schedule.js`**

```js
import { createHash, randomBytes } from 'node:crypto';
import { buildSchedule } from './sheets.js';
import { getCache, setCache } from './db.js';
import { csvUrl } from '../config.js';

const CACHE_KEY = 'schedule';

export function createScheduleService({ db, config, fetchImpl = fetch }) {
  // Sorteado a cada processo: impede que um cliente com versão antiga confunda
  // um servidor reiniciado com "nada mudou".
  const bootId = randomBytes(4).toString('hex');

  let counter = 0;
  let schedule = null;
  let signature = null;
  let updatedAt = null;
  let stale = true;
  let error = null;
  let timer = null;
  let fetchCsv = fetchImpl;

  // Sobe já com o último horário bom, para o site não nascer vazio.
  const cached = getCache(db, CACHE_KEY);
  if (cached) {
    try {
      const parsed = JSON.parse(cached.value);
      schedule = parsed.schedule;
      updatedAt = cached.fetched_at;
      counter = 1;
    } catch {
      // Cache corrompido não vale nada; a primeira busca resolve.
    }
  }

  async function download(gid) {
    const response = await fetchCsv(csvUrl(config.sheetId, gid));
    if (!response.ok) {
      throw new Error(`planilha respondeu HTTP ${response.status}`);
    }
    const text = await response.text();
    // Planilha que deixou de ser pública devolve a página de login do Google.
    if (text.trimStart().startsWith('<')) {
      throw new Error('a resposta não parece CSV — a planilha ainda está pública?');
    }
    return text;
  }

  async function refresh() {
    try {
      const [plannerCsv, gradeCsv, subjectsCsv] = await Promise.all([
        download(config.gids.planner),
        download(config.gids.grade),
        download(config.gids.subjects)
      ]);

      const next = createHash('sha256')
        .update(plannerCsv).update(gradeCsv).update(subjectsCsv).digest('hex');

      stale = false;
      error = null;
      updatedAt = new Date().toISOString();

      if (next === signature) return { ok: true, changed: false };

      schedule = buildSchedule({
        plannerCsv, gradeCsv, subjectsCsv,
        phase: config.phase,
        holidayCode: config.holidayCode,
        periodMinutes: config.periodMinutes,
        frequencyLimit: config.frequencyLimit
      });
      signature = next;
      counter++;
      setCache(db, CACHE_KEY, JSON.stringify({ schedule }));
      return { ok: true, changed: true };
    } catch (failure) {
      // Mantém o último horário bom no ar; só marca que está velho.
      stale = true;
      error = failure.message;
      return { ok: false, changed: false, error: failure.message };
    }
  }

  return {
    refresh,
    setFetch(impl) { fetchCsv = impl; },
    start() {
      refresh();
      timer = setInterval(refresh, config.refreshMs);
      timer.unref?.();
    },
    stop() { clearInterval(timer); timer = null; },
    bumpVersion() { counter++; },
    current() {
      return {
        schedule,
        version: `${bootId}:${counter}`,
        updatedAt,
        stale,
        error
      };
    }
  };
}
```

- [ ] **Step 4: Rodar os testes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/schedule.js test/schedule.test.js
git commit -m "Adiciona serviço de horário com refresh de 5 minutos

Compara o hash do CSV para não reprocessar à toa, mantém o último
horário bom quando o Google falha, e trata resposta em HTML como falha
em vez de gravar a página de login como se fosse dado.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 12: Rotas de cadastro e login

Onde auth, db e HTTP se encontram. A regra que não pode ser quebrada: **nenhuma rota aceita `userId` do cliente**.

**Files:**
- Create: `src/api.js`
- Test: `test/api-auth.test.js`

**Interfaces:**
- Consumes: tudo das Tasks 8–11
- Produces:
  - `createApi({ db, schedule, config }) -> async (req, res) => boolean` (true = tratou)
  - `currentUser(db, req) -> PublicUser | null` (exportada para os testes)

Rotas desta task: `POST /api/signup`, `POST /api/login`, `POST /api/logout`, `GET /api/me`, `PATCH /api/me`, `GET /api/photo/:id`.

Cores: o cadastro sorteia uma cor de uma paleta fixa em `config.js`, preferindo as ainda não usadas — assim ninguém precisa escolher e as pessoas ficam distinguíveis.

- [ ] **Step 1: Adicionar a paleta a `config.js`**

```js
// Cores de identificação, uma por pessoa. Legíveis nos dois temas.
export const PALETTE = [
  '#e5484d', '#0090ff', '#30a46c', '#f76b15',
  '#8e4ec6', '#e5484d', '#12a594', '#c2900a'
];
```

- [ ] **Step 2: Escrever o teste que falha**

`test/api-auth.test.js`:

```js
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

  const huge = 'data:image/webp;base64,' + Buffer.alloc(200 * 1024).toString('base64');
  const rejected = await app.patch('/api/me', { photo: huge }, { cookie: signup.cookie });
  assert.equal(rejected.status, 400);
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
```

- [ ] **Step 3: Escrever o helper de testes**

`test/helpers.js`:

```js
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
    close: () => new Promise((resolve) => server.close(resolve))
  };
}
```

- [ ] **Step 4: Rodar e ver falhar**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/api.js'`.

- [ ] **Step 5: Implementar as rotas de autenticação em `src/api.js`**

```js
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
    const body = await readJson(req);

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
    const body = await readJson(req);
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
    const body = await readJson(req);
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
```

- [ ] **Step 6: Rodar os testes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/api.js config.js test/api-auth.test.js test/helpers.js
git commit -m "Adiciona cadastro, login e perfil

Login gasta o mesmo tempo com nome inexistente para não revelar quem tem
conta, e a foto é validada por tipo e tamanho já decodificado. Escritas
conferem o Origin.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 13: Estado da semana e marcação de faltas

**Mudança em relação ao spec, e por quê:** o spec previa `PUT /api/absences` recebendo `{date, subject, slots, value}`. Aceitar `slots` do cliente significa aceitar que ele invente períodos que não existem naquele dia. Em vez disso a rota recebe só `{ blockId, value, reason }` e o **servidor** deriva `slots` e `subject` do horário que ele mesmo montou. O cliente não consegue mais escrever um período que a planilha não tem, e some uma classe inteira de validação.

**Files:**
- Modify: `src/api.js`
- Test: `test/api-state.test.js`

**Interfaces:**
- Consumes: Task 12
- Produces: rotas `GET /api/state`, `PUT /api/absences`, `PATCH /api/absences`

```js
StateResponse = {
  version, updatedAt, stale, error,
  today: { date, blocks: BlockWithAbsences[] },   // sempre, independente da semana pedida
  week: { monday, first, last },                  // first/last = limites de navegação
  days: [{ date, weekday, label, holiday, blocks: BlockWithAbsences[] }],
  users: PublicUser[],
  frequency: [{ subject, name, hours, limit, missed, remaining }] | null
}
BlockWithAbsences = Block & { absences: [{ userId, reason }] }
```

Quando `?v=` bate com a versão atual, a resposta é `{ unchanged: true, version }`.

- [ ] **Step 1: Escrever o teste que falha**

`test/api-state.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from './helpers.js';

const signup = async (app, name, pin = '1234') =>
  app.post('/api/signup', { groupCode: 'segredo', name, pin });

const blockOn = (state, date, subject) =>
  state.days.find((d) => d.date === date).blocks.find((b) => b.subject === subject);

test('o estado traz a semana pedida com seis dias', async () => {
  const app = await startTestServer();
  const res = await app.get('/api/state?week=2026-08-03');
  assert.equal(res.status, 200);
  assert.equal(res.body.days.length, 6);
  assert.deepEqual(res.body.days.map((d) => d.date), [
    '2026-08-03', '2026-08-04', '2026-08-05',
    '2026-08-06', '2026-08-07', '2026-08-08'
  ]);
  await app.close();
});

test('qualquer data da semana devolve a mesma semana', async () => {
  const app = await startTestServer();
  const wednesday = await app.get('/api/state?week=2026-08-05');
  assert.equal(wednesday.body.week.monday, '2026-08-03');
  await app.close();
});

test('o estado é público, mas a frequência é só de quem está logado', async () => {
  const app = await startTestServer();
  const anonymous = await app.get('/api/state?week=2026-08-03');
  assert.equal(anonymous.body.frequency, null);

  const ana = await signup(app, 'Ana');
  const logged = await app.get('/api/state?week=2026-08-03', { cookie: ana.cookie });
  assert.ok(Array.isArray(logged.body.frequency));
  await app.close();
});

test('marcar falta aparece no bloco, com o motivo', async () => {
  const app = await startTestServer();
  const ana = await signup(app, 'Ana');
  const state = await app.get('/api/state?week=2026-08-03');
  const block = blockOn(state.body, '2026-08-03', 'ExtPes');

  const marked = await app.put('/api/absences',
    { blockId: block.id, value: true, reason: 'consulta' }, { cookie: ana.cookie });
  assert.equal(marked.status, 200);

  const after = await app.get('/api/state?week=2026-08-03');
  const updated = blockOn(after.body, '2026-08-03', 'ExtPes');
  assert.equal(updated.absences.length, 1);
  assert.equal(updated.absences[0].reason, 'consulta');
  await app.close();
});

test('desmarcar remove todos os períodos da aula', async () => {
  const app = await startTestServer();
  const ana = await signup(app, 'Ana');
  const block = blockOn((await app.get('/api/state?week=2026-08-03')).body, '2026-08-03', 'ExtPes');
  assert.equal(block.slots.length, 3, 'esta aula tem três períodos');

  await app.put('/api/absences', { blockId: block.id, value: true }, { cookie: ana.cookie });
  await app.put('/api/absences', { blockId: block.id, value: false }, { cookie: ana.cookie });

  const after = await app.get('/api/state?week=2026-08-03');
  assert.deepEqual(blockOn(after.body, '2026-08-03', 'ExtPes').absences, []);
  await app.close();
});

test('marcar exige estar logado', async () => {
  const app = await startTestServer();
  const block = blockOn((await app.get('/api/state?week=2026-08-03')).body, '2026-08-03', 'ExtPes');
  assert.equal((await app.put('/api/absences', { blockId: block.id, value: true })).status, 401);
  await app.close();
});

test('não é possível marcar falta em nome de outra pessoa', async () => {
  const app = await startTestServer();
  const ana = await signup(app, 'Ana');
  const joao = await signup(app, 'João', '5678');
  const block = blockOn((await app.get('/api/state?week=2026-08-03')).body, '2026-08-03', 'ExtPes');

  // Mesmo mandando o id do João explicitamente, a falta é da Ana.
  await app.put('/api/absences',
    { blockId: block.id, value: true, userId: joao.body.user.id, user_id: joao.body.user.id },
    { cookie: ana.cookie });

  const after = await app.get('/api/state?week=2026-08-03');
  const marks = blockOn(after.body, '2026-08-03', 'ExtPes').absences;
  assert.equal(marks.length, 1);
  assert.equal(marks[0].userId, ana.body.user.id);
  await app.close();
});

test('bloco inexistente é recusado', async () => {
  const app = await startTestServer();
  const ana = await signup(app, 'Ana');
  for (const blockId of ['2026-08-03|23:59', '2020-01-01|07:30', 'lixo', '']) {
    const res = await app.put('/api/absences', { blockId, value: true }, { cookie: ana.cookie });
    assert.equal(res.status, 400, `${blockId} deveria ser recusado`);
  }
  await app.close();
});

test('não dá para faltar em feriado, porque não há aula', async () => {
  const app = await startTestServer();
  const ana = await signup(app, 'Ana');
  const holiday = (await app.get('/api/state?week=2026-09-07')).body.days
    .find((d) => d.date === '2026-09-07');
  assert.equal(holiday.holiday, true);
  assert.deepEqual(holiday.blocks, []);

  const res = await app.put('/api/absences',
    { blockId: '2026-09-07|07:30', value: true }, { cookie: ana.cookie });
  assert.equal(res.status, 400);
  await app.close();
});

test('motivo longo demais é recusado', async () => {
  const app = await startTestServer();
  const ana = await signup(app, 'Ana');
  const block = blockOn((await app.get('/api/state?week=2026-08-03')).body, '2026-08-03', 'ExtPes');
  const res = await app.put('/api/absences',
    { blockId: block.id, value: true, reason: 'x'.repeat(200) }, { cookie: ana.cookie });
  assert.equal(res.status, 400);
  await app.close();
});

test('o motivo pode ser alterado depois de marcar', async () => {
  const app = await startTestServer();
  const ana = await signup(app, 'Ana');
  const block = blockOn((await app.get('/api/state?week=2026-08-03')).body, '2026-08-03', 'ExtPes');

  await app.put('/api/absences', { blockId: block.id, value: true }, { cookie: ana.cookie });
  await app.patch('/api/absences', { blockId: block.id, reason: 'prova' }, { cookie: ana.cookie });

  const after = await app.get('/api/state?week=2026-08-03');
  assert.equal(blockOn(after.body, '2026-08-03', 'ExtPes').absences[0].reason, 'prova');
  await app.close();
});

test('a frequência conta os períodos e calcula quanto ainda dá para faltar', async () => {
  const app = await startTestServer();
  const ana = await signup(app, 'Ana');
  const block = blockOn((await app.get('/api/state?week=2026-08-03')).body, '2026-08-03', 'ExtPes');
  await app.put('/api/absences', { blockId: block.id, value: true }, { cookie: ana.cookie });

  const state = await app.get('/api/state?week=2026-08-03', { cookie: ana.cookie });
  const extPes = state.body.frequency.find((f) => f.subject === 'ExtPes');
  assert.equal(extPes.missed, 3);          // a aula tem três períodos
  assert.equal(extPes.limit, 18);          // 25% de 72
  assert.equal(extPes.remaining, 15);
  await app.close();
});

test('a versão muda quando alguém marca falta', async () => {
  const app = await startTestServer();
  const ana = await signup(app, 'Ana');
  const before = (await app.get('/api/state?week=2026-08-03')).body.version;

  const block = blockOn((await app.get('/api/state?week=2026-08-03')).body, '2026-08-03', 'ExtPes');
  await app.put('/api/absences', { blockId: block.id, value: true }, { cookie: ana.cookie });

  assert.notEqual((await app.get('/api/state?week=2026-08-03')).body.version, before);
  await app.close();
});

test('versão igual devolve resposta curta', async () => {
  const app = await startTestServer();
  const first = await app.get('/api/state?week=2026-08-03');
  const again = await app.get(`/api/state?week=2026-08-03&v=${encodeURIComponent(first.body.version)}`);
  assert.equal(again.body.unchanged, true);
  assert.equal(again.body.days, undefined);
  await app.close();
});

test('o estado sempre traz o dia de hoje, mesmo olhando outra semana', async () => {
  const app = await startTestServer();
  const state = await app.get('/api/state?week=2026-08-03');
  assert.ok(state.body.today.date);
  assert.ok(Array.isArray(state.body.today.blocks));
  await app.close();
});

test('semana fora do semestre devolve dias vazios, não erro', async () => {
  const app = await startTestServer();
  const res = await app.get('/api/state?week=2030-01-07');
  assert.equal(res.status, 200);
  assert.equal(res.body.days.length, 6);
  assert.ok(res.body.days.every((d) => d.blocks.length === 0));
  await app.close();
});

test('os limites de navegação cobrem o semestre', async () => {
  const app = await startTestServer();
  const week = (await app.get('/api/state?week=2026-08-03')).body.week;
  assert.equal(week.first, '2026-08-03');
  assert.equal(week.last, '2026-12-14');
  await app.close();
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test`
Expected: FAIL — `/api/state` responde 404.

- [ ] **Step 3: Implementar em `src/api.js`**

Acrescente os imports de data e as funções abaixo dentro de `createApi`:

```js
import { mondayOf, weekDates, todayIso } from './dates.js';
```

```js
  // Lê o horário atual do serviço. Nomeado à parte para não sombrear `schedule`,
  // que é o serviço em si.
  const currentGrid = () => schedule.current().schedule;

  // O bloco é procurado no horário que o servidor montou. É isso que impede o
  // cliente de inventar períodos: ele só manda qual aula, nunca quais períodos.
  function findBlock(blockId) {
    const [date, start] = String(blockId ?? '').split('|');
    const block = currentGrid()?.days?.[date]?.blocks.find((b) => b.start === start);
    if (!block) throw new HttpError(400, 'Essa aula não existe no horário');
    return { date, block };
  }

  function readReason(value) {
    if (value === undefined || value === null || value === '') return null;
    const text = String(value).trim();
    if (text.length > config.maxReasonLength) throw new HttpError(400, 'Motivo longo demais');
    return text || null;
  }

  function emptyDay(date) {
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    return { date, weekday: weekday === 0 ? 1 : weekday + 1, label: '', holiday: false, blocks: [] };
  }

  function decorate(day, marks) {
    return {
      ...day,
      blocks: day.blocks.map((block) => ({
        ...block,
        absences: marks.get(block.id) ?? []
      }))
    };
  }

  // Uma pessoa aparece no bloco se faltou em pelo menos um de seus períodos.
  // Assim a marcação sobrevive à planilha remontar os blocos depois.
  function marksFor(from, to) {
    const rows = absencesBetween(db, from, to);
    const grid = currentGrid();
    const marks = new Map();

    for (const row of rows) {
      const blocks = grid?.days?.[row.date]?.blocks ?? [];
      const block = blocks.find((b) => b.slots.includes(row.slot));
      if (!block) continue;
      const list = marks.get(block.id) ?? [];
      if (!list.some((entry) => entry.userId === row.user_id)) {
        list.push({ userId: row.user_id, reason: row.reason });
      }
      marks.set(block.id, list);
    }
    return marks;
  }

  function frequencyFor(userId) {
    const counts = new Map(absenceCounts(db, userId).map((r) => [r.subject, r.count]));
    return Object.values(currentGrid()?.subjects ?? {})
      .map((subject) => {
        const missed = counts.get(subject.code) ?? 0;
        return {
          subject: subject.code, name: subject.name,
          hours: subject.hours, limit: subject.limit,
          missed, remaining: subject.limit - missed
        };
      })
      .sort((a, b) => a.remaining - b.remaining);
  }

  function handleState(req, res, url) {
    const state = schedule.current();
    if (url.searchParams.get('v') === state.version) {
      sendJson(res, 200, { unchanged: true, version: state.version });
      return;
    }

    const user = sessionUser(req);
    const today = todayIso(config.tz);
    const monday = mondayOf(url.searchParams.get('week') || today);
    const dates = weekDates(monday);

    // Hoje pode estar fora da semana pedida, e o painel "Hoje" precisa dele.
    const span = [...dates, today].sort();
    const marks = marksFor(span[0], span.at(-1));
    const days = dates.map((date) => decorate(state.schedule?.days?.[date] ?? emptyDay(date), marks));
    const todayDay = decorate(state.schedule?.days?.[today] ?? emptyDay(today), marks);

    const all = state.schedule?.dates ?? [];
    sendJson(res, 200, {
      version: state.version,
      updatedAt: state.updatedAt,
      stale: state.stale,
      error: state.error,
      today: todayDay,
      week: {
        monday,
        first: all.length ? mondayOf(all[0]) : monday,
        last: all.length ? mondayOf(all.at(-1)) : monday
      },
      days,
      users: listUsers(db),
      frequency: user ? frequencyFor(user.id) : null
    });
  }

  async function handleSetAbsence(req, res) {
    const user = requireUser(req);
    const body = await readJson(req);
    const { date, block } = findBlock(body.blockId);
    const reason = readReason(body.reason);

    setAbsence(db, {
      userId: user.id,          // sempre da sessão, nunca do corpo
      date, slots: block.slots, subject: block.subject,
      value: Boolean(body.value), reason
    });
    schedule.bumpVersion();
    sendJson(res, 200, { ok: true, blockId: block.id, value: Boolean(body.value) });
  }

  async function handleSetReason(req, res) {
    const user = requireUser(req);
    const body = await readJson(req);
    const { date, block } = findBlock(body.blockId);

    setReason(db, { userId: user.id, date, slots: block.slots, reason: readReason(body.reason) });
    schedule.bumpVersion();
    sendJson(res, 200, { ok: true });
  }
```

E acrescente ao roteador, antes do `else sendJson(res, 404, ...)`:

```js
      else if (route === 'GET /api/state') handleState(req, res, url);
      else if (route === 'PUT /api/absences') await handleSetAbsence(req, res);
      else if (route === 'PATCH /api/absences') await handleSetReason(req, res);
```

- [ ] **Step 4: Rodar os testes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/api.js test/api-state.test.js
git commit -m "Adiciona estado da semana e marcação de faltas

A rota recebe só o id da aula e o servidor deriva os períodos do próprio
horário — o cliente não consegue escrever um período que a planilha não
tem. O id do usuário vem sempre da sessão.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 14: Servidor

Junta tudo e serve os estáticos. Ao final desta task o backend está completo e testável pelo navegador.

**Files:**
- Create: `server.js`, `public/index.html` (esqueleto mínimo)
- Test: `test/server.test.js`

**Interfaces:**
- Consumes: Tasks 8–13
- Produces: `createServerApp({ config }) -> { server, db, schedule }`, e `server.js` executável

- [ ] **Step 1: Escrever o teste que falha**

`test/server.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServerApp } from '../server.js';
import { testConfig } from './helpers.js';

async function start() {
  const app = createServerApp({ config: { ...testConfig, dbPath: ':memory:' } });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  return {
    base,
    fetch: (path, options) => fetch(base + path, options),
    close: () => new Promise((resolve) => { app.schedule.stop(); app.server.close(resolve); })
  };
}

test('serve a página inicial', async () => {
  const app = await start();
  const res = await app.fetch('/');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  assert.match(await res.text(), /<!DOCTYPE html>/i);
  await app.close();
});

test('aplica os cabeçalhos de segurança nos estáticos', async () => {
  const app = await start();
  const res = await app.fetch('/');
  assert.match(res.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  await app.close();
});

test('caminho inexistente devolve 404', async () => {
  const app = await start();
  assert.equal((await app.fetch('/nao-existe.js')).status, 404);
  await app.close();
});

test('não serve arquivo fora de public/', async () => {
  const app = await start();
  const res = await app.fetch('/../server.js');
  assert.ok([403, 404].includes(res.status), `esperava bloqueio, veio ${res.status}`);
  await app.close();
});

test('a API responde', async () => {
  const app = await start();
  const res = await app.fetch('/api/me');
  assert.equal(res.status, 401);
  await app.close();
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test`
Expected: FAIL — `Cannot find module '../server.js'`.

- [ ] **Step 3: Implementar `server.js`**

```js
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
  app.server.listen(app.config.port, () => {
    console.log(`Calendário de faltas em http://localhost:${app.config.port}`);
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
```

- [ ] **Step 4: Criar `public/index.html` mínimo**

```html
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Calendário de Faltas</title>
  <link rel="stylesheet" href="/css/style.css">
</head>
<body>
  <div id="app"></div>
  <script type="module" src="/js/app.js"></script>
</body>
</html>
```

Crie também `public/css/style.css` e `public/js/app.js` vazios por enquanto, para os estáticos não darem 404.

- [ ] **Step 5: Rodar os testes**

Run: `npm test`
Expected: PASS em toda a suíte.

- [ ] **Step 6: Verificar rodando de verdade**

```bash
GROUP_CODE=teste DB_PATH=data/dev.db npm start
```

Em outro terminal:

```bash
curl -s localhost:3000/api/state | head -c 400
```

Esperado: JSON com `version`, `days` e as aulas da semana atual, vindos da planilha ao vivo. Encerre com Ctrl+C.

- [ ] **Step 7: Commit**

```bash
git add server.js public/ test/server.test.js
git commit -m "Adiciona o servidor HTTP

Monta banco, serviço de horário e API, serve os estáticos e encerra
limpo em SIGINT/SIGTERM.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 15: Frontend — base, cliente da API e telas de entrada

Primeira parte visível. Inclui o redimensionamento da foto no navegador: enviar a imagem original do celular seria mandar 4 MB para guardar 4 KB.

**Files:**
- Create: `public/js/api.js`, `public/js/photo.js`, `public/js/auth.js`
- Modify: `public/js/app.js`, `public/css/style.css`

**Interfaces:**
- Consumes: rotas das Tasks 12–13
- Produces:
  - `api.get/post/put/patch(path, body) -> Promise<any>` (lança `ApiError` com `.status` e `.message`)
  - `resizeToSquare(file, size) -> Promise<string>` (data URL)
  - `renderAuth(root, { onDone })`
  - `el(tag, props, ...children) -> HTMLElement`

- [ ] **Step 1: Criar `public/js/api.js`**

```js
export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

async function request(method, path, body) {
  const response = await fetch(path, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) throw new ApiError(response.status, data?.error ?? 'Falha na requisição');
  return data;
}

export const api = {
  get: (path) => request('GET', path),
  post: (path, body) => request('POST', path, body ?? {}),
  put: (path, body) => request('PUT', path, body ?? {}),
  patch: (path, body) => request('PATCH', path, body ?? {})
};

// Criador de elementos: evita innerHTML, o que evita XSS por construção.
export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') node.className = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (value !== null && value !== undefined && value !== false) {
      node.setAttribute(key, value === true ? '' : value);
    }
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}
```

- [ ] **Step 2: Criar `public/js/photo.js`**

```js
const MAX_SIDE = 96;

// Corta no centro, reduz para 96x96 e devolve WebP. O arquivo original do
// celular tem alguns MB; o resultado tem ~4 KB, que é o que vai para o banco.
export function resizeToSquare(file, size = MAX_SIDE) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('Escolha um arquivo de imagem'));
      return;
    }

    const url = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      URL.revokeObjectURL(url);
      const side = Math.min(image.width, image.height);
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;

      const context = canvas.getContext('2d');
      context.drawImage(
        image,
        (image.width - side) / 2, (image.height - side) / 2, side, side,
        0, 0, size, size
      );

      // WebP economiza bastante; se o navegador não tiver, o toDataURL cai em PNG.
      resolve(canvas.toDataURL('image/webp', 0.8));
    };

    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Não consegui ler essa imagem'));
    };
    image.src = url;
  });
}
```

- [ ] **Step 3: Criar `public/js/auth.js`**

```js
import { api, el } from './api.js';
import { resizeToSquare } from './photo.js';

export function renderAuth(root, { onDone }) {
  let mode = 'login';
  let photo = null;
  let busy = false;

  const draw = () => {
    root.replaceChildren(build());
  };

  function build() {
    const error = el('p', { class: 'erro', role: 'alert' });
    const preview = el('div', { class: 'foto-previa' },
      photo ? el('img', { src: photo, alt: '' }) : el('span', {}, '📷'));

    const fields = {
      name: el('input', { type: 'text', maxlength: '24', autocomplete: 'username', required: true }),
      pin: el('input', { type: 'password', inputmode: 'numeric', maxlength: '6',
                         autocomplete: 'current-password', required: true }),
      groupCode: el('input', { type: 'password', autocomplete: 'off' })
    };

    const fileInput = el('input', {
      type: 'file', accept: 'image/*', class: 'oculto',
      onchange: async (event) => {
        const [file] = event.target.files;
        if (!file) return;
        try { photo = await resizeToSquare(file); draw(); }
        catch (failure) { error.textContent = failure.message; }
      }
    });

    async function submit(event) {
      event.preventDefault();
      if (busy) return;
      busy = true;
      error.textContent = '';

      try {
        const payload = mode === 'login'
          ? { name: fields.name.value, pin: fields.pin.value }
          : { name: fields.name.value, pin: fields.pin.value,
              groupCode: fields.groupCode.value, photo };
        const result = await api.post(mode === 'login' ? '/api/login' : '/api/signup', payload);
        onDone(result.user);
      } catch (failure) {
        error.textContent = failure.message;
        busy = false;
      }
    }

    return el('form', { class: 'cartao-entrada', onsubmit: submit },
      el('h1', {}, 'Calendário de Faltas'),
      el('p', { class: 'sub' }, mode === 'login'
        ? 'Entre para marcar suas faltas.'
        : 'Crie seu perfil com o código do grupo.'),

      mode === 'cadastro' && el('label', { class: 'campo-foto' },
        preview, el('span', {}, photo ? 'Trocar foto' : 'Escolher foto'), fileInput),

      el('label', {}, 'Nome', fields.name),
      el('label', {}, 'PIN (4 a 6 dígitos)', fields.pin),
      mode === 'cadastro' && el('label', {}, 'Código do grupo', fields.groupCode),

      error,
      el('button', { type: 'submit', class: 'primario' },
        mode === 'login' ? 'Entrar' : 'Criar perfil'),
      el('button', {
        type: 'button', class: 'link',
        onclick: () => { mode = mode === 'login' ? 'cadastro' : 'login'; draw(); }
      }, mode === 'login' ? 'Não tenho perfil ainda' : 'Já tenho perfil')
    );
  }

  draw();
}
```

- [ ] **Step 4: Ligar em `public/js/app.js`**

```js
import { api } from './api.js';
import { renderAuth } from './auth.js';

const root = document.querySelector('#app');

async function start() {
  let user = null;
  try { user = (await api.get('/api/me')).user; } catch { user = null; }

  if (!user) {
    renderAuth(root, { onDone: () => start() });
    return;
  }
  root.replaceChildren(document.createTextNode(`Olá, ${user.name}`));
}

start();
```

- [ ] **Step 5: Escrever a base do CSS em `public/css/style.css`**

```css
:root {
  color-scheme: light dark;
  --fundo: #f6f7f9;
  --superficie: #ffffff;
  --borda: #e3e6ea;
  --texto: #16181d;
  --texto-fraco: #6b7280;
  --acento: #0090ff;
  --raio: 14px;
  --sombra: 0 1px 2px rgb(0 0 0 / 6%), 0 8px 24px rgb(0 0 0 / 6%);
}

@media (prefers-color-scheme: dark) {
  :root {
    --fundo: #0e1013;
    --superficie: #171a1f;
    --borda: #262b33;
    --texto: #e8eaed;
    --texto-fraco: #9aa2ad;
    --sombra: 0 1px 2px rgb(0 0 0 / 40%), 0 8px 24px rgb(0 0 0 / 30%);
  }
}

* { box-sizing: border-box; }

body {
  margin: 0;
  background: var(--fundo);
  color: var(--texto);
  font: 15px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  -webkit-text-size-adjust: 100%;
}

button { font: inherit; cursor: pointer; }
.oculto { display: none; }

.cartao-entrada {
  max-width: 340px;
  margin: 12vh auto;
  padding: 28px;
  display: grid;
  gap: 14px;
  background: var(--superficie);
  border: 1px solid var(--borda);
  border-radius: var(--raio);
  box-shadow: var(--sombra);
}

.cartao-entrada h1 { margin: 0; font-size: 20px; }
.cartao-entrada .sub { margin: -8px 0 4px; color: var(--texto-fraco); font-size: 14px; }
.cartao-entrada label { display: grid; gap: 6px; font-size: 13px; color: var(--texto-fraco); }

.cartao-entrada input {
  padding: 10px 12px;
  font: inherit;
  color: var(--texto);
  background: var(--fundo);
  border: 1px solid var(--borda);
  border-radius: 10px;
}

.cartao-entrada input:focus-visible {
  outline: 2px solid var(--acento);
  outline-offset: 1px;
}

.campo-foto {
  display: flex !important;
  align-items: center;
  gap: 12px;
  cursor: pointer;
}

.foto-previa {
  width: 48px; height: 48px;
  display: grid; place-items: center;
  border-radius: 50%;
  background: var(--fundo);
  border: 1px solid var(--borda);
  overflow: hidden;
}

.foto-previa img { width: 100%; height: 100%; object-fit: cover; }

.primario {
  padding: 11px;
  color: #fff;
  background: var(--acento);
  border: 0;
  border-radius: 10px;
  font-weight: 600;
}

.link {
  background: none; border: 0; padding: 4px;
  color: var(--texto-fraco); font-size: 13px; text-decoration: underline;
}

.erro { margin: 0; min-height: 18px; color: #e5484d; font-size: 13px; }
```

- [ ] **Step 6: Verificar no navegador**

```bash
GROUP_CODE=teste DB_PATH=data/dev.db npm start
```

Abra `http://localhost:3000` e confirme:
- A tela de entrada aparece centralizada e legível.
- "Não tenho perfil ainda" troca para o cadastro e mostra o campo de foto.
- Escolher uma foto grande do computador mostra a prévia redondinha na hora.
- Código do grupo errado mostra a mensagem de erro sem recarregar a página.
- Com `teste` o cadastro conclui e a página passa a mostrar "Olá, <nome>".
- Recarregar mantém logado.

- [ ] **Step 7: Commit**

```bash
git add public/
git commit -m "Adiciona telas de entrada e cadastro

A foto é cortada e reduzida para 96x96 no navegador antes de subir, e a
interface é montada com createElement em vez de innerHTML.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 16: Frontend — a grade da semana

O elemento principal da página. Colunas por dia no desktop, lista por dia no celular — não a mesma tabela espremida.

**Files:**
- Create: `public/js/grid.js`
- Modify: `public/js/app.js`, `public/css/style.css`

**Interfaces:**
- Consumes: `GET /api/state`
- Produces: `renderGrid(state, { me, onToggle }) -> HTMLElement`, `renderHeader(state, { me, onWeek, onLogout }) -> HTMLElement`

- [ ] **Step 1: Criar `public/js/grid.js`**

```js
import { el } from './api.js';

const DIAS = { 2: 'Segunda', 3: 'Terça', 4: 'Quarta', 5: 'Quinta', 6: 'Sexta', 7: 'Sábado' };

const formatDate = (iso) => {
  const [, month, day] = iso.split('-');
  return `${day}/${month}`;
};

export function avatar(user, { size = 22 } = {}) {
  const initials = user.name.trim().slice(0, 2).toUpperCase();
  const node = user.hasPhoto
    ? el('img', {
        class: 'avatar', src: `/api/photo/${user.id}?v=${user.photoVersion}`,
        alt: user.name, title: user.name, width: size, height: size
      })
    : el('span', { class: 'avatar iniciais', title: user.name }, initials);
  node.style.setProperty('--cor', user.color);
  node.style.width = node.style.height = `${size}px`;
  return node;
}

export function renderHeader(state, { me, onWeek, onLogout }) {
  const monday = state.week.monday;
  const atStart = monday <= state.week.first;
  const atEnd = monday >= state.week.last;

  return el('header', { class: 'topo' },
    el('div', { class: 'titulo' },
      el('strong', {}, 'Calendário de Faltas'),
      el('span', { class: 'periodo' },
        `${formatDate(state.days[0].date)} – ${formatDate(state.days.at(-1).date)}`)),

    el('nav', { class: 'navegacao' },
      el('button', { class: 'seta', disabled: atStart, 'aria-label': 'Semana anterior',
                     onclick: () => onWeek(-1) }, '‹'),
      el('button', { class: 'hoje', onclick: () => onWeek(0) }, 'Hoje'),
      el('button', { class: 'seta', disabled: atEnd, 'aria-label': 'Próxima semana',
                     onclick: () => onWeek(1) }, '›')),

    el('div', { class: 'perfil' },
      avatar(me, { size: 28 }),
      el('button', { class: 'link', onclick: onLogout }, 'Sair')),

    state.stale && el('p', { class: 'aviso' },
      state.updatedAt
        ? `Horário pode estar desatualizado — última sincronização ${timeAgo(state.updatedAt)}.`
        : 'Ainda não consegui ler a planilha.')
  );
}

function timeAgo(iso) {
  const minutes = Math.round((Date.now() - new Date(iso)) / 60000);
  if (minutes < 1) return 'agora';
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `há ${hours} h`;
  return `há ${Math.round(hours / 24)} dias`;
}

export function renderGrid(state, { me, users, onToggle, onReason }) {
  const byId = new Map(users.map((u) => [u.id, u]));
  const today = state.today.date;

  return el('section', { class: 'grade' },
    state.days.map((day) => el('div', {
      class: `coluna${day.date === today ? ' hoje' : ''}${day.holiday ? ' feriado' : ''}`
    },
      el('div', { class: 'cabecalho-dia' },
        el('span', { class: 'nome-dia' }, DIAS[day.weekday] ?? ''),
        el('span', { class: 'data-dia' }, formatDate(day.date))),

      day.holiday
        ? el('div', { class: 'vazio' }, 'Feriado')
        : day.blocks.length === 0
          ? el('div', { class: 'vazio' }, 'Sem aula')
          : day.blocks.map((block) => card(block, { me, byId, onToggle, onReason }))
    ))
  );
}

function card(block, { me, byId, onToggle, onReason }) {
  const marks = block.absences ?? [];
  const mine = marks.find((mark) => mark.userId === me.id);
  const heat = Math.min(marks.length, 4);

  return el('article', {
    class: `aula${mine ? ' marcada' : ''}`,
    dataset: { heat: String(heat) },
    tabindex: '0',
    role: 'button',
    'aria-pressed': mine ? 'true' : 'false',
    'aria-label': `${block.name}, ${block.start} às ${block.end}. ${
      mine ? 'Você marcou falta.' : 'Marcar falta.'}`,
    onclick: () => onToggle(block, !mine),
    onkeydown: (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onToggle(block, !mine);
      }
    }
  },
    el('div', { class: 'sigla' }, block.subject),
    el('div', { class: 'nome-materia' }, block.name),
    el('div', { class: 'horario' }, `${block.start} – ${block.end}`,
      block.room && el('span', { class: 'sala' }, block.room)),

    marks.length > 0 && el('div', { class: 'faltantes' },
      marks.map((mark) => {
        const user = byId.get(mark.userId);
        if (!user) return null;
        const face = avatar(user);
        if (mark.reason) face.title = `${user.name} — ${mark.reason}`;
        return face;
      })),

    mine && el('button', {
      class: 'motivo',
      onclick: (event) => { event.stopPropagation(); onReason(block, mine.reason ?? ''); }
    }, mine.reason ? `“${mine.reason}”` : '+ motivo')
  );
}
```

- [ ] **Step 2: Reescrever `public/js/app.js` com estado e polling**

```js
import { api } from './api.js';
import { renderAuth } from './auth.js';
import { renderGrid, renderHeader } from './grid.js';

const root = document.querySelector('#app');
const POLL_MS = 60_000;

const state = { me: null, data: null, monday: null, timer: null };

async function load({ force = false } = {}) {
  const params = new URLSearchParams();
  if (state.monday) params.set('week', state.monday);
  if (!force && state.data) params.set('v', state.data.version);

  const next = await api.get(`/api/state?${params}`);
  if (next.unchanged) return;

  state.data = next;
  state.monday = next.week.monday;
  draw();
}

function draw() {
  const { data, me } = state;
  root.replaceChildren(
    renderHeader(data, { me, onWeek: goWeek, onLogout: logout }),
    renderGrid(data, { me, users: data.users, onToggle: toggle, onReason: askReason })
  );
}

function shiftMonday(monday, weeks) {
  const date = new Date(`${monday}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + weeks * 7);
  return date.toISOString().slice(0, 10);
}

async function goWeek(direction) {
  state.monday = direction === 0 ? null : shiftMonday(state.monday, direction);
  await load({ force: true });
}

async function toggle(block, value) {
  await api.put('/api/absences', { blockId: block.id, value });
  await load({ force: true });
}

async function askReason(block, current) {
  const reason = window.prompt('Motivo (opcional):', current);
  if (reason === null) return;
  await api.patch('/api/absences', { blockId: block.id, reason });
  await load({ force: true });
}

async function logout() {
  await api.post('/api/logout');
  location.reload();
}

async function start() {
  try { state.me = (await api.get('/api/me')).user; }
  catch { renderAuth(root, { onDone: () => start() }); return; }

  await load({ force: true });

  clearInterval(state.timer);
  state.timer = setInterval(() => load().catch(() => {}), POLL_MS);
  // Voltar para a aba é o momento em que mais importa estar atualizado.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) load().catch(() => {});
  });
}

start();
```

`askReason` usa `window.prompt` de propósito nesta task — o diálogo bonito entra na Task 17, e assim a grade já fica testável de ponta a ponta antes.

- [ ] **Step 3: Acrescentar o CSS da grade a `public/css/style.css`**

```css
.topo {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  padding: 14px 18px;
  background: var(--superficie);
  border-bottom: 1px solid var(--borda);
  position: sticky;
  top: 0;
  z-index: 10;
}

.titulo { display: grid; }
.titulo .periodo { color: var(--texto-fraco); font-size: 13px; }
.navegacao { display: flex; gap: 6px; margin-inline: auto; }

.seta, .hoje {
  padding: 6px 12px;
  color: var(--texto);
  background: var(--fundo);
  border: 1px solid var(--borda);
  border-radius: 8px;
}

.seta:disabled { opacity: .35; cursor: default; }
.perfil { display: flex; align-items: center; gap: 8px; }

.aviso {
  flex-basis: 100%;
  margin: 0;
  padding: 6px 10px;
  font-size: 13px;
  color: #9a6700;
  background: #fff8e1;
  border-radius: 8px;
}

@media (prefers-color-scheme: dark) {
  .aviso { color: #f0c000; background: #2a2410; }
}

.avatar {
  display: inline-grid;
  place-items: center;
  border-radius: 50%;
  object-fit: cover;
  background: var(--cor, var(--borda));
  box-shadow: 0 0 0 2px var(--superficie), 0 0 0 3px var(--cor, transparent);
  font-size: 10px;
  font-weight: 700;
  color: #fff;
}

.grade {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 10px;
  padding: 16px;
  align-items: start;
}

.coluna { display: grid; gap: 8px; }

.cabecalho-dia {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  padding: 2px 4px;
}

.nome-dia { font-weight: 600; font-size: 13px; }
.data-dia { color: var(--texto-fraco); font-size: 12px; }
.coluna.hoje .nome-dia { color: var(--acento); }

.coluna.hoje .cabecalho-dia {
  border-bottom: 2px solid var(--acento);
  padding-bottom: 6px;
}

.vazio {
  padding: 14px 10px;
  text-align: center;
  color: var(--texto-fraco);
  font-size: 13px;
  border: 1px dashed var(--borda);
  border-radius: var(--raio);
}

.aula {
  display: grid;
  gap: 4px;
  padding: 10px;
  background: var(--superficie);
  border: 1px solid var(--borda);
  border-radius: var(--raio);
  cursor: pointer;
  transition: transform .12s ease, box-shadow .12s ease, border-color .12s ease;
}

.aula:hover { transform: translateY(-1px); box-shadow: var(--sombra); }
.aula:focus-visible { outline: 2px solid var(--acento); outline-offset: 2px; }
.aula.marcada { border-color: var(--acento); box-shadow: inset 3px 0 0 var(--acento); }

/* Quanto mais gente falta, mais quente a célula. */
.aula[data-heat="1"] { background: color-mix(in srgb, var(--acento) 4%, var(--superficie)); }
.aula[data-heat="2"] { background: color-mix(in srgb, var(--acento) 9%, var(--superficie)); }
.aula[data-heat="3"] { background: color-mix(in srgb, var(--acento) 14%, var(--superficie)); }
.aula[data-heat="4"] { background: color-mix(in srgb, var(--acento) 20%, var(--superficie)); }

.sigla { font-weight: 700; font-size: 14px; }

.nome-materia {
  font-size: 11px;
  color: var(--texto-fraco);
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.horario { display: flex; gap: 6px; font-size: 11px; color: var(--texto-fraco); }
.horario .sala { margin-left: auto; }
.faltantes { display: flex; flex-wrap: wrap; gap: 3px; margin-top: 4px; }

.motivo {
  justify-self: start;
  padding: 2px 6px;
  font-size: 11px;
  color: var(--texto-fraco);
  background: none;
  border: 1px dashed var(--borda);
  border-radius: 6px;
}

@media (max-width: 860px) {
  .grade { grid-template-columns: 1fr; padding: 12px; }
  .navegacao { margin-inline: 0; }
  .coluna { border-bottom: 1px solid var(--borda); padding-bottom: 12px; }
  .coluna:last-child { border-bottom: 0; }
  .cabecalho-dia { position: sticky; top: 62px; background: var(--fundo); z-index: 5; }
}
```

- [ ] **Step 4: Verificar no navegador**

Com o servidor rodando, confirme:
- A grade mostra seis colunas no desktop, com as aulas da semana atual.
- Feriado aparece como "Feriado"; sábado, como "Sem aula".
- As setas navegam entre semanas e desabilitam nos extremos do semestre.
- "Hoje" volta para a semana atual; a coluna de hoje fica destacada.
- Clicar numa aula marca sua falta e seu avatar aparece na célula.
- Em uma janela estreita (< 860px) vira lista vertical, ainda legível.
- Abrir em outro navegador com outro usuário: os dois avatares aparecem na mesma célula, e a célula fica mais "quente".

- [ ] **Step 5: Commit**

```bash
git add public/
git commit -m "Adiciona a grade semanal

Colunas por dia no desktop e lista vertical no celular. A célula
esquenta conforme mais gente marca, e a navegação respeita os limites
do semestre.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 17: Frontend — marcação instantânea, motivo e feedback

Substitui o `window.prompt` por um diálogo próprio e faz a marcação responder na hora, sem esperar o servidor. Numa rede de celular, esperar o round-trip a cada clique deixa o app com cara de lento mesmo quando não está.

**Files:**
- Create: `public/js/feedback.js`
- Modify: `public/js/app.js`, `public/css/style.css`

**Interfaces:**
- Consumes: `el` (Task 15)
- Produces:
  - `toast(message, { action }) -> void`
  - `askReason({ title, current }) -> Promise<string | null>` (null = cancelou)

- [ ] **Step 1: Criar `public/js/feedback.js`**

```js
import { el } from './api.js';

let toastTimer = null;

export function toast(message, { action } = {}) {
  document.querySelector('.aviso-flutuante')?.remove();
  clearTimeout(toastTimer);

  const node = el('div', { class: 'aviso-flutuante', role: 'status' },
    el('span', {}, message),
    action && el('button', {
      class: 'link',
      onclick: () => { node.remove(); action.onClick(); }
    }, action.label)
  );

  document.body.append(node);
  toastTimer = setTimeout(() => node.remove(), 5000);
}

// Diálogo nativo: acessível, fecha com Esc e escurece o fundo sem nenhum CSS
// de overlay da nossa parte.
export function askReason({ title, current = '' }) {
  return new Promise((resolve) => {
    const input = el('input', {
      type: 'text', maxlength: '120', value: current,
      placeholder: 'consulta, prova de outra matéria...'
    });

    const dialog = el('dialog', { class: 'dialogo' },
      el('form', {
        method: 'dialog',
        onsubmit: (event) => { event.preventDefault(); dialog.close(input.value.trim()); }
      },
        el('h2', {}, title),
        el('label', {}, 'Motivo (opcional)', input),
        el('menu', {},
          el('button', { type: 'button', class: 'link', onclick: () => dialog.close(' ') },
            'Cancelar'),
          el('button', { type: 'submit', class: 'primario' }, 'Salvar'))
      )
    );

    dialog.addEventListener('close', () => {
      const value = dialog.returnValue;
      dialog.remove();
      resolve(value === ' ' ? null : value);
    });

    document.body.append(dialog);
    dialog.showModal();
    input.focus();
    input.select();
  });
}
```

- [ ] **Step 2: Tornar a marcação otimista em `public/js/app.js`**

Substitua `toggle` e `askReason` por:

```js
import { toast, askReason as promptReason } from './feedback.js';

// Aplica a mudança na tela antes da resposta do servidor. Se falhar, volta
// atrás e avisa — é melhor que travar a cada clique numa rede de celular.
async function toggle(block, value) {
  const target = state.data.days
    .flatMap((day) => day.blocks)
    .find((candidate) => candidate.id === block.id);
  if (!target) return;

  const previous = target.absences ?? [];
  target.absences = value
    ? [...previous, { userId: state.me.id, reason: null }]
    : previous.filter((mark) => mark.userId !== state.me.id);
  draw();

  try {
    await api.put('/api/absences', { blockId: block.id, value });
    if (value) {
      toast(`Falta marcada em ${block.subject}`, {
        action: { label: 'adicionar motivo', onClick: () => setReason(block, '') }
      });
    }
    await load({ force: true });
  } catch (failure) {
    target.absences = previous;
    draw();
    toast(failure.message ?? 'Não consegui salvar');
  }
}

async function setReason(block, current) {
  const reason = await promptReason({ title: block.name, current });
  if (reason === null) return;
  try {
    await api.patch('/api/absences', { blockId: block.id, reason });
    await load({ force: true });
  } catch (failure) {
    toast(failure.message ?? 'Não consegui salvar o motivo');
  }
}
```

Ajuste a chamada de `renderGrid` para passar `onReason: setReason`.

- [ ] **Step 3: Acrescentar o CSS ao `public/css/style.css`**

```css
.aviso-flutuante {
  position: fixed;
  left: 50%;
  bottom: 20px;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  color: var(--texto);
  background: var(--superficie);
  border: 1px solid var(--borda);
  border-radius: 999px;
  box-shadow: var(--sombra);
  font-size: 14px;
  z-index: 50;
  animation: sobe .18s ease-out;
}

@keyframes sobe {
  from { opacity: 0; transform: translate(-50%, 8px); }
  to   { opacity: 1; transform: translate(-50%, 0); }
}

.faltantes .avatar { animation: entra .16s ease-out; }

@keyframes entra {
  from { opacity: 0; transform: scale(.6); }
  to   { opacity: 1; transform: scale(1); }
}

.dialogo {
  padding: 0;
  border: 1px solid var(--borda);
  border-radius: var(--raio);
  background: var(--superficie);
  color: var(--texto);
  box-shadow: var(--sombra);
  max-width: min(92vw, 360px);
}

.dialogo::backdrop { background: rgb(0 0 0 / 35%); }
.dialogo form { display: grid; gap: 12px; padding: 20px; }
.dialogo h2 { margin: 0; font-size: 16px; }
.dialogo label { display: grid; gap: 6px; font-size: 13px; color: var(--texto-fraco); }

.dialogo input {
  padding: 10px 12px;
  font: inherit;
  color: var(--texto);
  background: var(--fundo);
  border: 1px solid var(--borda);
  border-radius: 10px;
}

.dialogo menu { display: flex; justify-content: flex-end; gap: 8px; margin: 0; padding: 0; }

/* Respeita quem pediu menos movimento no sistema. */
@media (prefers-reduced-motion: reduce) {
  * { animation-duration: .01ms !important; transition-duration: .01ms !important; }
}
```

- [ ] **Step 4: Verificar no navegador**

- Clicar numa aula: o avatar aparece **imediatamente**, antes de qualquer resposta do servidor.
- Aparece o aviso flutuante com "adicionar motivo"; clicando, abre o diálogo.
- Digitar um motivo e salvar: o motivo aparece no botão da célula e no `title` do avatar.
- Cancelar o diálogo (botão ou Esc) não altera nada.
- Parar o servidor e clicar numa aula: a marcação volta atrás sozinha e um aviso explica.
- Com "reduzir movimento" ligado no sistema, nada anima.

- [ ] **Step 5: Commit**

```bash
git add public/
git commit -m "Torna a marcação instantânea e adiciona o diálogo de motivo

A célula muda antes da resposta do servidor e volta atrás se a
requisição falhar. O diálogo usa <dialog> nativo, que já traz foco,
Esc e fundo escurecido.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 18: Frontend — painéis de resumo

Responde às três perguntas do spec: quem falta hoje, quem falta em cada matéria, e quais aulas ficarão mais vazias. Mais o contador de frequência.

**Files:**
- Create: `public/js/panels.js`
- Modify: `public/js/app.js`, `public/css/style.css`

**Interfaces:**
- Consumes: `state.today`, `state.days`, `state.frequency`, `state.users`
- Produces: `renderPanels(state, { me, users }) -> HTMLElement`

- [ ] **Step 1: Criar `public/js/panels.js`**

```js
import { el } from './api.js';
import { avatar } from './grid.js';

const DIA_CURTO = { 2: 'seg', 3: 'ter', 4: 'qua', 5: 'qui', 6: 'sex', 7: 'sáb' };

export function renderPanels(state, { users }) {
  const byId = new Map(users.map((user) => [user.id, user]));
  return el('aside', { class: 'paineis' },
    todayPanel(state, byId),
    rankingPanel(state, byId),
    frequencyPanel(state)
  );
}

function panel(title, body, empty) {
  return el('section', { class: 'painel' },
    el('h2', {}, title),
    body.length ? body : el('p', { class: 'vazio-painel' }, empty));
}

function faces(marks, byId) {
  return el('span', { class: 'faces' },
    marks.map((mark) => {
      const user = byId.get(mark.userId);
      return user ? avatar(user, { size: 20 }) : null;
    }));
}

function todayPanel(state, byId) {
  const rows = state.today.blocks
    .filter((block) => (block.absences ?? []).length > 0)
    .map((block) => el('div', { class: 'linha' },
      el('span', { class: 'sigla-pequena' }, block.subject),
      el('span', { class: 'hora-pequena' }, block.start),
      faces(block.absences, byId)));

  return panel('Hoje', rows, state.today.blocks.length
    ? 'Ninguém marcou falta hoje.'
    : 'Hoje não tem aula.');
}

function rankingPanel(state, byId) {
  const rows = state.days
    .flatMap((day) => day.blocks.map((block) => ({ day, block })))
    .filter(({ block }) => (block.absences ?? []).length > 0)
    .sort((a, b) => b.block.absences.length - a.block.absences.length)
    .slice(0, 5)
    .map(({ day, block }) => el('div', { class: 'linha' },
      el('span', { class: 'sigla-pequena' }, block.subject),
      el('span', { class: 'hora-pequena' },
        `${DIA_CURTO[day.weekday] ?? ''} ${block.start}`),
      faces(block.absences, byId)));

  return panel('Mais gente faltando', rows, 'Semana cheia — ninguém marcou nada.');
}

function frequencyPanel(state) {
  if (!state.frequency) return el('section', { class: 'painel' });

  const rows = state.frequency
    .filter((item) => item.limit > 0)
    .map((item) => {
      const used = Math.min(item.missed / item.limit, 1);
      const level = item.remaining <= 0 ? 'estourado'
        : item.remaining <= 2 ? 'atencao' : 'ok';

      return el('div', { class: `frequencia ${level}` },
        el('div', { class: 'linha' },
          el('span', { class: 'sigla-pequena', title: item.name }, item.subject),
          el('span', { class: 'restante' }, item.remaining > 0
            ? `pode faltar mais ${item.remaining}`
            : 'limite estourado')),
        el('div', { class: 'barra' },
          el('div', { class: 'preenchido', style: `width: ${Math.round(used * 100)}%` })),
        el('span', { class: 'detalhe' }, `${item.missed} de ${item.hours} períodos`));
    });

  return panel('Minha frequência', rows, 'Nenhuma falta marcada ainda.');
}
```

- [ ] **Step 2: Ligar em `public/js/app.js`**

Importe `el` de `./api.js` e `renderPanels` de `./panels.js`, e troque `draw` por:

```js
function draw() {
  const { data, me } = state;
  root.replaceChildren(
    renderHeader(data, { me, onWeek: goWeek, onLogout: logout }),
    el('div', { class: 'corpo' },
      renderGrid(data, { me, users: data.users, onToggle: toggle, onReason: setReason }),
      renderPanels(data, { me, users: data.users })
    )
  );
}
```

- [ ] **Step 3: Acrescentar o CSS**

```css
.corpo {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 280px;
  gap: 16px;
  align-items: start;
  max-width: 1500px;
  margin-inline: auto;
}

.paineis { display: grid; gap: 12px; padding: 16px 16px 16px 0; }

.painel {
  display: grid;
  gap: 8px;
  padding: 14px;
  background: var(--superficie);
  border: 1px solid var(--borda);
  border-radius: var(--raio);
}

.painel h2 {
  margin: 0;
  font-size: 13px;
  text-transform: uppercase;
  letter-spacing: .04em;
  color: var(--texto-fraco);
}

.vazio-painel { margin: 0; font-size: 13px; color: var(--texto-fraco); }
.linha { display: flex; align-items: center; gap: 8px; font-size: 13px; }
.sigla-pequena { font-weight: 600; }
.hora-pequena { color: var(--texto-fraco); font-size: 12px; }
.faces { display: flex; gap: 3px; margin-left: auto; }

.frequencia { display: grid; gap: 4px; padding-block: 6px; }
.frequencia .restante { margin-left: auto; font-size: 12px; color: var(--texto-fraco); }
.frequencia .detalhe { font-size: 11px; color: var(--texto-fraco); }

.barra { height: 5px; background: var(--borda); border-radius: 999px; overflow: hidden; }
.preenchido { height: 100%; background: var(--acento); transition: width .3s ease; }

.frequencia.atencao .preenchido { background: #f76b15; }
.frequencia.atencao .restante { color: #f76b15; }
.frequencia.estourado .preenchido { background: #e5484d; }
.frequencia.estourado .restante { color: #e5484d; font-weight: 600; }

@media (max-width: 1100px) {
  .corpo { grid-template-columns: 1fr; }
  .paineis { padding: 0 16px 24px; }
}
```

- [ ] **Step 4: Verificar no navegador**

- "Hoje" lista as aulas de hoje com marcações, mesmo navegando para outra semana.
- "Mais gente faltando" ordena pela quantidade de pessoas.
- "Minha frequência" mostra uma barra por matéria, ordenada por quem está mais perto do limite.
- Marcar várias faltas na mesma matéria faz a barra crescer; ao passar do limite, fica vermelha com "limite estourado".
- Abaixo de 1100px de largura, os painéis descem para baixo da grade.
- Rodar `npm test` uma última vez: tudo verde.

- [ ] **Step 5: Commit**

```bash
git add public/
git commit -m "Adiciona painéis de hoje, ranking e frequência

A frequência é ordenada por quem está mais perto do limite de 25%, que
é a informação que muda decisão.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 19: Empacotamento e documentação

Deixa o projeto pronto para sair da máquina de desenvolvimento.

**Files:**
- Create: `Dockerfile`, `.dockerignore`, `.env.example`, `README.md`

- [ ] **Step 1: Criar `Dockerfile`**

```dockerfile
FROM node:24-alpine

WORKDIR /app
COPY . .

# Sem dependências, então não há npm install: a imagem é o código e o Node.
ENV NODE_ENV=production
ENV DB_PATH=/data/app.db
VOLUME /data
EXPOSE 3000

CMD ["node", "server.js"]
```

`.dockerignore`:

```
.git
data
node_modules
docs
test
```

- [ ] **Step 2: Criar `.env.example`**

```bash
# Código que os amigos digitam para criar o perfil. Troque por algo só de vocês.
GROUP_CODE=escolha-um-codigo

PORT=3000
DB_PATH=data/app.db

# Ligue quando o site estiver atrás de HTTPS: o cookie passa a exigir conexão segura.
SECURE_COOKIES=1

# Trocar a fase é trocar estes gids (e a fase) — nada de código muda.
# SHEET_ID=1aBruvw1ZgEuZp2PM9d3ABqQ1akhmbhmbwWBxra5SpE8
# GID_PLANNER=267797752
# GID_GRADE=1283325522
# GID_SUBJECTS=1802549288
# PHASE=4
```

- [ ] **Step 3: Escrever o `README.md`**

Deve conter, em português:

1. **O que é** — uma frase, e uma captura de tela da grade.
2. **Rodar localmente:**
   ```bash
   GROUP_CODE=escolha-um-codigo npm start
   ```
   Sem `npm install`: o projeto não tem dependências. Requer Node 24+.
3. **Rodar os testes:** `npm test`.
4. **Como funciona** — três parágrafos: de onde vêm os horários (as três abas, com os gids), como funciona o refresh de 5 minutos com cache do último bom, e por que a marcação é gravada por período mas feita por aula.
5. **Trocar de turma** — mudar `GID_PLANNER`, `GID_GRADE` e `PHASE` no ambiente. Explicar como achar o gid: abrir a aba no Google Sheets e ler o número depois de `#gid=` na URL.
6. **Deploy** — as duas opções, com os comandos:
   - Docker/Fly.io com volume montado em `/data`.
   - Máquina própria com `systemd` mais Cloudflare Tunnel para HTTPS.
   Frisar que `SECURE_COOKIES=1` é necessário quando houver HTTPS, e que expor sem HTTPS deixa o cookie em claro.
7. **Backup** — copiar `data/app.db`. É o app inteiro: pessoas, fotos e faltas.
8. **Quando a planilha mudar de formato** — o site continua no ar com o último horário bom e mostra o aviso de desatualizado. O conserto é em `src/sheets.js`; rodar `npm test` mostra exatamente o que quebrou. Para atualizar as fixtures, os três comandos `curl` da Task 1.
9. **Limitações** — a lista do spec, resumida: PIN curto é fraco por natureza, marcar aqui não é falta oficial, a planilha precisa continuar pública.

- [ ] **Step 4: Verificar a imagem**

```bash
docker build -t faltas . && \
docker run --rm -p 3000:3000 -e GROUP_CODE=teste -v faltas-data:/data faltas
```

Esperado: o site sobe em `localhost:3000`, mostra a grade, e um cadastro criado sobrevive a parar e subir o contêiner de novo (o volume persiste).

Se não houver Docker na máquina, pule a execução e valide só que o `Dockerfile` está escrito, anotando isso no commit.

- [ ] **Step 5: Rodar a suíte inteira uma última vez**

Run: `npm test`
Expected: todos os arquivos de teste passando, sem `todo` nem `skip`.

- [ ] **Step 6: Commit**

```bash
git add Dockerfile .dockerignore .env.example README.md
git commit -m "Adiciona empacotamento e documentação

Imagem sem etapa de instalação, porque não há dependências. README
cobre trocar de turma pelos gids e o que fazer quando a planilha mudar
de formato.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Verificação final

Depois da Task 19, confira contra o spec:

- [ ] `npm test` verde, sem teste pulado.
- [ ] `npm ls --all` não lista nenhuma dependência.
- [ ] `grep -rnE "ExtPes|DWeb-I|MetNum|CiTecSO|BD2|07:30" src/ public/ server.js` não retorna nada — nenhuma matéria nem horário fixo no código de produção.
- [ ] Editar uma célula na planilha e, em até 5 minutos, ver a mudança no site sem reiniciar nada.
- [ ] Dois navegadores, dois usuários: cada um só consegue marcar as próprias faltas, e um vê a marcação do outro em até 60 segundos.
- [ ] Testar no celular de verdade, não só na janela estreita do desktop.
