# ── GoalIQ Frontend — Dockerfile ─────────────────────
FROM nginx:alpine

# Copie les fichiers statiques de la PWA
COPY . /usr/share/nginx/html

# Config Nginx : SPA routing + proxy API vers le backend
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
