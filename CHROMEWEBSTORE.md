# Chrome Web Store 提出メモ — ContextFling

> 最終更新: 2026-08-24
>
> `ContextFling` は Working Name（仮称）。v0.1 の設計は Accepted Experimental だが、現行コードは未実装で、Chrome Web Store には未公開である。

## ストア掲載情報

**拡張機能名**: ContextFling（Working Name、提出前に正式名称を再確認）

**短い説明**: 未確定。v0.1 実装後の実際の挙動だけを記載する。

**詳細な説明**: 未確定。設計上の v0.1 は、X で選択した文章を右クリックの `ChatGPTで解説する` から ChatGPT Web の新規会話へ渡す実験機能である。ただし現行スキャフォールドに本体機能はなく、掲載用の説明として確定していない。DOM automation が公式連携ではないこと、初回 preview/同意、clipboard fallback、データ利用の実装結果は公開前に正確に記載する。

**カテゴリ**: 未確定

**Single Purpose**: 未確定。候補は「X で選択した文章と URL を、新しい ChatGPT Web 会話へ渡す」だが、実装・Security/Privacy review 後に確定する。

**主言語**: 日本語（掲載言語は未確定）

## グラフィックと素材

| 素材 | 寸法 | 状態 | ファイル |
| --- | --- | --- | --- |
| ストアアイコン（必須） | 128×128 PNG | 未作成 | 未確定 |
| スクリーンショット 1（必須） | 1280×800 または 640×400 | 未作成 | 未確定 |
| スクリーンショット 2（推奨） | 1280×800 または 640×400 | 未作成 | 未確定 |
| スクリーンショット 3（推奨） | 1280×800 または 640×400 | 未作成 | 未確定 |
| スクリーンショット 4 | 1280×800 または 640×400 | 未作成 | 未確定 |
| スクリーンショット 5 | 1280×800 または 640×400 | 未作成 | 未確定 |
| Small Promo Tile（推奨） | 440×280 | 未作成 | 未確定 |
| Marquee Promo Tile | 1400×560 | 未作成 | 未確定 |

### スクリーンショットのメモ

現行機能は未実装のため、動作を示すスクリーンショットは作成しない。実装後、X の選択、正確な preview、同意、ChatGPT 新規会話、DOM failure/clipboard fallback の表示を、個人情報なしで撮影する。

## 権限の説明

### 現在の Manifest

`src/manifest.json` の現行ベースラインは、`permissions`、`optional_permissions`、`host_permissions`、`optional_host_permissions` のいずれも未定義（実質的に空）である。したがって、以下の設計理由は予定であり、現在のストア権限ではない。

| 権限 | 種別 | 現在の状態 |
| --- | --- | --- |
| なし | permissions / optional_permissions / host_permissions / optional_host_permissions | 現行スキャフォールドは権限を追加していない。 |

### v0.1 Accepted Experimental design（未実装）

| 権限 | 種別 | 提出時の説明候補 |
| --- | --- | --- |
| `activeTab` | `permissions` | ユーザーが X 上で context menu を選んだときだけ、現在の tab の一時的な access を得て、選択位置と URL を処理する。X/Twitter への恒久 host access は要求しない。 |
| `contextMenus` | `permissions` | 選択文章に対する `ChatGPTで解説する` の右クリック menu を登録する。 |
| `scripting` | `permissions` | ユーザー操作で許可された X tab の isolated-world extractor と、同意済み `chatgpt.com` tab の限定 adapter/banner を実行する。remote code は実行しない。 |
| `storage` | `permissions` | 送信中だけの pending payload を session storage に置き、設定と consent version を local storage に置く。履歴・本文履歴・URL 履歴は保存しない。 |
| `https://chatgpt.com/*` | `optional_host_permissions` | 初回 preview で宛先とリスクを示し、明示同意したユーザーに限って ChatGPT Web DOM adapter と banner を同じ host に限定して実行する。 |
| `offscreen` | `optional_permissions` | DOM adapter が失敗した場合に、同梱 static offscreen document から clipboard fallback を行う。外部ページ・外部コードは読み込まない。 |
| `clipboardWrite` | `optional_permissions` | 同意済みの clipboard fallback で、送信対象と同じ固定 prompt を Clipboard API に一度だけ書く。clipboardRead は使わない。 |

optional permission は初回の送信内容、宛先、リスクの preview 後に、同意画面のボタン操作からだけ要求する。拒否した場合は送信せず、pending payload を削除する。Chrome 公式仕様、permission warning、実装の実際の挙動を提出前に再確認する。

### 使用しない権限

`tabs`、X/Twitter の恒久 `host_permissions`、`notifications`、`alarms`、`clipboardRead`、`cookies`、`history`、`webRequest`、`identity`、`<all_urls>`、OpenAI API key は v0.1 で使用しない。Action click は設定画面を開くだけで、action 自体は permission ではない。

## Privacy とデータ利用

### 現在のスキャフォールド

現行コードはページ本文、選択テキスト、URL、認証情報などのデータを処理、保存、同期、端末外送信しない。Chrome Web Store には未公開である。詳細は [PRIVACY.md](PRIVACY.md) を参照する。

**ユーザーデータを収集するか**: 現行コードでは いいえ（v0.1 実装後に再確認）

### v0.1 の予定データフロー（未実装）

ユーザーの明示操作で、選択文章と sanitized X/Twitter URL を一時的に処理し、preview の同意後に ChatGPT Web の新規会話へ渡す設計である。pending payload は session storage にのみ置き、成功・拒否・失敗・timeout・tab close・期限切れで削除する。送信履歴、Cookie、auth state、著者・日時などの余分な metadata は扱わない。

この予定は現行のデータ収集を意味しない。実装時にデータの種類、第三者サービスへの送信、ChatGPT 側での取り扱い、clipboard fallback、保持・削除を確定し、CWS の開示と Privacy Policy を同じ変更で更新する。

### データ利用の証明

- [ ] データを第三者へ販売しない（実装と提出前に最終確認）
- [ ] 拡張機能の中核機能と無関係な目的へデータを使わない（実装と提出前に最終確認）
- [ ] 信用力・融資目的にデータを使わない（実装と提出前に最終確認）

## Privacy Policy

**Privacy Policy URL**: 未確定。公開ゲート前に、公開 URL、連絡先、実装と一致した `PRIVACY.md` を用意する。

## 配布

**ソースリポジトリ**: [GitHub で Public OSS として公開済み](https://github.com/y4shiro/contextfling)。拡張機能の公開リリースとは別である。

**Chrome Web Store 公開範囲**: 未確定。Public Release Gate 完了まで提出しない。

**地域**: 未確定

## 開発者情報

**公開者名**: 未確定

**連絡先メールアドレス**: 未確定

**サポート URL / メール**: 未確定

**ホームページ URL**: 未確定

## バージョン履歴

| バージョン | 日付 | 変更 | 状態 |
| --- | --- | --- | --- |
| 0.0.0 | 2026-08-24 | Manifest V3 の最小スキャフォールドと v0.1 Accepted Experimental design を記録。本体機能は未実装。 | Draft |

## レビュー notes

### 既知の制限

- v0.1 設計は Accepted Experimental だが、現行コード、Manifest、権限は未実装・未追加。
- ChatGPT Web DOM automation は公式連携ではなく、DOM 変更、未ログイン、送信結果不明、利用条件、CWS 審査のリスクがある。
- 正式名称、掲載文言、権限 warning、Privacy Policy URL、素材、連絡先、公開時期は未確定。

### 却下履歴

なし。

## 提出前チェック

正式名称、LICENSE、`CONTRIBUTING.md`、`SECURITY.md`、`PRIVACY.md`、`CHANGELOG.md`、権限の個別理由、optional permission の同意 UI、Privacy 開示、連絡先、素材、実機検証、DOM/clipboard failure、Security/Privacy review、ChatGPT/OpenAI 利用条件確認、Release Gate を完了してから提出する。
