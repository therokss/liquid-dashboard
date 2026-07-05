ARG BUILD_FROM=ghcr.io/hassio-addons/base:15.0.1
FROM $BUILD_FROM

# Installa Node.js e nginx
RUN apk add --no-cache nodejs npm nginx

WORKDIR /app

# Installa dipendenze server
COPY package.json ./
RUN npm install --omit=dev

# Copia server e app
COPY server.js ./
COPY www/ ./www/

# Configura nginx come reverse proxy (opzionale, usiamo solo node)
EXPOSE 8099

CMD ["node", "server.js"]
