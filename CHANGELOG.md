# Changelog

このプロジェクトの主な変更はこのファイルに記録します。バージョン番号はSemantic Versioningに従います。

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
