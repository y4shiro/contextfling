# ADR

Architecture Decision Record（ADR）は、変更コストが高く、複数の妥当な選択肢があり、将来「なぜこうしたのか」を説明する必要がある設計判断を記録します。

## 基準

- 判断の背景、選択肢、採用理由、Security/Privacy/Maintenance Impact を記載する。
- 未検討の事項を `Accepted` にしない。検討中は `Proposed` または `Draft` とする。
- Manifest 権限、外部通信、認証・認可、データ保持、handoff、DOM 依存、公開方針など、後戻りコストが高い事項は ADR 候補とする。
- 関連するコード、テスト、`CONTEXT.md`、`CHROMEWEBSTORE.md` と内容を同期する。

## 状態

現時点で `Accepted` の ADR はありません。立ち上げ時点の候補は、`activeTab` と host permissions、backend なし、DOM extraction と API の境界、Source/Destination 分離、ChatGPT handoff、ChatGPT DOM automation を行わない方針、runtime dependency、OSS 公開方針です。

本体機能の仕様が固まる前に、未検討の判断を ADR として確定しません。
