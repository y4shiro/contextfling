# ContextFling 継続ルール

> Working Name（仮称）: ContextFling

このファイルは、ContextFling の変更時に継続して適用するプロジェクトルールです。未確定の要件を実装で先に固定せず、変更の必要性・影響・検証方法を明らかにしてください。

## Chrome 権限

- Manifest は Manifest V3 とし、権限は最小限にする。
- `permissions`、`optional_permissions`、`host_permissions` を理由なしに追加しない。各権限の理由を `CHROMEWEBSTORE.md` と関連設計文書へ記録する。
- `<all_urls>`、`cookies`、`history`、`bookmarks`、`webRequest` などの広い権限は追加しない。例外には必要性、代替案、Security Impact、Privacy Impact、Maintenance Impact を記載し、ADR 候補にする。
- `activeTab` の発動条件、`tabs` と `host_permissions` の要否、`scripting` の対象範囲は Chrome 公式仕様を再確認する。Skill と公式が食い違う場合は、確認日と根拠を記録したうえで公式仕様を優先する。
- v0.1 の Accepted design は現行 Manifest に実装済みで、required permission は `activeTab`、`contextMenus`、`scripting`、`storage`、optional permission/host は `https://chatgpt.com/*`、`offscreen`、`clipboardWrite` とする。今後権限を追加する場合は、実装、permission test、CWS/Privacy 更新を同じ変更で行う。
- optional host/permission は初回の正確な preview 後、設定ページの approve button の同期 click handler からだけ `chrome.permissions.request()` を呼ぶ。呼び出し前に await や別の非同期処理を置かず、user gesture を保つ。要求の promise が解決した後に approve runtime message を送り、Service Worker が `chrome.permissions.contains()` で bundle 一式を最終確認する。storage 操作は引き続き Service Worker 経由とする。
- X/Twitter には恒久 host permission を追加しない。`tabs`、`notifications`、`alarms`、`clipboardRead` は v0.1 で使用しない。

## 外部通信・データ利用

- 外部通信、独自バックエンド、ユーザー投稿の開発者管理サーバーへの送信を勝手に追加しない。
- analytics、telemetry、広告、remote config、開発者向けの利用状況収集を追加しない。導入が必要になった場合は、明示的な設計判断、同意・開示、権限と Privacy 文書の更新を先に行う。
- API key、Cookie、認証情報をソース、Manifest、ログ、Issue、テスト fixture に保存しない。

## Runtime dependency とコード実行

- Extension の runtime dependency は原則 0 とする。開発依存を追加する場合も、目的・bundle への影響・保守負担を確認する。
- remote code、CDN からのスクリプト、実行時の module import、`eval`、`new Function`、inline script を使用しない。
- 生成物はローカルで bundle し、実行時にコードを取得・解釈しない。CSP を弱める変更を行わない。

## ChatGPT と DOM

- ChatGPT Web DOM automation は原則禁止であり、例外は [ADR 0001](docs/adr/0001-experimental-chatgpt-web-handoff.md) の v0.1 Experimental scope に限る。ADR の Accepted は実装成功や公式連携を意味しない。
- 例外を実装する場合も、初回の送信内容・宛先・リスク preview、明示同意、`https://chatgpt.com/*` の optional host permission、selector/adapter 隔離、bounded timeout、retry 禁止、clipboard fallback、banner 表示、実機回帰テストを必須とする。
- ChatGPT の Cookie、token、auth state、API key は取得しない。既存会話を使わず、毎回新規会話へ限定する。
- ADR の scope 外の非公開 DOM automation、任意サイトの自動操作、同意を省略した入力・送信、送信結果不明時の再試行は追加しない。
- handoff の方式を変更する場合は Destination adapter 内に依存を閉じ込め、公式サポート範囲、破壊リスク、ユーザー操作の明示性を記録する。

## Selector と untrusted input

- X などの selector は一箇所へ集約し、散在させない。selector を変更したら fixture、失敗時の挙動、graceful degradation を確認する。
- ページ本文、選択テキスト、URL、DOM 属性、AI 出力などを常に untrusted input として扱う。
- untrusted input を無検証で `innerHTML`、HTML 属性、URL 遷移、コード実行へ渡さない。表示には `textContent` などの安全な方式を優先し、境界と指示を明確に分ける。
- ページ内リンクの自動アクセス、投稿内 JavaScript の実行、プロンプトインジェクションを前提にした危険な操作を追加しない。

## ドキュメントと ADR

- セキュリティ、プライバシー、権限、外部通信、branding、公開範囲に影響する変更では、コードと同じ変更で関連文書を更新する。
- 変更コストが高く複数の妥当な選択肢がある判断、または将来理由を問われる判断は `docs/adr/` に ADR 候補を作る。
- 未検討の事項を `Accepted` にしない。判断前は `Proposed` または `Draft` とし、根拠・代替案・影響を残す。ADR 0001 は例外的に Accepted だが、Experimental・撤回可能・実機未検証・CWS未公開として扱う。
- Chrome Web Store に関係する変更は `CHROMEWEBSTORE.md` の listing、permission justification、privacy 開示、version history を確認する。

## Branding と公開

- `ContextFling` は Working Name であり、正式名称・商標・アイコン・ストア文言は未確定である。
- 製品名をドメインロジック、永続データ形式、公開プロトコル、責務を表す class/function 名へ不要に埋め込まない。branding は少数箇所へ集約する。
- GitHub のソースリポジトリ公開と拡張機能の公開リリースは別である。v0.1.0 は GitHub Releases の Experimental prerelease として、`dist/` の内容をアーカイブ直下にした ZIP で配布し、Chrome Web Store には公開しない。
- Chrome Web Store への提出・公開は絶対に自動化しない。CI、Actions、agent、スクリプトから CWS の submit / publish を実装・実行せず、将来もリリース単位のユーザーの明示承認後に、ユーザーが手動操作する。

## GLM 利用

- GLM は、公開 GitHub リポジトリ、または内容が公開可能で明示的に opt-in された local PoC の、限定的で低リスクな実装に限り使用する。
- 必ず承認済みの GLM worker router を経由し、private repository、業務・機密情報、credential、認証・認可、security、production infrastructure、DB migration、大規模変更、曖昧な作業では使用しない。
- 判断できない場合は GLM を使わず、既存の担当エージェントで扱う。秘密情報や未公開データを外部 worker に渡さない。
- GLM 実行後は `git status --short`、`git diff`、`git diff --cached`、HEAD・branch・remote、関連 test/lint/typecheck/build を独立に確認する。

## 検証

- 実装後は関連する format、lint、typecheck、test、build を実行し、未実行の検証と残存リスクを報告する。
- 変更は必要最小限にし、無関係な整理や既存の `.codex/skills/chrome-extensions` の変更・削除を行わない。
