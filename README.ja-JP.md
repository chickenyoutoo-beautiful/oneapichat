# OneAPIChat

**セルフホスト AI チャットプラットフォーム — マルチモデル · Agent モード · SSE ストリーミング**

🚀 **デモ**: [naujtrats.xyz/oneapichat](https://naujtrats.xyz/oneapichat)

---

🌐 **言語**: [English](./README.md) | [中文](./README.zh-CN.md) | [日本語](./README.ja-JP.md)

---

OpenAI 互換 API に接続可能なモダンなセルフホスト AI チャットインターフェース。自律 Agent モード（ツール呼び出し）、リアルタイム SSE ストリーミング、ウェブ検索、マルチユーザー対応。クリーンでレスポンシブな UI を備えています。

| 🧠 **マルチモデル** | 🔧 **Agent モード** | 🔍 **ウェブ検索** | 📡 **SSE ストリーミング** |
|---------------------|-------------------|-------------------|--------------------------|
| MiniMax, DeepSeek, OpenAI + 互換 API | 自律サブAgent + ツール呼び出し | Brave, Google, Tavily | トークン単位のリアルタイム出力 |

---

## 目次

- [機能概要](#-機能概要)
- [クイックスタート](#-クイックスタート)
- [デプロイ方法](#-デプロイ方法)
- [設定](#%EF%B8%8F-設定)
- [プロジェクト構造](#-プロジェクト構造)
- [刷課モジュール（Chaoxing自動化）](#-刷課モジュールchaoxing自動化)
- [ライセンス](#-ライセンス)

---

## 📸 機能概要

### 🤖 マルチモデル対応
OpenAI 互換の任意のエンドポイントに接続可能。**MiniMax**、**DeepSeek**、**OpenAI**、**Anthropic** などのモデルを内蔵サポート。モデルごとに API Base URL と Key を個別設定できます。モデルルーティングと自動フォールバックに対応。

### 🧠 Agent モード
Agent モードを有効にすると、AI が自律的にタスクを実行 — サブ Agent の生成、ウェブ検索、コード実行、ファイル操作が可能。永続化された Agent 状態、通知システム、Cron スケジューリングを搭載。

### 🔍 スマートウェブ検索
AI が自動的にウェブ検索の必要性を判断。**Brave Search**、**Google Custom Search**、**Tavily** に対応。検索結果は自動整理され要約されます。

### 📡 SSE リアルタイムストリーミング
Server-Sent Events によるトークン単位のストリーミング出力。ページをリフレッシュしても進行状況を復元可能。

### 👥 マルチユーザー・マルチデバイス
ユーザー分離と暗号化された API Key 保存。チャット履歴の JSON インポート/エクスポート、ユーザーごとの設定。デスクトップとモバイルの両方に対応。

### 🎨 クリーンな UI
ダーク/ライトモード切替、Markdown レンダリング + KaTeX 数式 + コードシンタックスハイライト、ファイルアップロード対応。

---

## 🚀 クイックスタート

### 必要環境
- **PHP 8.0+**（プロキシ層）
- **Python 3.10+**（バックエンドエンジン）
- OpenAI 互換の API Key

---

## ☁️ デプロイ方法

### ワンクリックスクリプト（Linux / macOS）

```bash
curl -fsSL https://raw.githubusercontent.com/chickenyoutoo-beautiful/oneapichat/main/deploy.sh | bash
```

OS（Ubuntu, Debian, CentOS, macOS）とインストール方式（Docker またはネイティブ）を自動検出します。

### Docker（任意のプラットフォーム）

```bash
# クイック起動
docker run -d -p 8080:8080 --name oneapichat \
  ghcr.io/chickenyoutoo-beautiful/oneapichat:latest

# または docker-compose を使用
curl -fsSL https://raw.githubusercontent.com/chickenyoutoo-beautiful/oneapichat/main/docker-compose.yml -o docker-compose.yml
docker compose up -d
```

`linux/amd64` と `linux/arm64` の両方をサポート。Raspberry Pi、Synology NAS、QNAP でも動作します。

### 手動セットアップ

```bash
# 1. リポジトリをクローン
git clone https://github.com/chickenyoutoo-beautiful/oneapichat.git
cd oneapichat

# 2. Python 依存関係をインストール
pip install fastapi uvicorn aiofiles python-multipart

# 3. バックエンドエンジンを起動
python3 engine_server.py &

# 4. PHP サーバーを起動
php -S localhost:8080
```

ブラウザで [http://localhost:8080](http://localhost:8080) を開きます。

---

## ⚙️ 設定

### API Key の追加
1. UI の設定パネルを開く
2. API Key と Base URL を入力
3. 使用するモデルを選択

### 環境変数

| 変数 | デフォルト | 説明 |
|------|-----------|------|
| `ENGINE_PORT` | `8766` | バックエンドエンジンのポート |
| `ENGINE_HOST` | `0.0.0.0` | エンジンのバインドアドレス |
| `LOG_LEVEL` | `INFO` | ログレベル |

### 対応モデル
- **MiniMax** — `MiniMax/xxx`
- **DeepSeek** — `DeepSeek/xxx`
- **OpenAI** — `gpt-4o`、`gpt-4o-mini` など
- **Anthropic** — カスタムエンドポイント経由で `claude-3-5-sonnet` など
- 任意の **OpenAI 互換 API** — カスタム Base URL を設定

---

## 📁 プロジェクト構造

```
.
├── index.html              # メインチャット UI（SPA）
├── login.html              # ログインページ
├── profile.html            # ユーザー設定ページ
├── main.js                 # フロントエンドロジック
├── css/
│   ├── style.css           # カスタムスタイル
│   └── tailwind-index.min.css
├── js/
│   ├── models.js           # モデル設定
│   └── translations.js     # 国際化文字列
├── engine_server.py        # Python バックエンド（FastAPI）
├── engine_api.php          # PHP プロキシ層
├── engine_watchdog.sh      # 自動再起動ウォッチドッグ
├── auth.php                # ユーザー認証
├── config.php              # API Key 設定
├── chat.php                # チャット履歴ビューア
├── deploy.sh               # クロスプラットフォームデプロイスクリプト
├── Dockerfile              # Docker イメージ
├── docker-compose.yml      # Docker Compose 設定
├── nginx.conf              # Nginx 設定
├── docs/                   # ドキュメント
├── LICENSE                 # AGPL-3.0
└── NOTICE                  # ライセンス詳細
```

---

## 📖 刷課モジュール（Chaoxing自動化）

*これはオプションのアドオン機能です — 本プラットフォームはこのモジュールなしでも完全に動作します。*

OneAPIChat には **Chaoxing（超星/学習通）コース自動化** の Web インターフェースが含まれています。独立したモジュールとして統合されており、以下の機能を提供します：

- コース進捗状況の確認
- 自動受講の開始/停止
- 再生速度の設定
- オプションのデータベース統合

デプロイ後、`/chaoxing.html` にアクセスして利用できます。

GitHub Actions を使用したクラウド実行については、`.github/workflows/` の設定を参照してください。

---

## 📄 ライセンス

| コンポーネント | ライセンス | 備考 |
|--------------|-----------|------|
| **OneAPIChat（メインプロジェクト）** | **AGPL-3.0** | [LICENSE](./LICENSE) |
| **刷課モジュール**（Chaoxing自動化） | **GPL-3.0** | [LICENSES/GPL-3.0.txt](./LICENSES/GPL-3.0.txt) — [Samueli924/chaoxing](https://github.com/Samueli924/chaoxing) 由来 |
| **One-API**（インターフェース管理依存） | **MIT** | [songquanpeng/one-api](https://github.com/songquanpeng/one-api) |

詳細は [`NOTICE`](./NOTICE) を参照してください。

---

## 🙏 謝辞

- [songquanpeng/one-api](https://github.com/songquanpeng/one-api) — API 管理ゲートウェイ
- [Samueli924/chaoxing](https://github.com/Samueli924/chaoxing) — Chaoxing 自動化エンジン（GPL-3.0）
- [KaTeX](https://katex.org/) — 数式レンダリング
- [Mermaid](https://mermaid.js.org/) — 図表レンダリング
- すべてのオープンソース貢献者
