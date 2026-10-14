ARG BUILD_FROM=ghcr.io/hassio-addons/base:21.0.8
FROM ${BUILD_FROM}

# Solo il runtime: server e interfaccia arrivano già compilati dal repo (assistant/ → app/, www/)
RUN apk add --no-cache nodejs

WORKDIR /app
COPY app/ ./app/
COPY www/ ./www/

EXPOSE 8099

CMD ["node", "/app/app/server.mjs"]
