# 峠 — Touge Drive Explorer

カーブ、高低差、道幅を中心に、走って楽しい峠道を探すレスポンシブPWAです。初期対象エリアは東京都・神奈川県・静岡県です。

## 実装済み機能

- OpenFreeMap / MapLibre GL JSによる2D地図
- Terrarium標高タイルを使った選択コース専用3D地形表示
- コース名・地名・タグ・紹介文を横断する検索、都県・料金・半径フィルター、項目別ソート
- 距離、所要時間、高低差、標高プロファイル
- カーブ、高低差、道幅、景色、路面、交通量、アクセスの項目別評価
- Google Mapsへのコース／現在地からのナビ引き渡し
- 地点指定／既存コース連結に加え、探索範囲・走行スタイル・料金・立ち寄り地点から候補を選ぶコース作成
- Googleログイン、Cloud Firestore保存、公開範囲
- 1ユーザー・1コース単位の評価投稿
- Web Share API／クリップボードによる共有URL
- PC、タブレット、スマートフォン対応
- インストール、アプリシェルキャッシュ、地図タイルキャッシュ、Firestoreオフライン永続化を含むPWA
- Firestore / Storage Security Rulesと複合インデックス
- 道路管理者を情報源とする料金・無料条件表示とユーザー情報報告

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

### 地図カメラの実装規約

地点検索、コース選択、現在地、ルート全体表示など、プログラムから地図を移動する処理では `src/lib/mapCamera.ts` の `visibleMapCameraPadding()` を必ず使用します。地図に重なる新しいモバイル用シートには `data-map-occlusion="bottom-sheet"` を付けてください。これにより、シートをドラッグした現在位置を基準に、対象が実際に見えている地図領域の中央へ表示されます。

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

### Netlify

このリポジトリをNetlifyへ接続すると、[netlify.toml](./netlify.toml)の設定が自動的に使用されます。

- Production branch: `main`
- Build command: `npm run build`
- Publish directory: `dist`
- Node.js: `22`

SPAのフォールバック、Service Workerのキャッシュ制御、静的アセットの長期キャッシュも`netlify.toml`に設定済みです。GitHub Pagesは使用しません。

### PWAの復旧

インストール版が起動できない場合、起動画面の「キャッシュを初期化」を選ぶと、Service Worker、Cache Storage、Firebaseのローカルデータを削除して最新版を取得します。この操作ではローカルのログイン状態や未同期データも削除される可能性があります。通常の更新では、Service Workerが新しいリリースを検知して自動的に切り替わります。

## データについて

初期コース形状は、OpenStreetMapから対象道路の名称・道路番号に一致するwayだけを取得し、リポジトリへ静的データとして収録しています。`npm run routes:refresh`で再生成できます。名称・道路番号・接続性・距離のいずれかが不正なら生成は失敗するため、一般ルーターが選んだ別道路を初期コースとして採用しません。

「範囲から提案」は、指定エリアのOpenStreetMap道路データをOverpass APIで取得し、私道・進入禁止・サービス道路などを除外した上で、道路形状の欠落、距離、カーブ密度、標高を検証して候補化します。通信障害時だけはFirestore内の公開済み・検証済みコースを代替候補として表示します。いずれの候補も自動公開せず、利用者が地点・道路形状を確認して保存してから投稿されます。

新規投稿コースの道路ルーティングは、既定ではOSRM公開サーバーを使用します。本格運用時は自前OSRM等を用意し、`VITE_ROUTING_API_URL`で切り替えてください。Google Mapsへ渡した後の経路はGoogle側で再計算されるため、ナビ開始前にコースとの一致を確認してください。

評価は、道路形状・標高・道路管理者などの公開情報から算出する「システム評価」と、Firebaseに保存された実走行ユーザー評価を分離しています。初期コースのユーザー評価件数は0件で、投稿が増えるとシステム評価を基準に統合評価へ反映します。

料金・営業時間・無料条件には情報源と確認日を表示します。ユーザー報告は確認待ちとして保存され、そのまま公開情報にはなりません。距離、標高、道路状況、規制情報の正確性や最新性を保証するものではないため、実走前には現地標識、道路管理者、各道路の公式情報を確認してください。

公道での危険運転や速度超過を推奨するアプリではありません。走行中の画面操作は避け、安全な場所で操作してください。

## バージョニング

[Semantic Versioning](https://semver.org/)に沿って `vMAJOR.MINOR.PATCH` タグで管理します。変更履歴は [CHANGELOG.md](./CHANGELOG.md) を参照してください。

## ライセンス

Copyright © 2026 touge-app contributors. All rights reserved.
