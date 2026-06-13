# claude-wrapper

`claude -p`（ヘッドレスモード）互換の CLI ラッパー。内部ではサブスク課金対象の**対話モード** Claude Code を PTY 上で起動して 1 往復だけ実行し、応答を `~/.claude/projects/` のセッション JSONL から厳密に抽出して `-p` 互換の出力・終了コードを返す。

2026-06-15 以降、`claude -p` がサブスク課金の対象外（API 従量課金）になることへの対策。

## セットアップ

```bash
npm install
```

mac / Windows 両対応（node-pty: forkpty / ConPTY）。Node.js >= 18。

### 1 コマンドで実行する

開発チェックアウトをそのまま `claude-wrapper` コマンドとして使う場合は、リポジトリ直下で一度だけ:

```bash
npm link
```

以後は `node bin/claude-wrapper.js ...` ではなく、どこからでも次のように実行できる。

```bash
claude-wrapper -p --model sonnet "hello"
```

### 既存システムからの差し替え

どちらかの方法で:

```bash
# 1) コマンドを直接置き換え
claude-wrapper -p "..."

# 2) PATH の先頭に `claude` として置く（-p なしの起動はそのまま実体 claude へ透過）
ln -s /path/to/claude-wrapper/bin/claude-wrapper.js ~/bin/claude
```

実体 claude の解決は PATH 検索（自分自身は除外）。`claude` として差し替える場合など、実体を明示したい場合は環境変数 `CLAUDE_WRAPPER_REAL_CLAUDE` を設定。

```bash
export CLAUDE_WRAPPER_REAL_CLAUDE=/path/to/real/claude
```

## 使い方

```bash
claude-wrapper -p "プロンプト"
claude-wrapper -p --output-format json "プロンプト"
claude-wrapper -p --output-format stream-json "プロンプト"
echo "プロンプト" | claude-wrapper -p
claude-wrapper -p --resume <session-id> "続きの質問"   # ID 必須
```

`--model` / `--allowedTools` / `--append-system-prompt` / `--mcp-config` / `--session-id` / `--continue` などのフラグはそのまま本体へパススルーされる。

### 非サポート（exit 1 で reject）

`--input-format stream-json`, `--replay-user-messages`, `--include-partial-messages`,
`--include-hook-events`, `--no-session-persistence`, `--fallback-model`,
`--max-budget-usd`, `--json-schema`, `--fork-session`

### 環境変数

| 変数 | 既定値 | 説明 |
|---|---|---|
| `CLAUDE_WRAPPER_REAL_CLAUDE` | (PATH 検索) | 実体 claude のパス |
| `CLAUDE_WRAPPER_TIMEOUT_MS` | 600000 | 1 往復のタイムアウト |

## 仕組み

1. `--session-id` を採番して対話モード claude を PTY 起動（`--permission-mode dontAsk` を注入し `-p` の自動 deny を再現）
2. プロンプト UI 検知後、bracketed paste でプロンプト注入
3. Stop hook（`--settings` で注入、センチネルファイル書込）+ JSONL 静止判定でターン完了を検知
4. `~/.claude/projects/<cwd-slug>/<session-id>.jsonl` から text / json / stream-json を再構成して出力

詳細は [docs/design.md](docs/design.md) を参照。

## テスト

```bash
npm test          # unit テスト
```
