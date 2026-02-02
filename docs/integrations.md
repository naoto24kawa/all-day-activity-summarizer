# 外部サービス統合

ADAS は Slack、GitHub、Claude Code と連携して、日々のアクティビティを一元管理できます。

---

## GitHub 統合

GitHub CLI (`gh`) を使用して、自分に関連する Issue/PR/レビューリクエストを自動取得します。

### セットアップ

1. **GitHub CLI のインストールと認証**

```bash
# macOS
brew install gh

# Ubuntu/Debian
sudo apt install gh

# 認証
gh auth login
```

2. **設定の有効化**

`~/.adas/config.json` を編集:

```json
{
  "github": {
    "enabled": true,
    "username": "your-github-username",
    "fetchIntervalMinutes": 10,
    "parallelWorkers": 2
  }
}
```

| オプション | 説明 | 例 |
|-----------|------|-----|
| `enabled` | GitHub 統合を有効化 | `true` |
| `username` | 自分の GitHub ユーザー名 (タスク抽出時のフィルタリングに使用) | `"octocat"` |
| `fetchIntervalMinutes` | 取得間隔(分) | `10` |
| `parallelWorkers` | 並列ワーカー数 | `2` |

3. **サーバー起動**

```bash
bun run cli -- serve
```

起動時に `[GitHub] Authenticated as <username>` と表示されれば成功です。

### 取得されるデータ

| 種類 | 説明 |
|------|------|
| **Issues** | 自分にアサインされた Issue |
| **Pull Requests** | 自分にアサインされた PR |
| **Review Requests** | 自分にレビューリクエストされた PR |
| **Comments** | 上記の Issue/PR に付いたコメント・レビュー |

### ダッシュボード

Web UI の「GitHub」タブで、取得したデータを確認できます:
- Issues / PRs / Reviews / Comments のタブ切り替え
- 未読バッジ表示
- 既読管理(個別・一括)
- 外部リンクからGitHubへ直接アクセス

---

## Slack 統合

Slack のメンション・チャンネル・DM・キーワードを自動取得します(xoxc/xoxd トークン使用)。

### トークンの取得方法

#### xoxc / xoxd トークン

1. **Slack Web アプリを開く**
   - ブラウザで https://app.slack.com にアクセス
   - ワークスペースにログイン

2. **DevTools を開く**
   - Windows/Linux: `F12` または `Ctrl+Shift+I`
   - macOS: `Cmd+Option+I`

3. **Network タブでトークンを取得**
   - DevTools の「Network」タブを選択
   - 左上のフィルタに `api` と入力
   - ページを更新 (F5) して API リクエストを発生させる
   - 任意のリクエスト (例: `conversations.list`) をクリック
   - 「Headers」タブの「Request Headers」セクションから:
     - `Authorization: Bearer xoxc-...` → `xoxcToken` として使用
     - `Cookie` ヘッダー内の `d=xoxd-...;` → `xoxdToken` として使用

#### ユーザー ID (userId)

自分の投稿を除外するために必要です。

1. Slack アプリで自分のプロフィールを開く
2. 「その他」(…) ボタンをクリック
3. 「メンバー ID をコピー」を選択
4. `U` で始まる ID (例: `U059Z83SHRD`) が取得できる

#### チャンネル ID の取得

監視するチャンネルを指定する場合:

1. Slack でチャンネルを開く
2. チャンネル名をクリックして詳細を表示
3. 下部にある「チャンネル ID」をコピー (例: `C01234ABCDE`)

**注意:** トークンはブラウザセッションに紐づいているため、ログアウトすると無効になります。

### 設定オプション

`~/.adas/config.json` を編集:

```json
{
  "slack": {
    "enabled": true,
    "xoxcToken": "xoxc-...",
    "xoxdToken": "xoxd-...",
    "userId": "U059Z83SHRD",
    "fetchIntervalMinutes": 5,
    "parallelWorkers": 3,
    "channels": [],
    "excludeChannels": ["*rss*", "*bot*"],
    "mentionGroups": ["team_開発部", "team_プロジェクト*"],
    "watchKeywords": ["*自分の名前*", "*障害*", "*緊急*"]
  }
}
```

| オプション | 説明 | 例 |
|-----------|------|-----|
| `enabled` | Slack 統合を有効化 | `true` |
| `xoxcToken` | Slack xoxc トークン | `"xoxc-..."` |
| `xoxdToken` | Slack xoxd トークン | `"xoxd-..."` |
| `userId` | 自分の Slack ユーザー ID (自分の投稿を除外) | `"U059Z83SHRD"` |
| `fetchIntervalMinutes` | 取得間隔(分) | `5` |
| `parallelWorkers` | 並列ワーカー数 | `3` |
| `channels` | 監視するチャンネル ID (空=全参加チャンネル) | `["C12345678"]` |
| `excludeChannels` | 除外するチャンネル名パターン (glob対応) | `["*rss*", "*bot*"]` |
| `mentionGroups` | 監視するグループメンション (glob対応) | `["team_開発部*"]` |
| `watchKeywords` | 監視するキーワード (glob対応) | `["*障害*", "*緊急*"]` |

### 取得されるデータ

| 種類 | 説明 |
|------|------|
| **Mentions** | 自分宛てのメンション + グループメンション |
| **Keywords** | 監視キーワードにマッチするメッセージ |
| **Channels** | 指定チャンネルのメッセージ (スレッド含む) |
| **DMs** | ダイレクトメッセージ |

### ダッシュボード

Web UI の「Slack」タブで確認:
- Mentions / Channels / DMs / Keywords のタブ切り替え
- 未読バッジ表示
- 既読管理(個別・一括)
- Slack へのパーマリンク

---

## Claude Code 統合

Claude Code CLI のセッション履歴を自動取得・表示します。

### セットアップ

`~/.adas/config.json` を編集:

```json
{
  "claudeCode": {
    "enabled": true,
    "fetchIntervalMinutes": 5,
    "projects": []
  }
}
```

`projects` が空の場合、全プロジェクトのセッションを取得します。

### ダッシュボード

Web UI の「Claude」タブで確認:
- プロジェクト別セッション一覧
- メッセージ数、ツール使用回数
- セッションサマリー
