# Coolify deploy — Node Express serve static + refresh endpoint
FROM node:20-alpine
WORKDIR /app

# curl pra baixar XLSX do Supabase Storage
RUN apk add --no-cache curl

# Deps
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force

# Static frontend
COPY index.html styles.css ./
COPY data.js app.bundle.js data-extras.js dre-data.js ./
COPY assets ./assets

# Server + scripts de refresh
COPY server.cjs ./
COPY fetch-data.cjs ./
COPY build-data.cjs ./
COPY build-data-extras.cjs ./
COPY build-jsx.cjs build-dre.cjs ./
COPY bi.config.js ./
COPY adapters ./adapters
COPY lib ./lib

# Download XLSX do Supabase (roda no refresh)
COPY download-xlsx.sh ./
RUN chmod +x download-xlsx.sh

# AI reports (pré-gerados)
COPY report*.json ./

# JSX sources (pra rebuild do bundle)
COPY components.jsx pages-*.jsx upsell-pages.jsx ./

# Data JSONs (pra rebuild sem Drive)
COPY data ./data

# Workspace pra XLSX baixados do Supabase
RUN mkdir -p /app/workspace/bases

EXPOSE 80
ENV REFRESH_ON_START=true
ENV VICAL_BASES_DIR=/app/workspace/bases
ENV REFRESH_CRON="30 5 * * *"
CMD ["node", "server.cjs"]
