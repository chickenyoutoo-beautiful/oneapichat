# ========== OneAPIChat Dockerfile ==========
# Multi-stage build for OneAPIChat
# Supports: Linux (amd64/arm64), with future Windows container compatibility

FROM python:3.11-slim AS builder

WORKDIR /app

# Install build dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY requirements.txt .
RUN pip install --user --no-cache-dir -r requirements.txt fastapi uvicorn

# ========== Base image ==========
FROM python:3.11-slim

LABEL maintainer="chickenyoutoo-beautiful"
LABEL description="OneAPIChat - Multi-Model AI Chat Platform with Agent Support"

# Install runtime dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    php8.3 \
    php8.3-fpm \
    php8.3-curl \
    php8.3-mbstring \
    php8.3-xml \
    php8.3-zip \
    nginx \
    curl \
    sqlite3 \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get clean \
    && mkdir -p /run/php

# Copy Python packages from builder
COPY --from=builder /root/.local /root/.local
ENV PATH=/root/.local/bin:$PATH

# Copy application
WORKDIR /var/www/html
COPY . .

# Create required directories
RUN mkdir -p /var/www/html/users /var/www/html/chat_data /tmp/AutomaticCB /tmp/pylib

# Set permissions
RUN chmod -R 755 /var/www/html \
    && chmod -R 777 /var/www/html/users /var/www/html/chat_data /tmp/AutomaticCB /tmp/pylib

# Expose port
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -sf http://localhost:8080/ || exit 1

# Start supervisor (manages nginx + php-fpm + engine)
CMD ["sh", "-c", "\
    echo '[supervisord]' > /etc/supervisor/conf.d/supervisord.conf && \
    echo 'nodaemon=true' >> /etc/supervisor/conf.d/supervisord.conf && \
    echo '' >> /etc/supervisor/conf.d/supervisord.conf && \
    echo '[program:php-fpm]' >> /etc/supervisor/conf.d/supervisord.conf && \
    echo 'command=php-fpm8.3 -F' >> /etc/supervisor/conf.d/supervisord.conf && \
    echo 'autostart=true' >> /etc/supervisor/conf.d/supervisord.conf && \
    echo 'autorestart=true' >> /etc/supervisor/conf.d/supervisord.conf && \
    echo '' >> /etc/supervisor/conf.d/supervisord.conf && \
    echo '[program:engine]' >> /etc/supervisor/conf.d/supervisord.conf && \
    echo 'command=python3 engine_server.py' >> /etc/supervisor/conf.d/supervisord.conf && \
    echo 'directory=/var/www/html' >> /etc/supervisor/conf.d/supervisord.conf && \
    echo 'autostart=true' >> /etc/supervisor/conf.d/supervisord.conf && \
    echo 'autorestart=true' >> /etc/supervisor/conf.d/supervisord.conf && \
    echo '' >> /etc/supervisor/conf.d/supervisord.conf && \
    echo '[program:nginx-run]' >> /etc/supervisor/conf.d/supervisord.conf && \
    echo 'command=nginx -g \"daemon off;\"' >> /etc/supervisor/conf.d/supervisord.conf && \
    echo 'autostart=true' >> /etc/supervisor/conf.d/supervisord.conf && \
    echo 'autorestart=true' >> /etc/supervisor/conf.d/supervisord.conf && \
    supervisord -c /etc/supervisor/conf.d/supervisord.conf"]