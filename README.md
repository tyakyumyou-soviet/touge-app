# 峠 — Touge Drive Explorer

カーブ、高低差、道幅を中心に、走って楽しい峠道を探すレスポンシブPWAです。初期対象エリアは東京都・神奈川県・静岡県です。

## 実装済み機能

- OpenFreeMap / MapLibre GL JSによる2D地図
- Terrarium標高タイルを使った3D地形表示
- コース一覧、検索、都県フィルター、項目別ソート
- 距離、所要時間、高低差、標高プロファイル
- カーブ、高低差、道幅、景色、路面、交通量、アクセスの項目別評価
- Google Mapsへのコース／現在地からのナビ引き渡し
- 地図クリックによるコース作成
- Googleログイン、Cloud Firestore保存、公開範囲
- 1ユーザー・1コース単位の評価投稿
- Web Share API／クリップボードによる共有URL
- PC、タブレット、スマートフォン対応
- インストール、アプリシェルキャッシュ、地図タイルキャッシュ、Firestoreオフライン永続化を含むPWA
- Firestore / Storage Security Rulesと複合インデックス

## 開発

必要環境: Node.js 20以降

```bash
npm install
npm run dev
```

品質チェック:

```bash
npm run check
```

## Firebase設定

Firebaseプロジェクト `touge-app` のWeb設定は [src/lib/firebase.ts](./src/lib/firebase.ts) にあります。Firebase Web APIキーはクライアント識別情報であり、秘密鍵ではありません。アクセス制御はSecurity Rules、Authentication、App Checkで行ってください。

Firebase Consoleで次を有効にします。

1. AuthenticationでGoogleプロバイダを有効化する
2. Authenticationの承認済みドメインに本番ドメインを登録する
3. Cloud Firestoreデータベースを作成する
4. Cloud Storageを作成する
5. Firebase App Checkを登録する（本番公開前を推奨）

ルールとインデックスのデプロイ:

```bash
npx firebase-tools deploy --only firestore:rules,firestore:indexes,storage
```

## ビルドとHosting

```bash
npm run build
npx firebase-tools deploy --only hosting
```

Firebase CLIで未ログインの場合は、先に `npx firebase-tools login` が必要です。

## データについて

初期コースはUI検証用の編集データです。距離、標高、道路状況、規制情報の正確性や最新性を保証するものではありません。実走前には現地標識、道路管理者、各道路の公式情報を確認してください。

公道での危険運転や速度超過を推奨するアプリではありません。走行中の画面操作は避け、安全な場所で操作してください。

## バージョニング

[Semantic Versioning](https://semver.org/)に沿って `vMAJOR.MINOR.PATCH` タグで管理します。変更履歴は [CHANGELOG.md](./CHANGELOG.md) を参照してください。

## ライセンス

Copyright © 2026 touge-app contributors. All rights reserved.
