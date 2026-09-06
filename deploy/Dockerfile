# ==============================================================================
# OneAPIChat All-in-One Dockerfile
# 包含: OneAPIChat(Web/PHP) + Python Engine + Chaoxing(刷课) + Cloudreve(云盘) + CPA(代理)
# ==============================================================================

# ---------- Stage 1: Cloudreve 二进制 ----------
FROM cloudreve/cloudreve:latest AS cloudreve-bin

# ---------- Stage 2: CLIProxyAPI (CPA) 二进制与静态资源 ----------
FROM eceasy/cli-proxy-api:latest AS cpa-bin

# ---------- Stage 3: Python 运行依赖构建 ----------
FROM python:3.11-slim AS python-builder
WORKDIR /app
RUN (sed -i 's@deb.debian.org@mirrors.aliyun.com@g' /etc/apt/sources.list.d/debian.sources 2>/dev/null || sed -i 's@deb.debian.org@mirrors.aliyun.com@g' /etc/apt/sources.list 2>/dev/null || true) \
    && apt-get update && apt-get install -y --no-install-recommends gcc g++ libxml2-dev libxslt-dev \
    && rm -rf /var/lib/apt/lists/*
RUN pip install --prefix=/install --no-cache-dir \
    -i https://mirrors.aliyun.com/pypi/simple/ --extra-index-url https://pypi.org/simple \
    --trusted-host mirrors.aliyun.com \
    requests aiofiles python-multipart aiohttp beautifulsoup4 loguru pyaes urllib3 \
    pydantic pydantic-settings fastapi "uvicorn[standard]" fonttools lxml pycryptodome cryptography

# ---------- Stage 4: 生产主镜像 ----------
FROM debian:bookworm-slim

LABEL maintainer="OneAPIChat"
LABEL description="OneAPIChat All-in-One Multi-Model AI Chat & Automation Platform"

ENV DEBIAN_FRONTEND=noninteractive \
    TZ=Asia/Shanghai \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH="/usr/local/lib/python3.11/site-packages" \
    PATH="/usr/local/bin:$PATH"

# 1. 安装基础依赖与 PHP8.2 / Nginx / Supervisor / Python3
RUN (sed -i 's@deb.debian.org@mirrors.aliyun.com@g' /etc/apt/sources.list.d/debian.sources 2>/dev/null || sed -i 's@deb.debian.org@mirrors.aliyun.com@g' /etc/apt/sources.list 2>/dev/null || true) \
    && apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    wget \
    gnupg2 \
    procps \
    openssl \
    sqlite3 \
    nginx \
    supervisor \
    python3 \
    python3-minimal \
    python3-numpy \
    python3-pandas \
    libxml2 \
    libxslt1.1 \
    php-fpm \
    php-cli \
    php-curl \
    php-mbstring \
    php-xml \
    php-zip \
    php-sqlite3 \
    php-gd \
    php-bcmath \
    php-intl \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get clean

# 2. 从 Stage 复制预编译 Python 依赖库
COPY --from=python-builder /install /usr/local
RUN mkdir -p /usr/local/lib/python3.11/dist-packages \
    && echo "/usr/local/lib/python3.11/site-packages" > /usr/local/lib/python3.11/dist-packages/site-packages.pth

# 3. 从官方镜像复制 Cloudreve 与 CPA 二进制程序
COPY --from=cloudreve-bin /cloudreve/cloudreve /usr/local/bin/cloudreve
COPY --from=cpa-bin /CLIProxyAPI/CLIProxyAPI /usr/local/bin/CLIProxyAPI
RUN mkdir -p /var/www/cpa/static /etc/cpa /etc/cloudreve
COPY deploy/docker/cpa-static/ /var/www/cpa/static/
RUN chmod +x /usr/local/bin/cloudreve /usr/local/bin/CLIProxyAPI

# 4. 创建系统必须目录与持久化骨架
RUN mkdir -p \
    /var/www/html/oneapichat \
    /var/www/cloudreve/data \
    /var/www/cloudreve/uploads \
    /var/www/cloudreve/avatar \
    /var/www/cpa/auths \
    /var/www/cpa/logs \
    /tmp/AutomaticCB \
    /tmp/pylib \
    /run/php \
    /var/log/supervisor \
    /var/log/nginx \
    /var/log/php

# 5. 复制 OneAPIChat 应用代码
COPY --chown=www-data:www-data . /var/www/html/oneapichat/

# 创建根目录指向与快捷兼容链接
RUN ln -sf /var/www/html/oneapichat/public/index.html /var/www/html/index.html 2>/dev/null || true

# 6. 复制子项目默认配置模板与脚本
COPY deploy/docker/cloudreve-conf.ini /etc/cloudreve/cloudreve-conf.ini
COPY deploy/docker/cpa-config.yaml /etc/cpa/cpa-config.yaml
COPY deploy/docker/perms-healer.sh /usr/local/bin/perms-healer.sh
COPY deploy/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/perms-healer.sh /usr/local/bin/entrypoint.sh

# 7. 配置 Nginx 与 PHP-FPM
COPY deploy/docker/nginx-site.conf /etc/nginx/sites-available/default
RUN ln -sf /etc/nginx/sites-available/default /etc/nginx/sites-enabled/default \
    # 统一 PHP-FPM socket 路径
    && sed -i 's|listen = /run/php/php8.2-fpm.sock|listen = /run/php/php-fpm.sock|' /etc/php/8.2/fpm/pool.d/www.conf \
    && sed -i 's|;listen.owner = www-data|listen.owner = www-data|' /etc/php/8.2/fpm/pool.d/www.conf \
    && sed -i 's|;listen.group = www-data|listen.group = www-data|' /etc/php/8.2/fpm/pool.d/www.conf \
    && sed -i 's|;listen.mode = 0660|listen.mode = 0660|' /etc/php/8.2/fpm/pool.d/www.conf \
    && sed -i 's|upload_max_filesize = .*|upload_max_filesize = 4096M|' /etc/php/8.2/fpm/php.ini \
    && sed -i 's|post_max_size = .*|post_max_size = 4096M|' /etc/php/8.2/fpm/php.ini \
    && sed -i 's|max_execution_time = .*|max_execution_time = 1200|' /etc/php/8.2/fpm/php.ini \
    && sed -i 's|memory_limit = .*|memory_limit = 1024M|' /etc/php/8.2/fpm/php.ini

# 8. 复制 Supervisor 进程托管配置
COPY deploy/docker/supervisord.conf /etc/supervisor/supervisord.conf

# 9. 赋权与初检
RUN chown -R www-data:www-data /var/www /tmp/AutomaticCB /tmp/pylib /run/php \
    && chmod -R 775 /var/www/html/oneapichat/users /var/www/html/oneapichat/chat_data /tmp/AutomaticCB 2>/dev/null || true

# 暴露端口: 80(主 Web 端口), 8080(兼容端口), 5212(Cloudreve), 8317(CPA 代理)
EXPOSE 80 8080 5212 8317 8766

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD curl -sf http://127.0.0.1:8080/ || curl -sf http://127.0.0.1:80/ || exit 1

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
