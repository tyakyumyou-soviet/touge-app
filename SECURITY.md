# Security Policy

## Firebase

- 管理者SDKの秘密鍵、サービスアカウント、外部APIの秘密鍵をフロントエンドへ置かないでください。
- `firestore.rules` と `storage.rules` の変更時はFirebase Emulator Suiteで権限テストを実施してください。
- 本番公開前にFirebase App Checkを有効化してください。
- 不正投稿への対応権限はFirebase Custom Claimsで一般ユーザーから分離してください。

## Reporting

脆弱性を公開Issueへ投稿せず、リポジトリ所有者へ非公開で連絡してください。
