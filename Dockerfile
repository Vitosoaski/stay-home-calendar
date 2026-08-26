# Uma imagem só: o calendário e o túnel da Cloudflare.
#
#   docker build -t stay-home-calendar .
#   docker run -d --name stay-home-calendar --restart unless-stopped \
#     -e GROUP_CODE=segredo-do-grupo \
#     -e TUNNEL_TOKEN=... \
#     -v stay-home-calendar-data:/data \
#     stay-home-calendar
#
# Sem TUNNEL_TOKEN, use TUNNEL_QUICK=1 para uma URL descartável, ou publique a
# porta com -p 3000:3000 e nenhum túnel.

FROM node:24-alpine

# O binário é estático, então copiar da imagem oficial basta — e assim a versão
# do cloudflared vem assinada por eles, sem curl nem checksum no build.
COPY --from=cloudflare/cloudflared:latest /usr/local/bin/cloudflared /usr/local/bin/cloudflared

WORKDIR /app
COPY . .

# Sem dependências, então não há npm install: a imagem é o código e o Node.
ENV NODE_ENV=production
ENV DB_PATH=/data/app.db
ENV PORT=3000
# O túnel fala com o app pelo loopback do próprio contêiner. Publique a porta
# (-p) só se quiser acesso direto — aí troque para 0.0.0.0.
ENV HOST=127.0.0.1
# Atrás do túnel o cookie sempre trafega por HTTPS.
ENV SECURE_COOKIES=1

VOLUME /data
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD wget -q -O /dev/null http://127.0.0.1:3000/api/state || exit 1

ENTRYPOINT ["/app/docker/entrypoint.sh"]
