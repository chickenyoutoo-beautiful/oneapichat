# OneAPIChat

**セルフホスト AI チャットプラットフォーム — マルチモデル · Agent モード · SSE ストリーミング · 試験自動化**

🚀 **デモ**: [naujtrats.xyz/oneapichat](https://naujtrats.xyz/oneapichat)

---

🌐 **言語**: [English](./README.md) | [中文](./README.zh-CN.md) | [日本語](./README.ja-JP.md)

---

OpenAI 互換 API に接続可能なモダンなセルフホスト AI チャットインターフェース。自律 Agent モード（動的ツール登録）、リアルタイム SSE ストリーミング、ウェブ検索、Chaoxing 試験自動化、マルチユーザー対応。クリーンでレスポンシブな UI を備えています。

| 🧠 **マルチモデル** | 🤖 **Agent モード** | 🔍 **ウェブ検索** | 📡 **SSE** | 📝 **試験モジュール** |
|---------------------|-------------------|-------------------|------------|------------------------|
| MiniMax, DeepSeek, OpenAI + 互換 API | 自律Agent + 動的ツール | Brave, Google, Tavily | トークン単位出力 | Chaoxing 試験選択実行 |

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
Agent モードを有効にすると、AI が自律的にタスクを実行 — サブ Agent の生成、ウェブ検索、コード実行、ファイル操作が可能。**v3.0 で動的ツール登録を追加** — ツールパネルは JS によって自動レンダリングされ、新しいツールの追加に HTML 編集は不要です。試験自動化ツール（一覧、開始、監視、停止）、コース概要、ログイン状態検出などを新搭載。永続化された Agent 状態、通知システム、Cron スケジューリングを搭載。

### 🔍 スマートウェブ検索
AI が自動的にウェブ検索の必要性を判断。**Brave Search**、**Google Custom Search**、**Tavily** に対応。検索結果は自動整理され要約されます。

### 📝 Chaoxing 試験自動化
v3.0 で新規追加：完全な試験ライフサイクル管理。**選択的試験開始** — 特定の試験を選択して実行、一斉開始ではありません。**自動学習一時停止**で不正検出を回避。**開始/終了時刻表示**。**独立ログシステム** — 試験と学習のログは完全に分離。試験終了後は自動的に学習を再開します。

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

OneAPIChat には **Chaoxing（超星/学習通）コース自動化** の Web インターフェースが含まれています。

### 学習機能（刷課）
- コース進捗状況の確認
- 自動受講の開始/停止
- 再生速度の設定
- オプションのデータベース統合
- ユーザーごとの追跡と統計

### 試験機能（考試） — v3.0 新規
- **選択的試験開始** — 実行する試験を個別選択
- **開始/終了時刻表示** — 各試験の時間を表示
- **自動学習一時停止** — 試験開始時に学習を一時停止し不正検出を回避
- **自動学習再開** — 試験終了後に再開
- **独立ログ** — 試験と学習のログを完全分離
- **ツールエンジン統合** — AI Agent が使用する5つの試験ツールを登録
- **ログイン状態検出** — AI が認証情報を要求する前にログイン状態を確認

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
