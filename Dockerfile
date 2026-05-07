# ========== OneAPIChat Dockerfile ==========
# Multi-stage build for OneAPIChat
# Supports: linux/amd64, linux/arm64

FROM python:3.11-slim AS builder
WORKDIR /app
RUN pip install --user --no-cache-dir fastapi uvicorn requests pyaes beautifulsoup4 lxml loguru celery flask fonttools aiofiles python-multipart

# ========== Main image ==========
FROM debian:trixie-slim

LABEL maintainer="chickenyoutoo-beautiful"
LABEL description="OneAPIChat - Multi-Model AI Chat Platform with Agent Support"

# Install base tools + SURY PHP repo (for up-to-date PHP 8.x)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl gnupg2 wget \
    && curl -sSL https://packages.sury.org/php/apt.gpg | gpg --dearmor -o /usr/share/keyrings/php-sury.gpg \
    && echo "deb [signed-by=/usr/share/keyrings/php-sury.gpg] https://packages.sury.org/php/ trixie main" > /etc/apt/sources.list.d/php-sury.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
        php php-fpm php-curl php-mbstring php-xml php-zip \
        nginx sqlite3 \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get clean \
    && mkdir -p /run/php \
    && mkdir -p /var/www/html

# Copy Python packages from builder
COPY --from=builder /root/.local /root/.local
ENV PATH=/root/.local/bin:$PATH

# Copy application files
COPY --chown=www-data:www-data . /var/www/html/

# Create required directories and set permissions
RUN mkdir -p /var/www/html/users /var/www/html/chat_data /tmp/AutomaticCB /tmp/pylib \
    && chown -R www-data:www-data /var/www/html \
    && chmod -R 755 /var/www/html \
    && chmod -R 777 /var/www/html/users /var/www/html/chat_data /tmp/AutomaticCB /tmp/pylib

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD curl -sf http://localhost:8080/ || exit 1

# Entrypoint: start nginx + php-fpm + engine via supervisord
COPY <<EOF /etc/supervisor/conf.d/oneapichat.conf
[supervisord]
nodaemon=true
loglevel=info

[program:php-fpm]
command=php-fpm -F
autostart=true
autorestart=true
stdout_logfile=/dev/stdout
stderr_logfile=/dev/stderr

[program:engine]
command=python3 /var/www/html/engine_server.py
directory=/var/www/html
autostart=true
autorestart=true
stdout_logfile=/dev/stdout
stderr_logfile=/dev/stderr

[program:nginx-run]
command=nginx -g "daemon off;"
autostart=true
autorestart=true
stdout_logfile=/dev/stdout
stderr_logfile=/dev/stderr
EOF

CMD ["supervisord", "-c", "/etc/supervisor/conf.d/oneapichat.conf"]