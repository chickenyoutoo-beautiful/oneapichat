# OneAPIChat

**マルチモデルAIチャットプラットフォーム（Agentモード対応）**

🚀 **オンライン Demo**: https://naujtrats.xyz/oneapichat

---

🌐 **Language / 语言 / 言語**: [English](./README.md) | [中文](./README.zh-CN.md) | [日本語](./README.ja-JP.md)

MiniMax、DeepSeekなど複数のモデルに接続できる自己ホスト型AIチャットプラットフォーム。Agentモードによる自律的なツール呼び出し、ウェブ検索、SSEストリーミング、多ユーザーサポートを備えています。

---

## 🌟 機能

### 🤖 マルチモデルサポート
- OpenAI API互換の任意のエンドポイントに接続可能
- **MiniMax**、**DeepSeek** などの的内蔵サポート
- モデルルーティングとフォールバック
- モデルごとのカスタムAPI Base URLとKey設定

### 🧠 Agentモード
- 自律的なサブAgentの生成与管理
- ツール呼び出し：ウェブ検索、コード実行、ファイル操作
- 永続化Agent状態と通知システム
- 内蔵ハートビート/Cronエンジンによるバックグラウンドタスク調整

### 🔍 ウェブ検索
- AIが自動的にウェブ検索が必要かどうかを判断
- 複数検索エンジン：DuckDuckGo、Brave Search、Google カスタム検索
- 検索タイプ：ウェブ、画像
- `/search`、`/image` コマンドで強制検索

### 📡 バックエンドSSEストリーミング
- Pythonエンジン（`engine_server.py`）がポート **8766** でSSEストリームを処理
- PHPプロキシ（`engine_api.php`）がフロントエンドとバックエンドをbridges
- リアルタイムのトークン単位打字機效果

### 👥 マルチユーザー・マルチターミナル
- PHPセッション認証
- ユーザーごとのSQLiteチャット履歴保存
- チャット履歴のインポート/エクスポート（JSON形式）

### 🎨 UI機能
- ダーク/ライトモード切替
- レスポンシブデザイン（デスクトップ＋モバイル対応）
- Markdownレンダリング＋コード構文ハイライト
- ファイルアップロード（テキスト、Office文書、画像など）
- 会話管理（名前変更、削除、エクスポート）

---

## 🏗️ アーキテクチャ

```
┌─────────────────────────────────────────────┐
│  フロントエンド  (index.html + JS/CSS)      │
│  シングルページアプリ、ビルド不要             │
└──────────────┬──────────────────────────────┘
               │ HTTP / SSE
┌──────────────▼──────────────────────────────┐
│  PHPプロキシ  (engine_api.php)               │
│  フロントエンド↔バックエンドをbridges、CORS  │
│  ポート：標準HTTP (80/443)                   │
└──────────────┬──────────────────────────────┘
               │ HTTP / SSE
┌──────────────▼──────────────────────────────┐
│  Pythonエンジン  (engine_server.py)          │
│  SSEストリーミング、Agentロジック、ツール呼び│
│  ポート：8766（ENGINE_PORTで変更可能）       │
└─────────────────────────────────────────────┘
```

### 主要ファイル

| ファイル | 役割 |
|----------|------|
| `index.html` | フロントエンドSPAメインエントリ |
| `engine_server.py` | Pythonバックエンド — SSE、Agentエンジン、心跳/Cron |
| `engine_api.php` | PHPプロキシ — 認証、ルーティング |
| `engine_watchdog.sh` | ウォッチドッグ — エンジン自動再起動 |
| `config.php` | API Keyとエンドポイント設定 |

---

## 🚀 クイックスタート

### 1. クローン

```bash
git clone <リポジトリURL> oneapichat
cd oneapichat
```

### 2. 依存関係のインストール

**Pythonバックエンド：**

```bash
pip install fastapi uvicorn openai httpx sse-starlette python-dotenv requests
```

**PHPプロキシ（Webサーバー側）：**

```bash
# PHP 8+と拡張機能をインストール
# Ubuntu/Debian: sudo apt install php php-curl php-sqlite3 php-mbstring
```

### 3. 設定と実行

```bash
# config.phpにAPI Keyを設定
# ENGINE_PORT=8766 python3 engine_server.py
```

**またはデプロイスクリプトを使用：**

```bash
chmod +x deploy.sh
./deploy.sh
```

### 4. ブラウザで開く

```
http://your-server/
```

---

## 🌐 対応OS

| プラットフォーム | 対応状況 | 備考 |
|------------------|---------|------|
| **Linux** | ✅ 完全対応 | systemdサービス＋ウォッチドッグ |
| **macOS** | ✅ 完全対応 | 手動実行またはlaunchd |
| **Windows / WSL** | ✅ 対応 | WSL2またはGit Bash推奨 |
| **Windows (ネイティブ)** | ⚠️ 一部対応 | PHPプロキシは動作；エンジン側はWSL推奨 |

---

## ⚙️ 設定方法

### API Key設定

`config.php`を編集：

```php
<?php
$config = [
    'minimax_api_key' => 'your-minimax-key',
    'deepseek_api_key' => 'your-deepseek-key',
    'default_model' => 'MiniMax/...',
    'custom_endpoints' => [
        'my-model' => 'https://my-custom-api.example.com/v1',
    ],
];
```

### 環境変数

```bash
ENGINE_PORT=8766       # engine_server.pyのポート
ENGINE_HOST=0.0.0.0    # バインドアドレス
LOG_LEVEL=INFO         # ログレベル
```

### 対応モデル

- **MiniMax** — `MiniMax/...`
- **DeepSeek** — `DeepSeek/...`
- **OpenAI** — `gpt-4o`、`gpt-4o-mini` など
- **Anthropic** — `claude-3-5-sonnet` など（カスタムエンドポイント経由）
- **任意のOpenAI互換API** — カスタムbase URLを設定

---

## 📂 プロジェクト構造

```
oneapichat/
├── index.html              # フロントエンドSPA
├── login.html              # ログインページ
├── profile.html            # ユーザープロファイルページ
├── chat.php                # チャット履歴ページ
├── engine_api.php          # PHPプロキシ
├── engine_server.py        # Python SSE + Agentエンジン
├── engine_watchdog.sh      # ウォッチドッグ
├── config.php              # API Key・設定
├── auth.php                # 認証ロジック
├── css/
│   ├── style.css           # メインスタイル
│   └── tailwind.css        # Tailwindユーティリティ
├── js/
│   └── main.js             # フロントエンドロジック
├── chat_data/              # SQLiteチャット履歴
├── users/                  # ユーザーアカウント
├── uploads/                # アップロードファイル
├── docs/                   # ドキュメント
└── deploy.sh               # デプロイスクリプト
```

---

## 🔐 セキュリティ注意

- **`config.php`をバージョン管理にコミットしない**
- API Keyはバックエンドでのみ使用。PHPプロキシはKeyをフロントエンドに開示しない
- エンジンはデフォルトでlocalhostにバインド。PHPプロキシ経由でのみ露出させる
- 本番環境ではHTTPSを使用推奨（Let's Encrypt / certbot）

---

## 📄 ライセンス

GPL-3.0 License

---

## 🔗 リンク

- **GitHubリポジトリ:** `https://github.com/<your-username>/oneapichat`
- **Issues:** `https://github.com/<your-username>/oneapichat/issues`
