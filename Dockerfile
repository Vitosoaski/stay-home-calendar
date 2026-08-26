FROM node:24-alpine

WORKDIR /app
COPY . .

# Sem dependências, então não há npm install: a imagem é o código e o Node.
ENV NODE_ENV=production
ENV DB_PATH=/data/app.db
VOLUME /data
EXPOSE 3000

CMD ["node", "server.js"]
