#!/bin/sh
# Sobe o app e, quando configurado, o túnel da Cloudflare no mesmo contêiner.
#
# Três modos, decididos pelo ambiente:
#   TUNNEL_TOKEN=...   túnel nomeado (domínio próprio) — o modo de produção
#   TUNNEL_QUICK=1     túnel descartável, URL aleatória impressa no log
#   nenhum dos dois    só o app; publique a porta você mesmo com -p
set -eu

PORT="${PORT:-3000}"
APP_PID=""
TUNNEL_PID=""

encerra() {
  # Mata os dois na ordem inversa: primeiro para de receber, depois desliga.
  [ -n "$TUNNEL_PID" ] && kill -TERM "$TUNNEL_PID" 2>/dev/null || true
  [ -n "$APP_PID" ] && kill -TERM "$APP_PID" 2>/dev/null || true
  wait 2>/dev/null || true
  exit 0
}
trap encerra TERM INT

echo "[entrypoint] subindo o calendário na porta $PORT"
node server.js &
APP_PID=$!

# O túnel só entra depois que o app responde, senão as primeiras requisições
# batem em porta fechada. 30s é folga larga: o app costuma subir em menos de 1s.
espera=0
until wget -q -O /dev/null "http://127.0.0.1:${PORT}/api/state" 2>/dev/null; do
  if ! kill -0 "$APP_PID" 2>/dev/null; then
    echo "[entrypoint] o app morreu antes de ficar pronto" >&2
    exit 1
  fi
  espera=$((espera + 1))
  if [ "$espera" -gt 60 ]; then
    echo "[entrypoint] o app não respondeu em 30s" >&2
    encerra
  fi
  sleep 0.5
done
echo "[entrypoint] app pronto"

if [ -n "${TUNNEL_TOKEN:-}" ]; then
  echo "[entrypoint] abrindo o túnel nomeado"
  cloudflared --no-autoupdate tunnel run &
  TUNNEL_PID=$!
elif [ "${TUNNEL_QUICK:-}" = "1" ]; then
  echo "[entrypoint] abrindo túnel descartável — a URL aparece abaixo"
  cloudflared --no-autoupdate tunnel --url "http://127.0.0.1:${PORT}" &
  TUNNEL_PID=$!
else
  echo "[entrypoint] sem túnel — publique a porta com -p ${PORT}:${PORT}"
fi

# Se qualquer um dos dois cair, o contêiner cai junto e a política de restart
# do Docker recomeça os dois limpos. Melhor que ficar meio no ar.
while kill -0 "$APP_PID" 2>/dev/null; do
  if [ -n "$TUNNEL_PID" ] && ! kill -0 "$TUNNEL_PID" 2>/dev/null; then
    echo "[entrypoint] o túnel caiu" >&2
    encerra
  fi
  sleep 2
done

echo "[entrypoint] o app caiu" >&2
encerra
