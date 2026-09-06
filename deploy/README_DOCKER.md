# OneAPIChat 全栈一体化 Docker 移植与部署指南

本文档介绍如何将 **OneAPIChat 及其所有子项目（云盘 Cloudreve、超星刷课 Chaoxing、大模型代理 CPA 等）** 完全打包为自包含、开箱即用、任意机器可移植的 Docker 镜像，并支持灵活的域名绑定与严格的权限自愈。

---

## 🏗️ 架构全景

本镜像采用 **All-in-One 一体化自包含架构**，通过内部 Supervisor 统一托管并联动 5 大核心服务：

```text
               ┌────────────────────────────────────────────────────────┐
               │              宿主机 / 反向代理 (可选 SSL)                │
               └───────────────────────────┬────────────────────────────┘
                                           │ :8080 (或 :80)
                                           ▼
┌────────────────────────────────── Docker 容器 ──────────────────────────────────┐
│                                                                                │
│   ┌────────────────────────────────────────────────────────────────────────┐   │
│   │                      Nginx 统一反代与动静网关                           │   │
│   │  - 静态资源托管 & 动静分离                                             │   │
│   │  - 全局自适应 CORS 与 WebSocket / SSE 长连接透传                       │   │
│   │  - 自动域名识别 / 端口自适应                                           │   │
│   └──────┬──────────────┬──────────────┬──────────────┬────────────────────┘   │
│          │              │              │              │                        │
│          │ /oneapichat/ │ /engine/     │ /cloudreve/  │ /cpa/ & /v0/           │
│          ▼              ▼              ▼              ▼                        │
│     PHP 8.2-FPM    FastAPI Engine   Cloudreve       CLIProxyAPI (CPA)         │
│     (认证/会话API) (流式对话/Agent) (云盘v4/Aria2)  (模型中继/面板)          │
│     unix socket     :8766          :5212          :8317                        │
│          │              │              │              │                        │
│          └──────┬───────┴──────────────┴──────────────┘                        │
│                 ▼                                                              │
│     [ Supervisor 守护进程 + Permissions Healer 权限看门狗 ]                    │
│     (持续监控进程健康，每 60 秒自愈学习记录 SQLite 与 Cookies 读写权限)        │
└────────────────────────────────────────────────────────────────────────────────┘
```

---

## 🚀 快速开始

### 1. 本地一键构建镜像
进入项目 `deploy` 目录并执行构建脚本：
```bash
cd /var/www/html/oneapichat/deploy
./build.sh
```
构建完成后将生成名为 `oneapichat:latest` 的 Docker 镜像。

---

### 2. 导出为任意机器可移植的离线压缩包
执行导出脚本：
```bash
./export.sh
```
脚本将自动在 `deploy/dist/` 目录下打包输出：
`oneapichat-bundle-YYYYMMDD_HHMMSS.tar.gz`
该归档包内完整包含：
- 完整包含所有子项目的 Docker 镜像层（`image.tar.gz`）
- `docker-compose.yml` 与 `.env.example` 部署配置
- `import.sh` 一键在新机器导入和拉起脚本
- 部署说明文档

---

### 3. 在目标新服务器上一键导入与启动
将打包生成的 `tar.gz` 复制到任意目标服务器（Linux x86_64 / ARM64 支持 Docker 的环境）：

```bash
# 解压部署包
tar -xzf oneapichat-bundle-*.tar.gz
cd oneapichat-bundle-*

# 一键导入并启动服务
./import.sh
```

启动完成后，即可立即通过浏览器访问：
- **OneAPIChat 主站**: `http://<服务器IP或域名>:8080/`
- **超星刷课平台**: `http://<服务器IP或域名>:8080/oneapichat/chaoxing.html`
- **Cloudreve 云盘**: `http://<服务器IP或域名>:8080/cloudreve/`（或直接访问 `:5212`）
- **CPA 代理管理面板**: `http://<服务器IP或域名>:8080/cpa/`（或直接访问 `:8317/management.html`）
- **CPA OpenAI 接口**: `http://<服务器IP或域名>:8080/v0/v1/chat/completions`

---

## 🌐 域名绑定与反向代理配置指南

### 方案 A：单域名接入（推荐，最简便）
如果您拥有一个域名（如 `chat.example.com`），希望在此域名下一个入口访问所有子功能：

1. **修改 `.env` 文件**：
   ```ini
   PORT=8080
   DOMAIN=chat.example.com
   SSL_ENABLED=true
   ```
2. **外部宿主机反代（Nginx 示例配置）**：
   ```nginx
   server {
       listen 80;
       server_name chat.example.com;
       return 301 https://$host$request_uri;
   }

   server {
       listen 443 ssl http2;
       server_name chat.example.com;

       ssl_certificate     /etc/letsencrypt/live/chat.example.com/fullchain.pem;
       ssl_certificate_key /etc/letsencrypt/live/chat.example.com/privkey.pem;

       client_max_body_size 4096M;

       location / {
           proxy_pass http://127.0.0.1:8080;
           proxy_set_header Host $http_host;
           proxy_set_header X-Real-IP $remote_addr;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_set_header X-Forwarded-Proto $scheme;

           # 支持 WebSocket 与 SSE 流式输出
           proxy_http_version 1.1;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection "upgrade";
           proxy_buffering off;
           proxy_read_timeout 7200s;
           proxy_send_timeout 7200s;
       }
   }
   ```

---

### 方案 B：多域名独立绑定（云盘独立二级域名）
若希望云盘使用独立子域名 `pan.example.com`，主站使用 `chat.example.com`：

1. **修改 `.env` 文件**：
   ```ini
   DOMAIN=chat.example.com
   CLOUDREVE_SITE_URL=https://pan.example.com
   SSL_ENABLED=true
   ```
2. **外部 Nginx 分别反代两个域名**：
   ```nginx
   # 主站
   server {
       listen 443 ssl http2;
       server_name chat.example.com;
       location / {
           proxy_pass http://127.0.0.1:8080;
           proxy_set_header Host $http_host;
           proxy_http_version 1.1;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection "upgrade";
       }
   }

   # 云盘独立域名 (直接指向容器的 5212 或 8080/cloudreve/)
   server {
       listen 443 ssl http2;
       server_name pan.example.com;
       client_max_body_size 4096M;
       location / {
           proxy_pass http://127.0.0.1:5212;
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
           proxy_set_header X-Forwarded-Proto $scheme;
           proxy_http_version 1.1;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection "upgrade";
           proxy_read_timeout 86400s;
       }
   }
   ```

---

## 🔒 权限控制与各级自愈机制

为了根除 Linux 宿主机上常见的 **UID/GID 互锁（如普通开发用户与 www-data 用户抢占写权限）** 以及 `Permission denied: cookies_u_*.pkl`、`learning_records.db is locked` 等问题，本容器采用了三重自愈防御：

1. **容器入口（`entrypoint.sh`）启动自愈**：
   - 启动时自动将挂载的持久卷全部递归赋予 `www-data:www-data` 所有权。
   - 所有存储目录设置 `2775`（启用 SGID），使得后续任何进程创建的新文件均自动继承组所有权。
   - 容器入口设置 `umask 0002`，保障文件同组完全读写。
2. **代码层原子写入与属主接管**：
   - 超星刷课 Cookies 写入采用 `mkstemp` + `os.replace` 原子替换，彻底穿透原有只读权限并完成属主接管。
3. **后台权限看门狗守护（`perms-healer.sh`）**：
   - 由 Supervisor 以 root 用户独立常驻运行。
   - 每 60 秒轮询保障 `learning_records.db*`、`users/chaoxing/`、`chat_data/` 的 `664`/`2775` 权限，杜绝外部宿主机挂载污染。

---

## 📦 数据持久化挂载结构

在宿主机的 `./data` 目录中，数据结构如下：
- `data/users/`: 用户账户密码与权限 JSON
- `data/chat_data/`: 聊天历史会话与消息
- `data/uploads/`: 聊天中用户上传的所有文件与图片
- `data/cloudreve/`: Cloudreve 的 `cloudreve.db` 数据库与配置文件
- `data/cloudreve_uploads/`: 云盘用户上传的文件内容
- `data/cpa_auths/`: CPA 代理的 API Token 与第三方授权凭证
- `data/automatic_cb/`: 超星刷课日志与临时任务配置
- `data/logs/`: Nginx、PHP-FPM、Engine、Cloudreve 的聚合日志

移植到新机器时，只需保留或复制整个 `data/` 目录，即可完整保留所有会话、网盘文件、代理凭据和用户数据！
