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

### Docker com o túnel embutido (recomendado)

Uma imagem só, contendo o app e o `cloudflared`. Não é preciso abrir porta
nenhuma no roteador nem ter IP fixo.

```bash
docker build -t stay-home-calendar .
```

**Testar agora, sem domínio nem conta** — sobe uma URL pública descartável, que
aparece no log:

```bash
docker run --rm -e GROUP_CODE=teste -e TUNNEL_QUICK=1 stay-home-calendar
```

**Para valer, com domínio próprio.** No painel Cloudflare Zero Trust crie um
túnel (Networks → Tunnels → Create), aponte-o para `http://127.0.0.1:3000` e
copie o token que ele mostra:

```bash
docker run -d --name stay-home-calendar --restart unless-stopped \
  -e GROUP_CODE=escolha-um-codigo \
  -e TUNNEL_TOKEN=cole-o-token-aqui \
  -v stay-home-calendar-data:/data \
  stay-home-calendar
```

É só isso. O `--restart unless-stopped` religa depois de reboot ou queda, e o
volume guarda o banco.

**Sem túnel**, se preferir expor por outro caminho:

```bash
docker run -d -p 3000:3000 -e GROUP_CODE=... -e HOST=0.0.0.0 \
  -v stay-home-calendar-data:/data stay-home-calendar
```

Por padrão o app escuta só no loopback do contêiner: com o túnel, ele é o único
caminho de entrada. Não publique a porta junto com o túnel — quem alcança o app
por fora pode forjar o `X-Forwarded-For` e driblar o limite de tentativas de
login.

### Sem Docker, direto na máquina

O projeto não tem dependências, então basta o Node 24 e dois serviços
`systemd` — um para o app, outro para o `cloudflared`:

```bash
cp .env.example .env && chmod 600 .env   # edite o GROUP_CODE
sudo cp deploy/stay-home-calendar.service /etc/systemd/system/
sudo systemctl enable --now stay-home-calendar
```

O modelo de configuração do túnel está em `deploy/cloudflared-config.yml`.
Ligue `SECURE_COOKIES=1` assim que houver HTTPS: sem isso o cookie de sessão
trafega em claro, e qualquer um no mesmo Wi-Fi entra como você.

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
