#!/bin/bash
# ==============================================================================
# OneAPIChat Permissions Healer (权限看门狗)
# 自动守护与自愈各级权限，杜绝任何 Permission denied 死锁
# ==============================================================================

TARGET_DIRS=(
    "/var/www/html/oneapichat/users"
    "/var/www/html/oneapichat/chat_data"
    "/var/www/html/oneapichat/uploads"
    "/var/www/html/oneapichat/.engine"
    "/var/www/html/oneapichat/python/chaoxing"
    "/tmp/AutomaticCB"
    "/tmp/pylib"
    "/var/www/cloudreve/data"
    "/var/www/cpa/auths"
    "/var/www/cpa/logs"
)

heal_permissions() {
    # 1. 确保必要目录存在
    for dir in "${TARGET_DIRS[@]}"; do
        if [ ! -d "$dir" ]; then
            mkdir -p "$dir" 2>/dev/null || true
        fi
    done

    # 2. 统一属主为 www-data:www-data
    chown -R www-data:www-data \
        /var/www/html/oneapichat/users \
        /var/www/html/oneapichat/chat_data \
        /var/www/html/oneapichat/uploads \
        /var/www/html/oneapichat/.engine \
        /tmp/AutomaticCB \
        /tmp/pylib \
        /var/www/cloudreve/data \
        /var/www/cloudreve/uploads \
        /var/www/cloudreve/avatar \
        /var/www/cpa/auths \
        /var/www/cpa/logs \
        2>/dev/null || true

    # 3. 刷课学习记录 SQLite 数据库特殊保护 (WAL/SHM 锁文件必须读写权限)
    if [ -d "/var/www/html/oneapichat/python/chaoxing" ]; then
        chown -R www-data:www-data /var/www/html/oneapichat/python/chaoxing/learning_records.db* 2>/dev/null || true
        chmod 664 /var/www/html/oneapichat/python/chaoxing/learning_records.db* 2>/dev/null || true
        chmod 775 /var/www/html/oneapichat/python/chaoxing/ 2>/dev/null || true
    fi

    # 4. 超星用户 Cookies 权限固化 (防跨用户互锁)
    if [ -d "/var/www/html/oneapichat/users/chaoxing" ]; then
        chown -R www-data:www-data /var/www/html/oneapichat/users/chaoxing/ 2>/dev/null || true
        find /var/www/html/oneapichat/users/chaoxing/ -type d -exec chmod 2775 {} + 2>/dev/null || true
        find /var/www/html/oneapichat/users/chaoxing/ -type f -exec chmod 664 {} + 2>/dev/null || true
    fi

    # 5. 用户数据与上传附件目录权限
    chmod -R 775 /var/www/html/oneapichat/users /var/www/html/oneapichat/chat_data /var/www/html/oneapichat/uploads /tmp/AutomaticCB 2>/dev/null || true
}

# 首次立即执行
heal_permissions

# 持续守护循环 (每 60 秒自愈一次)
while true; do
    sleep 60
    heal_permissions
done
