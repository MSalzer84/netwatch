FROM node:lts-alpine

# ping-Unterstützung für den Offline-Monitor
RUN apk add --no-cache iputils

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev --silent

COPY . .

# Datenbank-Verzeichnis für das Volume vorbereiten
RUN mkdir -p /app/data

ENV NODE_ENV=production
ENV DB_PATH=/app/data/netwatch.db

EXPOSE 3000 3001

CMD ["node", "server.js"]
