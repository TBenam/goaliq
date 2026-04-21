# ── GoalIQ Frontend — Dockerfile ─────────────────────
FROM nginx:alpine

# Copie les fichiers statiques de la PWA
COPY . /usr/share/nginx/html

# Config Nginx : SPA routing (toutes les routes → index.html)
RUN echo 'server { \
    listen 80; \
    root /usr/share/nginx/html; \
    index index.html; \
    location / { try_files $uri $uri/ /index.html; } \
    location ~* \.(js|css|png|svg|ico|webp|woff2|json)$ { \
        expires 30d; \
        add_header Cache-Control "public, immutable"; \
    } \
}' > /etc/nginx/conf.d/default.conf

EXPOSE 80
