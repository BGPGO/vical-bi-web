# Coolify deploy — Node Express serve static + refresh endpoint
FROM node:20-alpine
WORKDIR /app

# Deps
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force

# Static frontend
COPY index.html styles.css ./
COPY data.js app.bundle.js data-extras.js ./
COPY assets ./assets

# Server + scripts de refresh
COPY server.cjs ./
COPY fetch-data.cjs ./
COPY build-data.cjs ./
COPY build-data-extras.cjs ./
COPY build-jsx.cjs ./
COPY bi.config.js ./
COPY adapters ./adapters
COPY lib ./lib

# JSX sources (pra rebuild do bundle)
COPY components.jsx pages-*.jsx upsell-pages.jsx ./

# Data JSONs (pra rebuild sem Drive)
COPY data ./data

EXPOSE 80
ENV REFRESH_ON_START=false
CMD ["node", "server.cjs"]
