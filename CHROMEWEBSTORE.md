# Chrome Web Store 提出メモ — ContextFling

> 最終更新: 2026-08-27
>
> v0.1.1 実装済み・Experimental。Chrome 実機では foreground 自動送信成功、background hidden document の送信前 fail-closed、clipboard DOM copy 成功を確認。ADR 0003 で foreground-only を採択。Chrome Web Store には未公開。

## 配布方針

v0.1.1 は [GitHub Releases の一覧](https://github.com/y4shiro/contextfling/releases) で `Prerelease` と表示された Experimental prerelease として、`dist/` の内容をアーカイブ直下にした ZIP で手動配布します。GitHub Release の ZIP 配布は Chrome Web Store 公開とは別であり、現在 CWS には公開していません。v0.1.0 は `about:blank` 完了イベント race の既知不具合があるため非推奨です。

Chrome Web Store への提出・公開は絶対に自動化しません。CI、Actions、agent、スクリプトから CWS の submit / publish を実装・実行せず、将来もリリース単位のユーザーの明示承認後に、ユーザーが手動操作します。

> タスク管理上の役割: この文書は Chrome Web Store の metadata と開示内容の正本です。active な task / bug / Release Gate の状態・担当・優先度・blocker は [GitHub Issues](https://github.com/y4shiro/contextfling/issues) を正本とし、リリースまたは目標単位のまとまりは [v0.1.x hardening Milestone](https://github.com/y4shiro/contextfling/milestone/1) を参照してください。この文書に active backlog を複製しません。

## ストア掲載情報

**拡張機能名**: ContextFling（Working Name、正式名称と商標は提出前に再確認）

**短い説明（候補）**: X で選択した文章を、新しい ChatGPT Web 会話へ渡して解説を依頼します。

**詳細な説明（候補）**: X / Twitter で文章を選択し、右クリックから ChatGPT Web の新しい会話へ渡します。ChatGPT tab は前面に開きます。初回は送信内容と宛先を確認してから同意できます。ChatGPT Web への受け渡しに失敗した場合は、手動貼り付け用の案内または明示的な失敗案内を表示します。送信履歴は拡張機能内に保存しません。

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

`src/manifest.json` の v0.1.1 配布値は次のとおりです。

| Manifest key | 現在値 |
| --- | --- |
| `manifest_version` | `3` |
| `version` | `0.1.1` |
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
| `storage` | required | pending payload を session、consent version を local に保存する | 送信・閲覧履歴・表示設定の保存 |
| `https://chatgpt.com/*` | optional host | exact preview と同意後だけ ChatGPT Web adapter / banner を限定 host へ注入する | X / Twitter や任意 host への注入 |
| `offscreen` | optional | adapter 失敗時の同梱 offscreen clipboard fallback を作成する | 外部ページ、外部コード |
| `clipboardWrite` | optional | fallback prompt を Clipboard API に一度だけ書く | clipboard の読み取り |

optional permission は、preview の表示後に設定ページの approve button の同期 click handler から `chrome.permissions.request()` を直接呼びます。呼び出し前に await を置かず user gesture を保ち、要求の promise が解決した後に approve runtime message を送ります。Service Worker は message を受けた後に `chrome.permissions.contains()` で host / `offscreen` / `clipboardWrite` の bundle 一式を最終確認し、拒否または不足なら送信せず pending を削除します。同意撤回では bundle の削除後に各 component を個別確認し、残存または確認失敗を成功表示しません。その場合も consent version と pending は削除します。Chrome は以前に許可した permission を削除後に再要求すると、確認 prompt なしで再付与する場合があります。この場合も、拡張機能は撤回後の新しい exact preview と明示同意を必須とし、以前の consent version を再利用しません。storage 操作は Service Worker 経由に限定します。

## 使用しない権限・機能

`tabs`、X / Twitter の恒久 `host_permissions`、`notifications`、`alarms`、`clipboardRead`、`cookies`、`history`、`bookmarks`、`webRequest`、`identity`、`<all_urls>`、OpenAI API key は使用しません。X API、独自 backend、analytics、telemetry、広告、remote config、remote code もありません。

## Data use と Privacy 開示

拡張機能の開発者が収集・販売するデータはありません。ただし、ユーザー操作で次のデータを一時処理し、同意後に第三者の ChatGPT Web へ渡します。

| データ | 目的 | 開発者 / backend への送信 | 保持 |
| --- | --- | --- | --- |
| 選択文（正規化後、最大 8,000 UTF-16 code units） | ChatGPT へ解説を依頼する | なし | `storage.session` の pending と処理中のみ |
| sanitized X / Twitter URL | 選択文の参照元を prompt に含める | なし | 同上 |
| 固定 prompt | preview と ChatGPT Web への handoff | なし | 同上 |
| consent version | 同意状態 | なし | `storage.local` |

DOM 失敗時には、bounded failure に限り同意済みの prompt を clipboard に一度だけ書く場合があります。安全に実行できない状態では no-op + 明示的 feedback へ終端化します。拡張機能は clipboard を読みません。詳細な保持・削除・第三者境界は [PRIVACY.md](PRIVACY.md) に記載します。

**ユーザーデータを収集するか**: 開発者による収集はありません。中核機能のためにユーザーが選択した文章と sanitized URL を一時処理し、同意後に ChatGPT Web へ渡します。

**データを販売するか**: いいえ。

**中核機能と無関係な目的に使うか**: いいえ。

**信用力・融資目的に使うか**: いいえ。

失敗経路の typed diagnostics はローカルの Service Worker 開発者 console にだけ出力し、selection、URL、prompt、clipboard 内容、account / request / tab 情報、例外本文を含めません。保存、analytics、telemetry、開発者 backend への送信は行いません。

## Privacy Policy とサポート

**Privacy Policy URL**: 未確定。CWS 提出前に、公開 URL と [PRIVACY.md](PRIVACY.md) の内容を一致させます。

**サポート URL**: GitHub Issues（公開可能な質問のみ）を候補とします。

**脆弱性報告**: 機密性のある内容は GitHub Private vulnerability reporting を使用し、公開 Issue に token、個人情報、未修正の詳細を投稿しません。

## 配布状態とバージョン履歴

**ソースリポジトリ**: [GitHub で Public OSS として公開済み](https://github.com/y4shiro/contextfling)。ソース公開は CWS 公開を意味しません。

**Chrome Web Store**: 未公開。追加実機シナリオ、Security / Privacy review、正式名称、素材、Privacy Policy URL、サポート窓口、利用規約確認を終えるまで提出しません。

| バージョン | 日付 | 変更 | 状態 |
| --- | --- | --- | --- |
| 0.1.1 | 2026-08-24 / 2026-08-27 | `about:blank` 完了イベント race、ChatGPT handoff の失敗経路、ProseMirror composer readback、単回 clipboard fallback、optional permission 撤回後の個別確認を修正。Chrome 実機で foreground の X→ChatGPT 自動送信成功、background hidden の fail-closed、clipboard DOM copy 成功を確認。ADR 0003 で foreground-only を採択。permission 撤回の追加実機 smoke は継続中。 | GitHub Experimental prerelease（ZIP） / CWS未公開 |
| 0.1.0 | 2026-08-24 | X selection、preview / consent、ChatGPT Web Experimental handoff、clipboard fallback、設定画面、最小権限 Manifest を実装。 | Deprecated（`about:blank` 完了イベント race 既知） / CWS未公開 |
| 0.0.0 | 2026-08-24 | Manifest V3 の初期スキャフォールド。 | Superseded |

## Review notes と Release Gate

- ChatGPT Web DOM automation は公式連携ではなく、DOM 変更、React / ProseMirror state readiness、未ログイン、送信結果不明、利用条件、CWS 審査のリスクがあります。foreground-only でも fail-closed、send 最大一回、自動 retry なし、送信結果不明時の再送なしを維持します。
- Chrome 116 以上で foreground の X→ChatGPT 自動送信成功は実機確認済みです。background hidden document は送信前に fail-closed し、clipboard DOM copy は成功しました。安全に実行できない状態は no-op + 明示的 feedback とし、background paste-only は次点の将来 Issue 候補です。
- foreground-only 化後に target が前面で開くこと、旧 `openInBackground` 保存値を無視すること、logged-out、tab close、DOM failure、同意撤回、clipboard success / failure を追加確認する Release Gate が残っています。
- 正式名称、商標、掲載素材、Privacy Policy 公開 URL、連絡先、CWS data disclosure の最終入力が未完了です。
- GitHub Release の ZIP は `dist/` の内容を直下にした手動配布物です。CWS への提出・公開を行う場合は、別の Release Gate とリリース単位のユーザー明示承認を完了し、ユーザーが手動操作します。
- 追加実機シナリオと Security / Privacy review の結果により、Experimental scope を撤回または変更する可能性があります。変更時は ADR と関連文書を更新します。

提出前に上記の未完了項目、`CHANGELOG.md`、LICENSE、CONTRIBUTING、Security、Privacy、権限 warning、ChatGPT / OpenAI の利用規約を確認します。
