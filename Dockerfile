# The Prem team server as a container image.
#
#   docker run -d -p 4747:4747 -v /srv/prem:/data ghcr.io/cameronjtoy/prem-server
#
# /data must hold prem-server.json (with "host": "0.0.0.0" and "vault": "/data/vault") and the vault.
# Create a token with: docker run --rm ghcr.io/cameronjtoy/prem-server token <name>

FROM node:22-alpine AS build
WORKDIR /src
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY . .
RUN npm run server:build

FROM node:22-alpine
LABEL org.opencontainers.image.title="Prem team server" \
      org.opencontainers.image.description="Hosts a Prem lab notebook vault for a team" \
      org.opencontainers.image.source="https://github.com/cameronjtoy/Prem" \
      org.opencontainers.image.licenses="Apache-2.0"
WORKDIR /app
# The server is a single file that only uses Node built-ins.
COPY --from=build /src/out/server/index.js ./prem-server.js
COPY LICENSE ./
USER node
VOLUME /data
EXPOSE 4747
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:4747/api/health || exit 1
ENTRYPOINT ["node", "/app/prem-server.js"]
CMD ["--config", "/data/prem-server.json"]
