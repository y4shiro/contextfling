# Chrome Web Store 提出メモ — ContextFling

> 最終更新: 2026-08-24
>
> v0.1.0 実装済み・Experimental。Chrome 実機 smoke は未完了、Chrome Web Store には未公開。

## 配布方針

v0.1.0 は [GitHub Releases](https://github.com/y4shiro/contextfling/releases) の Experimental prerelease として、`dist/` の内容をアーカイブ直下にした ZIP で手動配布します。GitHub Release の ZIP 配布は Chrome Web Store 公開とは別であり、現在 CWS には公開していません。

Chrome Web Store への提出・公開は絶対に自動化しません。CI、Actions、agent、スクリプトから CWS の submit / publish を実装・実行せず、将来もリリース単位のユーザーの明示承認後に、ユーザーが手動操作します。

## ストア掲載情報

**拡張機能名**: ContextFling（Working Name、正式名称と商標は提出前に再確認）

**短い説明（候補）**: X で選択した文章を、新しい ChatGPT Web 会話へ渡して解説を依頼します。

**詳細な説明（候補）**: X / Twitter で文章を選択し、右クリックから ChatGPT Web の新しい会話へ渡します。初回は送信内容と宛先を確認してから同意できます。ChatGPT Web への受け渡しに失敗した場合は、手動貼り付け用の案内を表示します。送信履歴は拡張機能内に保存しません。

ユーザー向け listing では、DOM selector や実装の詳細を過度に強調しません。ただし review notes、Privacy 開示、利用規約確認では、ChatGPT Web の非公式・Experimental な DOM 依存であることを正確に記載します。

**カテゴリ**: 未確定

**Single Purpose**: X / Twitter でユーザーが選択した文章と sanitized URL を、新しい ChatGPT Web 会話へ渡して解説を依頼すること。

**主言語**: 日本語（最終掲載言語は提出前に確定）

## グラフィックと素材

| 素材 | 寸法 | 状態 | ファイル |
| --- | --- | --- | --- |
| ストアアイコン（必須） | 128×128 PNG | 未作成 | 未確定 |
| スクリーンショット 1（必須） | 1280×800 または 640×400 | 実機 smoke 後 | 未確定 |
| スクリーンショット 2（推奨） | 1280×800 または 640×400 | 未作成 | 未確定 |
| スクリーンショット 3（推奨） | 1280×800 または 640×400 | 未作成 | 未確定 |
| Small Promo Tile（推奨） | 440×280 | 未作成 | 未確定 |
| Marquee Promo Tile | 1400×560 | 未作成 | 未確定 |

実機確認前に、個人情報や実アカウントの機密情報を含む画像は作成しません。

## 現在の Manifest と権限理由

`src/manifest.json` の v0.1.0 現在値は次のとおりです。

| Manifest key | 現在値 |
| --- | --- |
| `manifest_version` | `3` |
| `version` | `0.1.0` |
| `minimum_chrome_version` | `116` |
| `permissions` | `activeTab`, `contextMenus`, `scripting`, `storage` |
| `optional_permissions` | `offscreen`, `clipboardWrite` |
| `optional_host_permissions` | `https://chatgpt.com/*` |
| `host_permissions` | なし |
| `options_page` | `settings/settings.html` |
| `action` | `{"default_title":"ContextFling の設定を開く"}`。クリックで設定画面を開く |

| 権限 | 種別 | 実装上の理由 | 使用しない目的 |
| --- | --- | --- | --- |
| `activeTab` | required | X / Twitter 上のユーザー操作時に、現在 tab の一時的な情報へアクセスする | X / Twitter の恒久アクセス |
| `contextMenus` | required | 選択文用の `ChatGPTで解説する` menu を登録する | 複数の preset menu |
| `scripting` | required | X の isolated-world URL extractor、同意後の ChatGPT adapter、固定 banner を実行する | remote code、任意サイト操作 |
| `storage` | required | pending payload を session、設定と consent version を local に保存する | 送信・閲覧履歴の保存 |
| `https://chatgpt.com/*` | optional host | exact preview と同意後だけ ChatGPT Web adapter / banner を限定 host へ注入する | X / Twitter や任意 host への注入 |
| `offscreen` | optional | adapter 失敗時の同梱 offscreen clipboard fallback を作成する | 外部ページ、外部コード |
| `clipboardWrite` | optional | fallback prompt を Clipboard API に一度だけ書く | clipboard の読み取り |

optional permission は、preview の表示後に設定ページの approve button の同期 click handler から `chrome.permissions.request()` を直接呼びます。呼び出し前に await を置かず user gesture を保ち、要求の promise が解決した後に approve runtime message を送ります。Service Worker は message を受けた後に `chrome.permissions.contains()` で host / `offscreen` / `clipboardWrite` の bundle 一式を最終確認し、拒否または不足なら送信せず pending を削除します。storage 操作は Service Worker 経由に限定します。

## 使用しない権限・機能

`tabs`、X / Twitter の恒久 `host_permissions`、`notifications`、`alarms`、`clipboardRead`、`cookies`、`history`、`bookmarks`、`webRequest`、`identity`、`<all_urls>`、OpenAI API key は使用しません。X API、独自 backend、analytics、telemetry、広告、remote config、remote code もありません。

## Data use と Privacy 開示

拡張機能の開発者が収集・販売するデータはありません。ただし、ユーザー操作で次のデータを一時処理し、同意後に第三者の ChatGPT Web へ渡します。

| データ | 目的 | 開発者 / backend への送信 | 保持 |
| --- | --- | --- | --- |
| 選択文（正規化後、最大 8,000 UTF-16 code units） | ChatGPT へ解説を依頼する | なし | `storage.session` の pending と処理中のみ |
| sanitized X / Twitter URL | 選択文の参照元を prompt に含める | なし | 同上 |
| 固定 prompt | preview と ChatGPT Web への handoff | なし | 同上 |
| `openInBackground`、consent version | UI 設定と同意状態 | なし | `storage.local` |

DOM 失敗時には、同意済みの prompt を clipboard に書く場合があります。拡張機能は clipboard を読みません。詳細な保持・削除・第三者境界は [PRIVACY.md](PRIVACY.md) に記載します。

**ユーザーデータを収集するか**: 開発者による収集はありません。中核機能のためにユーザーが選択した文章と sanitized URL を一時処理し、同意後に ChatGPT Web へ渡します。

**データを販売するか**: いいえ。

**中核機能と無関係な目的に使うか**: いいえ。

**信用力・融資目的に使うか**: いいえ。

## Privacy Policy とサポート

**Privacy Policy URL**: 未確定。CWS 提出前に、公開 URL と [PRIVACY.md](PRIVACY.md) の内容を一致させます。

**サポート URL**: GitHub Issues（公開可能な質問のみ）を候補とします。

**脆弱性報告**: 機密性のある内容は GitHub Private vulnerability reporting を使用し、公開 Issue に token、個人情報、未修正の詳細を投稿しません。

## 配布状態とバージョン履歴

**ソースリポジトリ**: [GitHub で Public OSS として公開済み](https://github.com/y4shiro/contextfling)。ソース公開は CWS 公開を意味しません。

**Chrome Web Store**: 未公開。実機 smoke、Security / Privacy review、正式名称、素材、Privacy Policy URL、サポート窓口、利用規約確認を終えるまで提出しません。

| バージョン | 日付 | 変更 | 状態 |
| --- | --- | --- | --- |
| 0.1.0 | 2026-08-24 | X selection、preview / consent、ChatGPT Web Experimental handoff、clipboard fallback、設定画面、最小権限 Manifest を実装。 | GitHub Experimental prerelease（ZIP） / CWS未公開 / 実機 smoke pending |
| 0.0.0 | 2026-08-24 | Manifest V3 の初期スキャフォールド。 | Superseded |

## Review notes と Release Gate

- ChatGPT Web DOM automation は公式連携ではなく、DOM 変更、未ログイン、送信結果不明、利用条件、CWS 審査のリスクがあります。自動 retry はせず、clipboard fallback と banner を使います。
- Chrome 116 以上での実機 X→ChatGPT smoke test（logged-in / logged-out、前面 / 背景、tab close、DOM failure、clipboard success / failure、同意撤回）が未完了です。
- 正式名称、商標、掲載素材、Privacy Policy 公開 URL、連絡先、CWS data disclosure の最終入力が未完了です。
- GitHub Release の ZIP は `dist/` の内容を直下にした手動配布物です。CWS への提出・公開を行う場合は、別の Release Gate とリリース単位のユーザー明示承認を完了し、ユーザーが手動操作します。
- 実機 smoke と Security / Privacy review の結果により、Experimental scope を撤回または変更する可能性があります。変更時は ADR と関連文書を更新します。

提出前に上記の未完了項目、`CHANGELOG.md`、LICENSE、CONTRIBUTING、Security、Privacy、権限 warning、ChatGPT / OpenAI の利用規約を確認します。
