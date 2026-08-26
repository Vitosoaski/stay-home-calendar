FROM node:24-alpine

WORKDIR /app
COPY . .

# Sem dependências, então não há npm install: a imagem é o código e o Node.
ENV NODE_ENV=production
ENV DB_PATH=/data/app.db
# Dentro do contêiner é preciso aceitar de fora dele; quem publica a porta é o docker.
ENV HOST=0.0.0.0
VOLUME /data
EXPOSE 3000

CMD ["node", "server.js"]
