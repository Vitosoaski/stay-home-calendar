# Calendário de Faltas — Design

**Data:** 2026-08-25
**Status:** aprovado para implementação

## Objetivo

Um site onde um grupo de amigos da 4ª fase de Ciência da Computação (IFC — Campus
Videira) marca antecipadamente quais aulas pretende faltar. A grade de horários vem
de uma planilha pública do Google Sheets e se atualiza sozinha; nenhum horário fica
fixo no código.

## Decisões que moldam o resto

**A grade é por data, não um molde semanal.** A planilha é um calendário data a
data, e o horário muda ao longo do semestre — na 4ª fase, terça foi `Fisica` até
27/10 e virou `BD2` a partir de 03/11; feriados apagam dias inteiros. Uma grade
"toda terça é Física" seria falsa. A tela mostra uma semana por vez, com navegação.

**Zero dependências.** Node 24 traz `node:sqlite`, `node:http`, `node:crypto` e
`node:test` embutidos. O `package.json` não declara nenhuma dependência: não existe
`node_modules`, não há binário nativo para compilar, e o deploy é copiar a pasta.

**Faltas são gravadas por período, marcadas por aula.** O usuário clica numa aula
(`ExtPes`, 07:30–10:00) e o banco grava três linhas, uma por período. Isso sobrevive
à planilha remontar os blocos e permite contar frequência com precisão.

**Escrita nunca aceita identidade do cliente.** O `user_id` de toda mutação vem da
sessão. Não existe rota capaz de marcar falta em nome de outra pessoa — é uma
propriedade da API, não uma checagem que dá para esquecer.

## Arquitetura

```
Google Sheets ──CSV a cada 5min──▶ schedule.js (cache em memória)
                                        │
Navegador ◀──JSON + cookie──▶ server.js ─┴─▶ data/app.db (node:sqlite)
```

O navegador nunca fala com o Google. O servidor busca, interpreta e serve — o que
elimina CORS, evita cada visitante baixar a planilha, e garante que todos veem a
mesma grade.

### Arquivos

```
server.js              sobe o HTTP, junta as peças
config.js              gids, porta, código do grupo, intervalos
src/
  sheets.js            baixa e interpreta os CSVs
  schedule.js          cache, refresh de 5 min, versionamento
  db.js                schema e queries
  auth.js              PIN, sessões, cookies, rate limit
  api.js               rotas /api/*
  http.js              helpers: json, body, estáticos, headers
public/
  index.html
  css/style.css
  js/app.js            bootstrap e roteamento de telas
  js/api.js            cliente HTTP
  js/grid.js           renderização da grade e dos painéis
  js/photo.js          corte e redimensionamento no canvas
test/
  fixtures/*.csv       CSVs reais salvos da planilha
  sheets.test.js  db.test.js  auth.test.js  api.test.js
data/app.db            fora do git
```

Cada módulo tem uma responsabilidade e uma interface pequena. `sheets.js` recebe
texto CSV e devolve estruturas — não faz rede nem toca no banco, o que o torna
testável com fixtures. `schedule.js` é quem busca e agenda.

## Fonte de dados

Planilha `1aBruvw1ZgEuZp2PM9d3ABqQ1akhmbhmbwWBxra5SpE8`, lida via
`https://docs.google.com/spreadsheets/d/<ID>/export?format=csv&gid=<GID>`.
Sem API key, sem OAuth — verificado, responde 200 para anônimo.

| Aba | gid | Uso |
|---|---|---|
| `HF4` — Planejamento 4ª fase | `267797752` | Calendário data a data + legenda sigla→nome |
| `4 FASE` — grade | `1283325522` | Sala e professor por dia/horário |
| Disciplinas (mestra) | `1802549288` | CH oficial em períodos de 50 min, para a frequência |

Total: ~16 KB por ciclo.

### Formato da aba de planejamento

Blocos de dia lado a lado. Cada bloco tem uma coluna `Data/Hr`, depois as colunas de
horário. Cada linha de dados é uma semana; a célula de data traz `dd/MM` e as
seguintes trazem a sigla da matéria em cada período.

```
linha 8    SEGUNDA-FEIRA(c2)          TERÇA-FEIRA(c13)        ...
linha 9    Data/Hr 07:30 08:20 ...    Data/Hr 07:30 ...
linha 11   2  03/08  ExtPes ExtPes    3  04/08  ExtPes SO     ...
```

Horários: `07:30 08:20 09:10 10:20 11:10` (manhã) e `13:30 14:20 15:30 16:20`
(tarde). Cada período dura 50 min. Sábado tem só cinco.

### Algoritmo do parser

O parser se localiza por **conteúdo**, nunca por índice fixo, porque a planilha é
mantida por humanos e as colunas vão mudar.

1. **Linha dos dias** — a primeira com 3+ células casando `/-FEIRA|SÁBADO/i`.
2. **Blocos de dia** — a partir da coluna de cada dia, acha o `Data/Hr` seguinte;
   as colunas de horário são as subsequentes casando `/^\d{1,2}:\d{2}$/`.
3. **Semanas** — toda linha cuja célula de data casa `dd/MM` vira um dia por bloco.
4. **Ano** — extraído do cabeçalho (`"2º Semestre de 2026"`); se o mês diminuir
   entre linhas consecutivas, incrementa o ano (virada de ano).
5. **Legenda** — à direita da célula `LEGENDA`, as células não-vazias em ordem são
   pareadas duas a duas: `BD2`→`BANCO DE DADOS II`. Isso absorve o espaçamento
   irregular deixado pelas células mescladas (às vezes 2 colunas, às vezes 3).
   Pareamento que falha degrada para mostrar a sigla — não quebra a grade.
6. **Blocos de aula** — períodos consecutivos com a mesma sigla viram uma aula só.
   Não mescla através do intervalo do almoço (entre `11:10` e `13:30`).
   Fim do bloco = início do último período + 50 min.
7. **`Fer/Rec`** vira feriado: dia apagado, não aceita marcação.
8. Texto fora das colunas de horário conhecidas é ignorado (ex.: "SEMANA DA
   COMPUTAÇÃO" numa coluna solta em 10/10).

### Aba de grade (sala e professor)

Colunas: `[0]` número do dia (2–7), `[3]` horário, `[4]` disciplina, `[5]` sala,
`[6]` professor. O nome do dia só aparece na primeira linha do grupo. Chave:
`${dia}|${horário}` → `{sala, professor}`.

### Validação do parser

A contagem de períodos por matéria no semestre inteiro confere com a CH oficial:
MetNum 72/72, BD2 72/72, CiTecSO 36/36, DWeb-I 71/72, ExtPes 70/72, SO 74/72,
Fisica 38/36. As diferenças são reposições e ajustes reais do calendário. Esta
comparação vira um teste.

## Dados

### Schema

```sql
CREATE TABLE users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  name_key      TEXT NOT NULL UNIQUE,   -- minúsculo, unicidade case-insensitive
  color         TEXT NOT NULL,          -- identificação visual
  photo         BLOB,                   -- WebP 96x96, ~4KB
  photo_type    TEXT,
  photo_version INTEGER NOT NULL DEFAULT 0,
  pin_hash      TEXT NOT NULL,
  pin_salt      TEXT NOT NULL,
  created_at    TEXT NOT NULL
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,          -- SHA-256 do token do cookie
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  last_seen  TEXT NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

CREATE TABLE absences (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date       TEXT NOT NULL,             -- YYYY-MM-DD
  slot       TEXT NOT NULL,             -- HH:MM
  subject    TEXT NOT NULL,             -- sigla, snapshot do momento
  reason     TEXT,                      -- motivo opcional
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, date, slot)
);
CREATE INDEX idx_absences_date ON absences(date);
CREATE INDEX idx_absences_user_subject ON absences(user_id, subject);

CREATE TABLE cache (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  fetched_at TEXT NOT NULL
);
```

A chave `(user_id, date, slot)` torna o toggle idempotente: clicar duas vezes não
duplica e dois cliques simultâneos não brigam. `subject` é snapshot — se a planilha
trocar Física por BD2 em novembro, as faltas já marcadas continuam sabendo do que
eram. `reason` é gravado igual em todos os períodos de um mesmo bloco.

`cache` guarda o último horário parseado com sucesso, para o site subir já correto
após reiniciar, sem esperar o Google.

### Formato servido ao frontend

```json
{
  "version": "a3f9:12",
  "updatedAt": "2026-08-25T21:40:00Z",
  "stale": false,
  "week": "2026-08-24",
  "days": [{
    "date": "2026-08-24", "weekday": 2, "label": "Segunda", "holiday": false,
    "blocks": [{
      "id": "2026-08-24|07:30",
      "subject": "ExtPes", "name": "EXTENSÃO E PESQUISA EM COMPUTAÇÃO",
      "slots": ["07:30","08:20","09:10"], "start": "07:30", "end": "10:00",
      "room": "D04", "teacher": "Leila L Rossi"
    }]
  }],
  "users": [{ "id": 1, "name": "João", "color": "#e5484d", "photoVersion": 3 }],
  "absences": { "2026-08-24|07:30": [{ "userId": 1, "reason": "consulta" }] },
  "frequency": [{
    "subject": "Fisica", "name": "FÍSICA",
    "total": 36, "missed": 4, "limit": 9, "remaining": 5
  }]
}
```

O parâmetro `week` é sempre a **segunda-feira** da semana pedida, em `YYYY-MM-DD`;
o servidor normaliza qualquer data recebida para a segunda-feira correspondente.
Dias sem aula (sábado vazio, feriado) vêm na lista com `blocks: []`, para que a
grade mantenha a mesma forma toda semana.

Um usuário aparece na lista de um bloco se tiver falta em **pelo menos um** dos
períodos daquele bloco. Como a marcação é sempre por aula inteira, na prática são
todos; a regra existe para o caso de a planilha remontar os blocos depois de uma
marcação já gravada — nesse caso a falta continua visível em vez de sumir.

`frequency` é sempre do usuário logado. `total` é a CH oficial em períodos de 50 min
(com a contagem do planejamento como fallback), `limit` é `floor(total * 0.25)`.

## API

| Rota | Corpo | Resposta |
|---|---|---|
| `POST /api/signup` | `{groupCode, name, pin, photo}` | 201 + cookie |
| `POST /api/login` | `{name, pin}` | 200 + cookie |
| `POST /api/logout` | — | 204 |
| `GET /api/me` | — | usuário ou 401 |
| `PATCH /api/me` | `{photo?, color?}` | usuário |
| `GET /api/state?week=&v=` | — | estado completo, ou `{unchanged:true}` |
| `PUT /api/absences` | `{blockId, value, reason?}` | `{ok}` |
| `PATCH /api/absences` | `{blockId, reason}` | `{ok}` |
| `GET /api/photo/:id?v=` | — | imagem com `ETag` |

Uma rota só (`/api/state`) devolve grade, usuários, faltas e frequência: um
roundtrip por render, frontend simples.

As rotas de falta recebem apenas `blockId` (`"2026-08-24|07:30"`); o servidor
deriva `slots` e `subject` do horário que ele mesmo montou. Aceitar `slots` do
cliente seria aceitar que ele inventasse períodos inexistentes naquele dia — do
jeito atual isso é impossível por construção, e não por validação.

**Versionamento.** `version` é `"<bootId>:<contador>"`. O contador sobe a cada
refresh da planilha e a cada escrita. O `bootId` aleatório por processo evita que um
cliente com versão velha veja `unchanged` depois de o servidor reiniciar.

## Atualização periódica

**Servidor, 5 min.** `setInterval` baixa os três CSVs e compara o SHA-256 do
conteúdo com o anterior. Igual, descarta. Diferente, reparseia, incrementa a versão
e grava em `cache`. Se a planilha não mudou, o custo é 16 KB e um hash.

**Falha do Google** (fora do ar, planilha virou privada, formato quebrou): mantém o
último horário bom, marca `stale: true` com o horário da última sincronização
bem-sucedida, e o site mostra um aviso discreto. Nunca fica em branco.
A resposta é validada como CSV de verdade antes de substituir o cache — se voltar
HTML de login, é tratado como falha.

**Navegador, 60 s.** Chama `/api/state?v=<atual>`; se nada mudou, a resposta é
mínima e nada re-renderiza. Também sincroniza ao voltar o foco da aba.
Frequências separadas de propósito: as faltas dos amigos mudam muito mais que o
horário, e esperar 5 min para ver que alguém marcou seria ruim.

## Identificação e segurança

**Cadastro:** código do grupo (variável de ambiente, enviado no WhatsApp) + nome +
foto + PIN de 4–6 dígitos. Comparação do código com `timingSafeEqual`.

**PIN:** `scrypt` com salt individual.

**Sessão:** token de 32 bytes aleatórios, guardado como SHA-256 — vazou o banco,
ninguém rouba sessão. Cookie `HttpOnly; SameSite=Lax; Secure` (quando HTTPS),
90 dias.

**Foto:** o navegador corta em quadrado e reduz para 96×96 WebP num `<canvas>` antes
de enviar (~4 KB). Vai como BLOB. Backup do app inteiro é copiar `app.db`.
Servida com `ETag`, então baixa uma vez só.

**Defesas:** `user_id` sempre da sessão; rate limit em memória (5 logins/min/IP,
3 cadastros/hora/IP); checagem de `Origin` nas escritas; CSP `default-src 'self'`
sem inline; `X-Content-Type-Options: nosniff`; validação de tamanho e formato em
tudo que entra (nome ≤ 24, PIN 4–6 dígitos, foto ≤ 64 KB e `image/*`, motivo ≤ 120).

## Interface

**Desktop:** dias nas colunas (SEG→SÁB), aulas nas linhas, grade dominando a tela.
**Mobile:** lista vertical por dia, hoje aberto por padrão — não é a mesma tabela
espremida.

Cada célula traz sigla, nome da matéria, horário, sala e professor discretos, e as
fotos de quem vai faltar. A célula em que você marcou tem estado visual próprio.
Quanto mais gente marcada, mais quente a célula fica — dá para bater o olho e ver
onde a turma vai sumir.

Marcar é um clique, com atualização otimista. Um toast confirma e oferece
"adicionar motivo", que abre um campo curto — o caminho rápido continua rápido.

Três painéis: **Hoje** (quem falta hoje), **Por matéria** (quem falta em quê nesta
semana) e **Minha frequência** (barra por matéria, com destaque quando `remaining`
fica baixo). O ranking das aulas mais esvaziadas fica no painel da semana.

Tema claro e escuro pelo `prefers-color-scheme`. Animações curtas e discretas.

## Testes

`node:test`, sem dependências.

- **`sheets.test.js`** — sobre fixtures reais: dias e horários detectados, blocos
  mesclados corretamente, legenda pareada, feriado marcado, ano inferido, contagem
  por matéria batendo com a CH oficial, e degradação limpa com CSV malformado.
- **`db.test.js`** — toggle idempotente, isolamento entre usuários, cascade delete.
- **`auth.test.js`** — hash e verificação de PIN, ciclo de sessão, rate limit.
- **`api.test.js`** — 401 sem cookie; impossível marcar falta por outro usuário;
  validação de entrada rejeitando o que deve.

## Hospedagem

`node server.js` na máquina local para começar. `Dockerfile` incluído para Fly.io
(com volume persistente para `data/`) ou qualquer VPS. Sem build, sem dependências,
sem binário nativo — roda igual em x86 e ARM.

Para expor à internet, Cloudflare Tunnel dá HTTPS de graça e mantém o cookie seguro.

## Limitações conhecidas

1. **A planilha precisa continuar pública.** Se virar restrita, o export devolve
   HTML de login; isso é detectado e vira aviso, não dado corrompido.
2. **O parser depende do formato.** Reorganização profunda da planilha pode quebrá-lo.
   Mitigado por busca por conteúdo, cache do último bom, aviso visível, e testes
   sobre CSV real — o conserto fica num arquivo só.
3. **Não dá para saber se mudou sem baixar** — o Google não dá `ETag` confiável
   nesse endpoint. Baixar 16 KB a cada 5 min é irrisório.
4. **PIN de 4–6 dígitos é fraco por natureza.** Adequado a "meus amigos não mexem
   nas minhas faltas"; inadequado a qualquer coisa séria. Rate limit ajuda, não resolve.
5. **Sem HTTPS o cookie viaja em claro.**
6. **Fuso fixo em `America/Sao_Paulo`** para decidir o que é "hoje".
7. **Ano inferido do cabeçalho**, porque as datas na planilha são só `dd/MM`.
8. **A CH oficial e o planejamento divergem em até 2 períodos.** O contador usa a CH
   oficial, que é o número que a instituição usa para os 25%.
9. **Marcar falta aqui não é falta oficial** — é combinado entre amigos; o diário do
   professor é outro sistema.

## Fora de escopo (por ora)

Outras fases (o parser já é genérico: mudar o gid basta), faltas recorrentes,
marcação de período solto dentro de uma aula, notificações, e qualquer papel de
administrador além do código do grupo.
