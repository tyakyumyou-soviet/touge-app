# Changelog

このプロジェクトの主な変更はこのファイルに記録します。バージョン番号はSemantic Versioningに従います。

## [1.1.1] - 2026-08-13

### Fixed

- インストール済みPWAで古いHTMLと新しいJSが混在しないようService Workerを即時更新
- 古いWorkboxキャッシュを自動削除
- React起動前の読込エラーでも復旧画面を表示
- Service Worker、Cache Storage、Firebase IndexedDBを初期化できる修復操作を追加
- WebGL非対応・初期化失敗時にアプリ全体を落とさず地図部分だけ案内表示
- オフライン状態とPWA登録失敗を画面に表示
- Netlifyで古いJSが見つからない場合にHTMLを誤配信せず、復旧可能な404を返すよう修正

## [1.1.0] - 2026-08-13

### Added

- 選択コース専用の3D地形プレビュー、地形強調、俯瞰リセット
- 道路管理者を情報源とする料金・営業時間・無料条件表示
- 日時・条件・情報源URL付きの無料開放／料金変更報告
- 新規コース登録時の道路ルーティング

### Changed

- 初期4コースをOpenStreetMapベースの詳細道路形状へ置き換え
- Google Maps連携の経由点をコース全体から均等に選択

## [1.0.2] - 2026-08-13

### Changed

- GitHub Pages公開を廃止
- Netlify向けのビルド、SPAリダイレクト、キャッシュ設定を追加
- ViteとPWAのベースパスをNetlify向けのルートパスへ統一

## [1.0.1] - 2026-08-12

### Fixed

- GitHub Pagesの `/touge-app/` サブパスでアセットを正しく読み込めるよう修正
- `gh-pages`ブランチへGitHub Pagesを公開するコマンドを追加
- レンダリングエラー時に白画面ではなく復旧案内を表示

## [1.0.0] - 2026-08-12

### Added

- PC・タブレット・スマートフォン対応のレスポンシブUI
- インストール・キャッシュ・更新通知に対応したPWA
- 2D地図と標高タイルを使った3D地形ビュー
- 東京・神奈川・静岡の初期サンプルコース
- コース検索、都県フィルター、評価軸別ソート
- 標高プロファイルと項目別評価
- Google Mapsへの外部ナビ連携
- Firebase Authentication、Cloud Firestore、Cloud Storage構成
- コース登録、公開範囲、評価、共有機能
- Firestore / Storage Security Rules
- 単体テストと本番ビルド検証
