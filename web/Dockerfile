# Yapp web: Astro SSR (HTTPS, self-signed local CA) + plain-HTTP cert landing page.
FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ENV ASTRO_TELEMETRY_DISABLED=1
RUN npm run build && npm prune --omit=dev

FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates tini && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production \
    DATA_DIR=/data \
    CERT_DIR=/data/certs \
    MIGRATIONS_DIR=/app/drizzle \
    PORT=8443 \
    HTTP_PORT=8080 \
    HOST=0.0.0.0
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./
COPY drizzle ./drizzle
COPY server ./server
COPY scripts ./scripts
COPY docker-entrypoint.sh ./
# uid 1000 ("node") so files on the ./data volume belong to the host user.
USER node
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "const h=(process.env.HOST||'').split(',').find(x=>x==='127.0.0.1')||(process.env.HOST||'').split(',')[0];fetch('http://'+(!h||h==='0.0.0.0'||h==='::'?'127.0.0.1':h)+':'+(process.env.HTTP_PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--", "./docker-entrypoint.sh"]
