# claude-wrapper

`claude -p`（ヘッドレスモード）互換の CLI ラッパー。

内部ではサブスク課金対象の**対話モード** Claude Code を PTY 上で起動して 1 往復だけ実行し、応答を `~/.claude/projects/` のセッション JSONL から抽出して `-p` 互換の出力・終了コードを返す

2026-06-15 以降、`claude -p` がサブスク課金の対象外（API 従量課金）になることへの対策。

## セットアップ

```bash
npm install
```

mac / Windows 両対応（node-pty: forkpty / ConPTY）。Node.js >= 18。


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

