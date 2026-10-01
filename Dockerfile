# The Prem team server as a container image.
#
#   docker run --rm -it -v /srv/prem:/data ghcr.io/cameronjtoy/prem-server \
#     init --config /data/prem-server.json --vault /data/vault --host 0.0.0.0
#   docker run -d -p 127.0.0.1:4747:4747 -v /srv/prem:/data ghcr.io/cameronjtoy/prem-server
#
# /data holds prem-server.json and the vault, and must be writable by user ID 1000. See docs/lab-server.md.

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
