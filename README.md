# Calendário de Faltas — 4ª fase

Site onde a turma marca, com antecedência, em quais aulas pretende faltar. Os
horários vêm sozinhos da planilha pública do IFC — Campus Videira; ninguém
digita grade nenhuma.

![A grade da semana](docs/grade.png)

## Rodar localmente

```bash
GROUP_CODE=escolha-um-codigo npm start
```

Não existe `npm install`: o projeto não tem uma única dependência, só o Node 24+
e seus módulos embutidos (`node:http`, `node:sqlite`, `node:crypto`).

Testes:

```bash
npm test
```

## Como funciona

**De onde vêm os horários.** Três abas da mesma planilha, lidas como CSV pela URL
pública de exportação: o planejamento por data (`GID_PLANNER`, que diz qual
matéria cai em qual período de cada dia), a grade da semana típica
(`GID_GRADE`, de onde saem sala e professor) e a tabela mestra de disciplinas
(`GID_SUBJECTS`, de onde sai a carga horária oficial em períodos de 50 minutos —
o denominador do cálculo de frequência). Nada é lido por posição fixa: o parser
procura os cabeçalhos pelo texto, confere o dia da semana contra o marcador que
a própria planilha repete ao lado da data, e **lança erro em vez de adivinhar**
quando a forma muda.

**O refresh de 5 minutos.** O servidor rebusca as três abas a cada 5 minutos e
compara o hash do CSV: se nada mudou, nada é reconstruído. Quando a busca falha
— rede fora, planilha despublicada, formato quebrado — o último horário bom
continua no ar, guardado no SQLite, e o site passa a mostrar um aviso de
desatualizado. O navegador pergunta pelo estado com a versão que já tem; quando
a versão bate, a resposta é um `{ unchanged: true }` de poucos bytes.

**Por que a falta é gravada por período.** Você marca uma *aula* — o bloco
inteiro, como aparece na grade —, mas o banco grava um registro por período de
50 minutos. É isso que faz a contagem de frequência bater com a carga horária
oficial, e é isso que permite a planilha remontar os blocos no meio do semestre
sem perder nenhuma marcação. O cliente manda só o id da aula; **quais períodos
ela ocupa quem decide é o servidor**, a partir do horário que ele mesmo montou.

## Trocar de turma

Não mexe em código nenhum — só no ambiente:

```bash
GID_PLANNER=...  GID_GRADE=...  PHASE=...
```

Para achar um gid: abra a aba no Google Sheets e leia o número depois de `#gid=`
na URL.

## Deploy

**Docker (Fly.io, VPS, o que for)** — monte um volume em `/data`, que é onde o
banco vive:

```bash
docker build -t faltas .
docker run -d -p 3000:3000 \
  -e GROUP_CODE=escolha-um-codigo -e SECURE_COOKIES=1 \
  -v faltas-data:/data faltas
```

**Máquina própria (recomendado)** — não precisa de Docker: o projeto não tem
dependências, então não há nada para instalar além do Node. Dois serviços
`systemd`, um para o app e outro para o túnel:

```bash
cp .env.example .env && chmod 600 .env   # edite o GROUP_CODE
sudo cp deploy/faltas.service /etc/systemd/system/
sudo systemctl enable --now faltas
```

O Cloudflare Tunnel entra na frente para dar HTTPS e domínio sem abrir porta
nenhuma no roteador — `deploy/cloudflared-config.yml` traz o modelo. O app
escuta só em `127.0.0.1` por padrão, então o túnel é o único caminho até ele.

Nos dois casos: `SECURE_COOKIES=1` assim que houver HTTPS. Expor o site sem
HTTPS manda o cookie de sessão em claro pela rede — qualquer um no mesmo Wi-Fi
lê e entra como você.

## Backup

Copie `data/app.db`. É o aplicativo inteiro: pessoas, fotos e faltas. Um `cron`
diário com `sqlite3 data/app.db ".backup /destino/app-$(date +%F).db"` resolve.

## Quando a planilha mudar de formato

O site não cai: continua servindo o último horário bom e mostra o aviso de
desatualizado. O conserto é em `src/sheets.js`, e `npm test` aponta exatamente o
que quebrou. Para atualizar as fixtures com a planilha de hoje:

```bash
ID=1aBruvw1ZgEuZp2PM9d3ABqQ1akhmbhmbwWBxra5SpE8
curl -sL "https://docs.google.com/spreadsheets/d/$ID/export?format=csv&gid=267797752"  > test/fixtures/planner-hf4.csv
curl -sL "https://docs.google.com/spreadsheets/d/$ID/export?format=csv&gid=1283325522" > test/fixtures/grade-4fase.csv
curl -sL "https://docs.google.com/spreadsheets/d/$ID/export?format=csv&gid=1802549288" > test/fixtures/disciplinas.csv
```

## Limitações

- **PIN de 4 a 6 dígitos é fraco por natureza.** Há limite de tentativas, mas
  quem conhece o código do grupo e tem paciência entra na conta de alguém. É
  proporcional ao que o site guarda: uma intenção de faltar, não uma nota.
- **Marcar aqui não é falta oficial.** Isto não conversa com o SIGAA. O contador
  de frequência é uma estimativa a partir da carga horária publicada.
- **A planilha precisa continuar pública.** Se ela deixar de ser, o site
  congela no último horário bom e avisa — mas não descobre sozinho o novo
  endereço.
