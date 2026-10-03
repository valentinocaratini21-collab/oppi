# Oppi API — imagen de producción.
# Build: docker build -t oppi-api .
# Run:   docker run -p 3000:3000 --env-file .env -v oppi-data:/app/data oppi-api

# ---- deps (cacheable) ----
FROM node:24-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ---- producción ----
FROM node:24-slim AS prod
ENV NODE_ENV=production
WORKDIR /app

# Usuario no-root + carpeta de uploads con permisos.
RUN useradd -m -u 1001 oppi \
  && mkdir -p /app/data/uploads \
  && chown -R oppi:oppi /app

COPY --from=deps /app/node_modules ./node_modules
COPY src ./src
COPY package.json package-lock.json ./

USER oppi
EXPOSE 3000

# Persistí /app/data (SQLite + uploads locales) con un volumen o disco.
VOLUME ["/app/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "src/server.js"]
