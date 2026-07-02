# Coolify deploy — Node Express serve static + cron interno (refresh hora em hora)
# + endpoint /api/trigger-refresh pro botão Atualizar.
# Toda a lógica fetch/build roda DENTRO do container — não depende mais do
# GH Actions schedule (que era unreliable).

FROM node:20-alpine
WORKDIR /app

# Deps de runtime (express + node-cron + xlsx + esbuild pra build interno)
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force

# Static frontend
COPY index.html styles.css ./
COPY data.js app.bundle.js data-extras.js ./
COPY assets ./assets

# Servidor + scripts de refresh (fetch CA API → build canonical → build extras)
COPY server.cjs ./
COPY fetch-data.cjs ./
COPY build-data.cjs ./
COPY build-data-extras.cjs ./
COPY bi.config.js ./
COPY adapters ./adapters
COPY lib ./lib

# Reports IA pré-rodados (anual 2026 + 12 mensais + YTD default)
COPY report.json ./
COPY report-2026.json ./
COPY report-2026-01.json ./
COPY report-2026-02.json ./
COPY report-2026-03.json ./
COPY report-2026-04.json ./
COPY report-2026-05.json ./
COPY report-2026-06.json ./
COPY report-2026-07.json ./
COPY report-2026-08.json ./
COPY report-2026-09.json ./
COPY report-2026-10.json ./
COPY report-2026-11.json ./
COPY report-2026-12.json ./

EXPOSE 80
CMD ["node", "server.cjs"]
