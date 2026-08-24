# ContextFling

> Working Name（仮称）: ContextFling

ContextFling は、X で選択した文章を新しい ChatGPT Web の会話へ渡し、解説を依頼する Chrome 拡張機能 OSS です。

## 現在の状態

v0.1.0 の実装と自動検証は完了しています。ただし、ChatGPT Web の DOM に依存する Experimental 機能のため、Chrome 実機での X→ChatGPT smoke test は未完了です。Chrome Web Store にはまだ公開していません。

現行の主な挙動は次のとおりです。

- X / Twitter の選択範囲を右クリックし、`ChatGPTで解説する` を選びます。
- 選択文は前後の空白と改行を正規化し、8,000 UTF-16 code units を上限にします。選択位置に近い status URL を優先し、取得できない場合は許可された X / Twitter ページ URL を query/hash なしで使います。
- 初回は、実際に送る prompt、URL、選択文、宛先、DOM 自動操作と clipboard fallback のリスクをプレビューします。明示的に同意した場合だけ権限を要求します。
- 同意後は毎回新しい `https://chatgpt.com/` タブを開きます。ChatGPT タブは前面表示が既定で、設定からバックグラウンド表示へ変更できます。
- ChatGPT Web への DOM 入力・送信は一度だけ試行します。失敗時は自動再送せず、clipboard fallback と ChatGPT タブ内の banner で案内します。
- action は設定画面を開きます。送信履歴、選択文の履歴、URL 履歴は拡張機能内に保存しません。

ChatGPT Web には公式の拡張機能連携 API を使っていません。ログイン状態、Cookie、token、既存会話は読み取りません。選択文と sanitized URL は、ユーザーの同意後に第三者である ChatGPT Web へ渡ります。詳細は [PRIVACY.md](PRIVACY.md) を確認してください。

## 開発

Node.js 24 以上と npm を使用します。実行時の外部ライブラリ依存はありません。

```sh
npm install
npm test
npm run typecheck
npm run lint
npm run build
npm run check:secrets
```

`npm run build` は Service Worker、設定ページ、offscreen clipboard ページを bundle し、静的 HTML/CSS と Manifest を `dist/` へ配置します。`dist/` は生成物であり、Git 管理対象外です。

### GitHub Releases の Experimental prerelease

v0.1.0 は [GitHub Releases](https://github.com/y4shiro/contextfling/releases) の Experimental prerelease として ZIP で配布します。配布 ZIP は `dist/` の内容をアーカイブ直下に置きます。つまり、解凍後に選択するフォルダの直下に `manifest.json` があり、`dist/` が一段入れ子にならない構成です。これは Chrome Web Store への公開とは別の配布です。

ダウンロードして手動で読み込む手順:

1. GitHub Releases から v0.1.0 の ZIP をダウンロードします。
2. ZIP を解凍し、直下に `manifest.json` があるフォルダを確認します。
3. Chrome で `chrome://extensions` を開き、Developer mode を有効にします。
4. `Load unpacked` を押し、解凍したフォルダを選択します（ZIP ファイルや、その親フォルダではありません）。
5. X / Twitter 上の文章を選択し、右クリックの `ChatGPTで解説する` を実行します。

GitHub Release の ZIP 配布は CWS 未公開の Experimental 配布です。CWS への提出・公開は、別の Release Gate を満たし、リリース単位でユーザーが明示承認した後に手動で行います。CI、Actions、agent、スクリプトから CWS の submit / publish は行いません。

### ローカル unpacked extension の確認

1. `npm run build` を実行します。
2. Chrome で `chrome://extensions` を開き、Developer mode を有効にします。
3. `Load unpacked` からリポジトリの `dist/` を選びます。
4. X / Twitter 上の文章を選択し、右クリックの `ChatGPTで解説する` を実行します。
5. 初回 preview で送信内容と宛先を確認し、同意するか拒否します。

実機 smoke では実アカウントの機密情報を選択せず、ChatGPT のログイン済み・未ログイン、前面・背景表示、DOM 変更、clipboard fallback、同意撤回を確認してください。

## 設計と制約

- 必須権限は `activeTab`、`contextMenus`、`scripting`、`storage` です。
- `https://chatgpt.com/*`、`offscreen`、`clipboardWrite` は preview 後の同意ボタンから要求する optional permission です。
- X / Twitter の恒久 host permission、`tabs`、`cookies`、`history`、`notifications`、`alarms`、`clipboardRead`、`<all_urls>`、backend、analytics、telemetry、OpenAI API、remote code は使用しません。
- pending payload は `storage.session` に一時保存し、`expiresAt` により 10 分で論理失効させます。終端イベントでは削除しますが、`alarms` を使わないため、期限到達だけで物理削除されるとは限りません。物理削除は次の Service Worker 起床・関連イベント、または browser restart などで行われます。設定と consent version だけを `storage.local` に保存します。
- ChatGPT Web の DOM 構造変更、未ログイン、送信結果不明、Chrome / Web Store の審査・利用条件が既知の制限です。実装は Experimental のままです。

詳細な責務、権限、状態遷移、受入状況は [v0.1 設計書](docs/architecture/v0.1-design.md)、実装履歴は [CHANGELOG.md](CHANGELOG.md)、公開前の確認事項は [CHROMEWEBSTORE.md](CHROMEWEBSTORE.md) に記録しています。継続ルールは [AGENTS.md](AGENTS.md) を参照してください。

## 公開状態

ソースリポジトリは [GitHub で Public OSS として公開済み](https://github.com/y4shiro/contextfling) です。ソース公開と拡張機能の公開リリースは別であり、Chrome Web Store への提出は、実機 smoke、Security / Privacy review、正式名称、掲載素材、Privacy Policy の公開 URL、サポート窓口を確認してから行います。

## ライセンス

MIT License。詳細は [LICENSE](LICENSE) を参照してください。
