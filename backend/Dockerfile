# ── GOLIAT Backend — Dockerfile ──────────────────────
FROM node:22-alpine

# Timezone Afrique/Douala pour que le cron soit correct
ENV TZ=Africa/Douala

WORKDIR /app

# Copie les dépendances en premier (cache layer)
COPY package*.json ./
RUN npm ci --omit=dev

# Copie le reste du code
COPY . .

# Crée les dossiers persistants (montés comme volumes sur Vultr)
RUN mkdir -p cache/data db/data logs

EXPOSE 3001

CMD ["node", "server.js"]
