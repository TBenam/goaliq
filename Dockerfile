# ── GoalIQ Frontend — Dockerfile ─────────────────────
FROM nginx:alpine

# Copie les fichiers statiques de la PWA
COPY . /usr/share/nginx/html

# Config Nginx : SPA routing + proxy API vers le backend
RUN printf 'server {\n\
    listen 80;\n\
    root /usr/share/nginx/html;\n\
    index index.html;\n\
\n\
    # Proxy toutes les requetes /api/ vers le backend Node.js\n\
    location /api/ {\n\
        proxy_pass http://api:3001;\n\
        proxy_http_version 1.1;\n\
        proxy_set_header Host $host;\n\
        proxy_set_header X-Real-IP $remote_addr;\n\
    }\n\
\n\
    # SPA routing : toutes les routes -> index.html\n\
    location / {\n\
        try_files $uri $uri/ /index.html;\n\
    }\n\
\n\
    # Cache long pour les assets statiques\n\
    location ~* \\.(js|css|png|svg|ico|webp|woff2|json)$ {\n\
        expires 30d;\n\
        add_header Cache-Control "public, immutable";\n\
    }\n\
}' > /etc/nginx/conf.d/default.conf

EXPOSE 80
