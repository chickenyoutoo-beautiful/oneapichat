# ========== OneAPIChat Dockerfile ==========
# Multi-stage build
# Supports: linux/amd64, linux/arm64

FROM python:3.11-slim AS builder
WORKDIR /app
RUN pip install --user --no-cache-dir fastapi uvicorn requests aiofiles python-multipart

# ========== Main image ==========
FROM debian:bookworm-slim

LABEL maintainer="chickenyoutoo-beautiful"
LABEL description="OneAPIChat - Multi-Model AI Chat Platform"

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl gnupg2 wget \
    && curl -sSL https://packages.sury.org/php/apt.gpg | gpg --dearmor -o /usr/share/keyrings/php-sury.gpg \
    && echo "deb [signed-by=/usr/share/keyrings/php-sury.gpg] https://packages.sury.org/php/ bookworm main" > /etc/apt/sources.list.d/php-sury.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
        php8.2 php8.2-fpm php8.2-curl php8.2-mbstring php8.2-xml php8.2-zip \
        nginx supervisor sqlite3 \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get clean

# Copy Python packages from builder
COPY --from=builder /root/.local /root/.local
ENV PATH=/root/.local/bin:$PATH

# Copy application files (excluding .dockerignore patterns)
COPY --chown=www-data:www-data . /var/www/html/

# Create required directories and set permissions
RUN mkdir -p /var/www/html/users /var/www/html/chat_data /tmp/AutomaticCB /tmp/pylib \
    && chown -R www-data:www-data /var/www/html \
    && chmod -R 755 /var/www/html \
    && chmod -R 777 /var/www/html/users /var/www/html/chat_data /tmp/AutomaticCB /tmp/pylib

# Configure nginx site
COPY docker/nginx-site.conf /etc/nginx/sites-available/default
RUN ln -sf /etc/nginx/sites-available/default /etc/nginx/sites-enabled/ \
    && rm -f /etc/nginx/sites-enabled/default 2>/dev/null; \
    echo "daemon off;" >> /etc/nginx/nginx.conf

# Copy supervisor config
COPY docker/supervisord.conf /etc/supervisor/conf.d/oneapichat.conf

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD curl -sf http://localhost:8080/ || exit 1

CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/supervisord.conf", "-n"]
