# Security Policy

## 現在のサポート状況

ContextFling は設計・実験段階であり、Chrome Web Store で公開している
サポート対象バージョンはまだありません。未リリースのコードについても、
セキュリティ上の問題の報告を受け付けます。

## System and Scope

このポリシーは、ContextFling リポジトリ全体に適用します。

現行コードは Manifest V3 の最小スキャフォールドであり、ユーザーデータを
処理、保存、送信しません。計画中の v0.1 は、X 上でユーザーが選択した
テキストと投稿 URL を、明示的な操作を起点に ChatGPT Web の新規チャットへ
渡す Chrome 拡張機能です。

独自バックエンド、データベース、analytics、telemetry、広告、X API、
OpenAI API は使用しません。

## Threat Model and Trust Boundaries

- X と ChatGPT のページ本文、DOM、URL、選択テキストは信頼しません。
- 選択テキストには個人情報、機密情報、悪意ある指示が含まれる可能性があります。
- X、ChatGPT、Chrome 自体は第三者サービスであり、本リポジトリの管理範囲外です。
- 拡張機能から ChatGPT への受け渡しは、ユーザー端末と第三者サービスの境界を越えます。
- 外部 GLM worker は公開済みのコードだけを扱い、認証情報や非公開データを渡しません。

## Security Invariants

- API key、token、Cookie、秘密鍵、認証情報をコード、設定、fixture、ログ、
  Issue、Pull Requestへ保存しません。
- 権限は実装済み機能に必要な最小範囲に限定し、`<all_urls>`、`cookies`、
  `history`、`bookmarks`、`webRequest`を使用しません。
- ChatGPTへの送信は、ユーザーの明示操作と初回同意なしに開始しません。
- 初回は送信内容と送信先を提示し、拒否された内容は保持しません。
- 毎回ChatGPTの新規チャットを使用し、既存会話へ自動送信しません。
- 自動送信の結果が不明な場合に再送せず、失敗時はクリップボードへ
  フォールバックします。
- 送信内容と投稿URLの履歴を拡張機能内へ保存しません。
- ページ由来の値はテキストとして扱い、無検証でHTML、属性、コード実行、
  任意のURL遷移へ渡しません。
- remote code、`eval`、`new Function`、inline script、実行時の外部module
  importを使用しません。
- GLMは承認済みrouterのfail-closed判定を通し、cleanなPublic GitHub
  リポジトリの限定的・低リスクな作業だけに使用します。

## Reportable Findings and Severity Context

次の問題は報告対象です。

- 同意なしのデータ取得、保存、送信
- 選択範囲を越えたページ内容や認証情報へのアクセス
- 意図しないChatGPTアカウント、既存会話、第三者hostへの送信
- 二重送信、自動再試行、送信結果の誤表示
- 広すぎる権限、host access、CSPの緩和
- XSS、コード実行、remote code、prompt injectionから実操作へ至る経路
- secret、credential、個人データのリポジトリまたはログへの漏えい
- 開発依存、GitHub Actions、外部workerを経由した現実的なsupply-chain攻撃

認証情報の漏えい、同意を回避した外部送信、任意コード実行、広範な
ブラウザデータへのアクセスは、到達可能性と影響に応じて重大度を高く扱います。

## Out of Scope, Exclusions, and Accepted Risk

- ContextFlingを経由せず、X、ChatGPT、Chrome自体だけで成立する脆弱性
- 第三者サービスの一般的な停止や性能低下
- データ漏えい、誤送信、権限拡大を伴わないselector変更による単純な機能停止

ただし、第三者サービスの変更によってContextFlingが誤送信、安全でない
fallback、意図しないデータアクセスを起こす場合は報告対象です。

## Known Limitations and Compensating Controls

- ChatGPT WebのDOM automationは公式の安定した連携仕様ではなく、壊れやすい
  実験機能です。依存箇所をadapterへ限定し、明示同意、対象host限定、
  自動再試行禁止、クリップボードfallback、実機回帰テストで補います。
- `npm run check:secrets`は高確度パターンを検査しますが、未知または難読化された
  secretを完全には検出できません。`.gitignore`、差分レビュー、GitHub secret
  scanningとpush protectionを併用します。

## 脆弱性の報告

Public化後はGitHubのPrivate vulnerability reportingを優先してください。
認証情報、個人情報、再現用secret、未修正の詳細をPublic Issueへ投稿しないでください。
