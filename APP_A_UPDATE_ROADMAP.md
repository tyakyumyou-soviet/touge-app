# App A 調査を踏まえた Touge Drive Explorer 更新計画

- 作成日: 2026-09-07
- 根拠: [APP_A_RESEARCH_REPORT.md](./APP_A_RESEARCH_REPORT.md)
- 方針: App A のコード・固有データ・正確な評価式は複製せず、観測した UX 原則を現アプリの強みと独自ロジックで再設計する

## 1. 目標

「機能が多いアプリ」から、**初見でも30秒以内に走りたい道を見つけ、根拠を理解し、次の行動へ進めるアプリ**へ引き上げる。

主要成果指標:

- 初回表示から最初のコース選択までの中央値を30秒以内
- 検索結果選択後、カードと地図の同期完了を300ms以内（カメラアニメーション除く）
- モバイル主要操作のタップ領域44×44px以上
- 200件表示時もDOMカード数を30以下
- Liteモードで中級Android相当の地図操作を概ね30fps以上
- 3D初回操作可能まで3秒以内を目標。超える場合は進捗と2Dフォールバックを表示
- 主要フローのキーボード操作、200%ズーム、reduced-motionに対応
- 位置情報・外部送信は実行直前の明示説明を100%通過

指標は実機計測でベースラインを取り、妥当なら調整する。

## 2. 守るべき既存価値

次は削らず、探索UIから段階的に到達できるようにする。

- 7軸評価とユーザー評価
- コース投稿・編集
- コミュニティと友達
- ルート作成・並べ替え・推薦
- 天候、交通、料金、ユーザー報告
- Overview、Driving Preview、Route Model の3D資産
- OpenFreeMapベースの独自地図表現
- Firebase認証・同期
- PWA/offline

## 3. 優先順位

### P0: 探索体験の統合

最初に実装する。ここが完成するまで大きな新機能を増やさない。

- 単一の ExploreState
- 地図主役の探索シェル
- 横断検索オーバーレイ
- 目的別並び替えプリセット
- コンパクト比較カード
- リスト仮想化
- カード・地図・検索の双方向同期
- モバイル3スナップシート
- 空、読込、エラー、0件状態の統一

### P1: 地図の理解しやすさと描画予算

- スコア帯のルート色
- 上位順位マーカー
- 選択ルートのハロー
- 地図レイヤーメニュー
- 現在地距離リング
- Lite/Quality/Auto
- 地図・3Dの遅延ロード
- 端末能力とFPSの観測

### P2: 3Dの入口を整理

- 全3D機能を一つの入口へ集約
- 初期HUDを「指標」「視点」「構造物」に限定
- コーナー/勾配色分け
- 真上/斜め/側面プリセット
- 詳細モードで既存機能を展開
- Worker化とメモリ解放

### P3: データ分析と説明可能ランキング

- 区間データモデル
- 曲率、勾配、標高、幅員、景観、交通、路面の信頼度
- 目的別プリセット
- 上位寄与要因
- 欠損/鮮度表示
- 評価式バージョン管理

### P4: 運転前後の短い導線

- 入口/出口の明示
- 外部ナビアプリ選択
- 送信前の安全・プライバシー確認
- 路面確認
- 走行済み候補と手動確認
- オフライン持ち出し範囲

### P5: 高度な地図演出・追加データ

- 航空写真切替
- 朝/昼/夕/夜テーマ
- 道の駅、道路種別、居住域、構造物等
- ルート形状サムネイル
- 独自データパイプライン

P5はライセンス、費用、転送量、保守工数を確認してから着手する。

## 4. フェーズ別実装計画

## Phase 0: 計測と設計固定

目的: 改修前の速さ・使いやすさを数値化し、後戻りを防ぐ。

作業:

- 主要フローを Playwright で記録
- Lighthouse/Performance traceをモバイル・デスクトップで採取
- Axeによる既知違反一覧
- 100/500/1000件の合成データで一覧・地図ベンチマーク
- `ExploreState` と派生セレクターの仕様化
- デザインtokenとレスポンシブ仕様の固定
- 解析イベントのデータ辞書を先に定義

成果物:

- `docs/ux/explore-state.md`
- `docs/ux/explore-flows.md`
- `docs/performance/baseline.md`
- 主要画面のスクリーンショット差分

受け入れ条件:

- 初回、検索、選択、フィルター、3D開始を自動テストで再現できる
- 計測に位置座標、検索原文、ユーザー投稿本文を送らない

## Phase 1: Explore Shell

対象候補:

- `src/App.tsx`
- `src/components/CourseList.tsx`
- `src/components/MapView.tsx`
- 新規 `src/components/explore/ExploreShell.tsx`
- 新規 `src/components/explore/SearchOverlay.tsx`
- 新規 `src/components/explore/FilterChips.tsx`
- 新規 `src/components/explore/SortPresetMenu.tsx`
- 新規 `src/components/explore/CourseCompactCard.tsx`
- 新規 `src/state/exploreState.ts`

作業:

1. 既存状態を壊さず `ExploreState` adapterを作る。
2. フィルターと並び替えを純粋関数へ移す。
3. `visibleCourseIds` と `rankByCourseId` を一度だけ計算する。
4. 検索結果、カード、地図マーカーを同じIDで結ぶ。
5. カード選択時に `scrollToItem` と `fitBounds` を発火する。
6. 地図選択時にカードを実体化してからスクロールする。
7. 200件以上でも安定する仮想リストを導入する。
8. モバイルのpeek/half/fullをCSS変数と明示的stateで制御する。
9. シート状態に合わせて地図UIのsafe insetを更新する。

カード初期表示:

- 順位
- 名称
- 地域
- 距離/推定時間
- 総合または選択プリセット値
- 特徴2つ
- 標高差
- ユーザー評価と件数
- 保存、詳細、3Dの3操作まで

追加操作はメニュー/詳細へ送る。視覚ボタンが小さくてもヒット領域は44px以上にする。

受け入れ条件:

- 検索候補を選ぶと、オーバーレイ閉鎖、カード移動、地図fit、選択ハローが一続きで動く
- マーカー選択でも同じ結果になる
- 並び替えでカード順位とマーカー番号が一致する
- 0件時に条件解除ボタンが出る
- 200件でDOMカード30以下
- スクロール復元とブラウザBackが自然に動く

## Phase 2: Ranking UX

対象候補:

- `src/lib/course.ts`
- 新規 `src/lib/ranking.ts`
- `src/types.ts`
- `src/components/CourseList.tsx`
- `src/components/MapView.tsx`

独自プリセット案:

| ID | 表示名 | 主な入力 | 説明例 |
|---|---|---|---|
| balanced | 総合おすすめ | 既存総合、信頼度、ユーザー評価 | 特徴のバランスがよい |
| technical | 切り返し重視 | 曲率分布、急コーナー密度、連続性 | 操作量の多い区間が続く |
| flow | 流れ重視 | 中曲率、曲率変化の滑らかさ、停止要因 | リズムよく走りやすい |
| elevation | 起伏重視 | 累積上昇、標高差、勾配区間 | 上り下りを楽しみやすい |
| scenery | 景観重視 | 景観タグ、開放度、建物密度、レビュー | 見晴らしを期待しやすい |

計算規則:

- 各特徴量は0〜1に正規化
- 外れ値上限をpercentileで抑える
- 欠損には値ではなく信頼度を持たせる
- ユーザー値は既存の5票相当事前値を継続し、UIで説明する
- 同点は信頼度、レビュー母数、安定IDの順で決定
- `rankingVersion` を保存
- 「なぜ上位か」を最大2理由返す

受け入れ条件:

- 同じデータとversionで順位が再現可能
- 欠損が多い道路が不当に1位にならない
- プリセット名だけでユーザー意図が分かる
- 主要な順位について理由を表示できる
- 単体テストに境界、同点、欠損、外れ値、少数レビューを含む

## Phase 3: Map Presentation & Performance

対象候補:

- `src/components/MapView.tsx`
- `src/lib/mapStyle.ts`
- 新規 `src/components/map/MapLayerMenu.tsx`
- 新規 `src/components/map/MapDisplaySettings.tsx`
- 新規 `src/lib/mapPerformance.ts`

作業:

- 表示コースを単一GeoJSON sourceへ統合し、feature-stateで hover/selected を表現
- 順位帯を式で色分け
- 選択線をoutline/halo/coreの3層に分ける
- 上位N件だけHTML markerまたはsymbol layerで番号表示
- 距離リングを測地線生成し、ズームとシートsafe areaに追従
- レイヤーmenuを地図上の一箇所へ集約
- MapLibre/3D/Firebaseのroute-level lazy importを点検
- Auto/Lite/Qualityのbudgetを定義
- 地図を閉じた時、3Dを閉じた時のGPU資産解放をテスト

Auto判定例:

```ts
const constrained =
  (navigator.deviceMemory && navigator.deviceMemory <= 4) ||
  navigator.hardwareConcurrency <= 4 ||
  window.devicePixelRatio >= 3;
```

これは初期推奨にのみ使い、実測フレーム時間で降格し、ユーザー設定で上書きできるようにする。

受け入れ条件:

- 選択更新のたびにMapLibre source/layerを作り直さない
- Liteではterrain、大気、重い注釈が無効
- Qualityでも非表示カードのサムネイルを生成しない
- 連続パン中にReact stateを毎フレーム更新しない
- WebGL context lostから復帰、または明確な2Dフォールバック

## Phase 4: Unified 3D

対象候補:

- `src/components/Course3DView.tsx`
- `src/components/CourseDetail.tsx`
- 新規 `src/components/course3d/ThreeDToolbar.tsx`
- 新規 `src/workers/courseMesh.worker.ts`

初期HUD:

- 指標: コーナー / 勾配
- 視点: 斜め / 真上 / 側面
- 構造物: on/off
- 閉じる、リセット

詳細drawer:

- 既存Overview
- Driving Preview
- Route Model
- 等高線、区間表、凡例詳細
- 再生速度等の高度設定

色はTouge Drive Explorerのブランドに合わせ、色覚多様性に配慮する。赤/緑だけで区別せず、線種、太さ、ラベルを併用する。

受け入れ条件:

- 初めて開いたユーザーが説明なしでコーナー/勾配を切り替えられる
- 側面表示で上り下りが読み取れる
- reduced-motion時に自動カメラ移動を抑制
- 3D非対応・低性能端末でも標高プロファイルを表示
- close後にCanvas、listener、worker、textureを解放

## Phase 5: Data Pipeline

提案モデル:

```ts
type CourseAnalysisV2 = {
  version: string;
  generatedAt: string;
  sourceRevisions: Record<string, string>;
  geometry: { encoded: string; pointCount: number };
  distanceM: number;
  elevation: {
    gainM: number | null;
    lossM: number | null;
    rangeM: number | null;
    samples?: number[];
    confidence: number;
  };
  curvature: {
    hairpinCount: number | null;
    sharpRatio: number | null;
    mediumRatio: number | null;
    flowContinuity: number | null;
    confidence: number;
  };
  context: {
    roadWidthM: number | null;
    toll: boolean | null;
    speedLimits: number[];
    trafficClass: 'low' | 'medium' | 'high' | 'unknown';
    tunnelCount: number | null;
    bridgeCount: number | null;
    settlementDensity: number | null;
  };
  scores: Record<string, { value: number; confidence: number; reasons: string[] }>;
};
```

作業:

- 生座標、平滑化座標、表示用簡略座標を分離
- 曲率はサンプリング間隔を正規化して算出
- 標高はノイズ除去後に累積上昇を算出
- 区間境界にhysteresisを入れ、短い反転をまとめる
- 出典・更新日・信頼度を各分析へ紐付ける
- 地域ファイルと全国軽量検索インデックスを別生成
- 差分配信用manifestにhashとschema versionを持たせる

注意:

- App A のデータファイルやスコア係数を取り込まない
- OSM/ODbL派生物の扱いを法務・ライセンス観点で決定
- GSI等のタイルをカード画像へ焼き込んで再配布できるか確認
- 速度、交通、規制は現況と異なる可能性を常に表示

## Phase 6: PWA / Offline

対象候補:

- `vite.config.ts`
- Service Worker設定
- 新規 `src/lib/offlineRegion.ts`

キャッシュを用途で分ける。

| 資産 | 戦略 | 上限 |
|---|---|---|
| app shell | precache | build manifest |
| JS/CSS/fonts | stale-while-revalidate/cache-first | versioned |
| コース検索index | network-first | 旧版1〜2 |
| 地域データ | network-first + explicit offline save | 件数/容量上限 |
| 地図タイル | cache-first | LRU + quota監視 |
| DEM | 明示ダウンロードまたは短期cache | 端末別上限 |
| API/auth | no-store | なし |
| ユーザー投稿画像 | browser HTTP cache中心 | SWで無制限保存しない |

受け入れ条件:

- キャッシュ容量と削除UIを表示できる
- データversion不一致で壊れず、旧版へフォールバック
- API/auth/個人データを共有キャッシュへ入れない
- iOS quota eviction後も安全に再取得
- オフライン時にできること/できないことが明確

## Phase 7: Navigation & Trip Loop

作業:

- 各コースに推奨入口/出口と進行方向を定義
- 「ルートを作る」と「入口までナビ」を分ける
- Google Maps等への送信前に、安全とデータ送信先を説明
- 失敗時は入口座標コピー、地図で開くへフォールバック
- 帰還時に「走行しましたか？」を提示
- 自動走行済みは確定せず候補にする
- 保存、走行済み、レビュー投稿を1つの完了シートにまとめる

受け入れ条件:

- 位置許可拒否でも入口表示/コピーができる
- 外部アプリから戻っても編集中ルートを失わない
- 二重走行記録を作らない
- 安全同意versionを更新可能

## 5. UI仕様

### 5.1 デスクトップ

- 左探索パネル: 392pxを基準、最小360px、最大440px
- 地図: 残り全域
- 上部: 検索、地域、並び替え、フィルター件数
- パネルheaderはsticky
- カードは1画面4件以上を目安
- 選択時のみ詳細peekを地図下またはカード内に展開

### 5.2 モバイル

- 地図全画面
- 検索バー上部safe-area対応
- チップは横スクロール、末尾フェードと「すべて」導線
- シート: peek 64px、half 44dvh、full 82dvhを初期候補
- ドラッグハンドル自体のヒット領域44px
- 地図コントロールは `--sheet-occlusion` で移動
- キーボード表示時はfull sheetをviewportに再計算

### 5.3 状態表現

必要な状態:

- 初回未選択
- 地域読み込み中
- 地域読み込み失敗/再試行
- 検索入力前/入力中/0件
- 結果あり/フィルター0件
- コース選択
- 地図データだけ遅延
- 3D生成中/失敗/非対応
- オフライン・旧データ表示
- 位置権限未決定/拒否/取得中/誤差大

単一の汎用spinnerで済ませず、何を待っているかを短く表示する。

## 6. アクセシビリティ要件

- viewport zoomを禁止しない
- 主要ターゲット44×44px以上
- map以外ですべての主要情報を取得可能
- card, marker, search resultは同じアクセシブル名称
- 並び替え/フィルターは現在値を読み上げる
- sheetをdialog相当として扱う場合はfocus管理とEscapeを実装
- 地図キーボード操作と「一覧へ移動」を用意
- 色だけで順位・勾配・状態を伝えない
- WCAG AAコントラスト
- 200%ズームで操作を失わない
- `prefers-reduced-motion`、`forced-colors`、`prefers-contrast`をテスト
- 3D Canvasには同内容のテキスト要約を付ける

## 7. 性能予算

初期案:

- 初期ルートに3D実装を含めない
- Firebaseのコミュニティ機能は探索初期表示から遅延
- map chunkのgzip 300kB以下を維持し、必要ならstyle/specを分割
- main gzip 170kB以下
- 1操作で50ms超のLong Taskを常態化させない
- 画面外カードサムネイル生成0
- サムネイル生成は同時2以下、Liteは1
- MapLibre source更新はrequestAnimationFrameで集約
- 地域データは圧縮後サイズとparse時間をCIで監視
- 3D texture/geometryのGPU推定量を開発表示

現在のbuildはmap約1,053kB、Firebase約640kB、main約484kB（非gzip）なので、単なる総量削減より「初期ルートでいつ必要か」を改善する。

## 8. テスト計画

### 単体

- ranking normalization、欠損、外れ値、同点
- filter composition
- stable course key
- sheet snap selection
- map display budget判定
- geometry simplificationと区間対応
- cache version migration

### コンポーネント

- 検索ハイライトとキーボード選択
- Card選択とaria-current
- フィルター件数
- sort説明
- 0件解除
- 3Dフォールバック

### E2E

- 初回 → 地域 → 検索 → 選択 → 3D
- マーカー → カード同期
- 複数フィルター → 0件 → 解除
- viewport 390/768/1440
- オフライン再訪
- 位置拒否
- 外部ナビ直前まで
- ログイン前後の走行済み同期

### 視覚回帰

- 通常/ダークまたは時間帯
- Lite/Quality
- peek/half/full
- selected/hovered/visited
- loading/error/offline
- 200%zoom/forced colors

### 性能

- 200/1000コース
- 連続フィルター入力
- 高DPIと低メモリ端末
- 3D open/closeを10回
- WebGL context lost
- SW cache quota不足

## 9. 計測イベント

最小限のイベント:

- `explore_opened`
- `region_loaded`（都道府県IDのみ）
- `search_submitted`（原文を送らず、文字数と結果数）
- `course_selected`（内部ID、入口種別）
- `sort_changed`
- `filter_changed`
- `sheet_snap_changed`
- `map_mode_changed`
- `three_d_opened` / `three_d_ready` / `three_d_failed`
- `navigation_intent`（実行前。精密位置は送らない）
- `offline_region_saved`

禁止/要同意:

- 生の現在地
- 精密な移動履歴
- 検索原文
- レビュー本文
- セッション録画上の地図位置

KPIは「クリック数を増やす」ではなく、選択までの時間、検索0件率、選択後離脱、3D準備時間、ナビ意図到達率、エラー率を使う。

## 10. リスク登録簿

| リスク | 影響 | 対策 |
|---|---|---|
| App A風に寄せすぎて独自性喪失 | ブランド/IP | 機能原則のみ採用、色・文言・式・構成を独自化 |
| 航空写真/DEMの利用条件 | 法務/費用 | 出典ごとに規約確認、切替可能なprovider層 |
| map/3Dによる低端末不調 | 離脱 | Auto/Lite、実測降格、2D fallback |
| 機能をカードへ詰め込み直す | UX悪化 | 初期/選択/詳細の情報予算を固定 |
| ランキングへの過信 | 安全/信頼 | 理由、信頼度、鮮度、現況優先表示 |
| 位置情報と分析の結合 | プライバシー | 収集最小化、同意分離、録画マスク |
| 仮想化と可変高カードの不具合 | 操作性 | 高さ固定中心、選択展開は別pane |
| SWの古いデータ混在 | 誤表示 | schema/version/hash、atomic swap |
| 既存機能の導線消失 | 回帰 | 機能棚卸し、旧UIへの一時fallback |

## 11. 実装タスク分割

将来のエージェントには、次の単位で依頼する。複数フェーズを一度に実装させない。

### Task A: ExploreState抽出

依頼文の核:

> 現行機能を変えず、検索・選択・hover・並び替え・フィルター・sheet snap・map modeを一つの型付き状態へ集約してください。派生リストと順位は純粋関数にし、既存テストを維持した上で境界テストを追加してください。

### Task B: 一覧仮想化とコンパクトカード

> CourseListを可変データ件数に耐える仮想リストへ置き換え、比較用カードを実装してください。表示情報と操作数は本計画のPhase 1に従い、44pxターゲット、キーボード選択、選択カードへのscrollToItemを含めてください。

### Task C: 検索オーバーレイ

> 名称・都道府県・市町村を一つの検索UIで扱い、部分一致ハイライト、キーボード操作、0件状態、地域ロードを実装してください。結果選択をExploreStateへ接続し、地図とカードを同期してください。

### Task D: 地図同期とスコア表現

> visible course GeoJSONを単一sourceで管理し、feature-stateで選択・hover、順位帯で色、上位マーカー、選択haloを実装してください。レイヤー再生成を避け、MapLibreイベントlistenerのリークテストを追加してください。

### Task E: モバイルシート

> peek/half/fullの明示state、pointer/touch/keyboard操作、safe-area、map control occlusionを実装してください。実機相当viewportのE2Eとreduced-motionを含めてください。

### Task F: 3D統合HUD

> 既存3D機能を削除せず、初期HUDをコーナー/勾配、3視点、構造物へ簡略化してください。詳細drawerから既存各モードへ到達可能にし、close時のGPU/worker解放を検証してください。

### Task G: PWA地域キャッシュ

> app shell、地域データ、地図タイル、APIを別戦略へ分け、容量上限、version migration、offline説明を実装してください。認証/個人データはキャッシュしないでください。

## 12. PR運用

各PRの必須項目:

- 目的と対象ユーザージョブ
- 変更前後の画面または操作動画
- desktop/mobile/keyboardの確認
- 性能値の差分
- 追加/変更した解析イベント
- 位置・個人情報への影響
- ライセンス/attributionへの影響
- `npm run check` の結果
- rollback方法

1 PR は1つのユーザーフローまたは1つの技術基盤に限定する。大規模な見た目変更とランキング式変更を同じPRへ入れない。

## 13. 最初の3リリース案

### Release 1: Explore Foundation

- ExploreState
- 検索オーバーレイ
- 5プリセットのUI。初期は既存値から計算
- カード/マーカー同期
- 仮想リスト
- 3スナップシート
- a11y基礎

### Release 2: Visual Intelligence

- 順位帯ルート色
- 選択halo
- 上位マーカー
- 距離リング
- レイヤーメニュー
- Auto/Lite/Quality
- 地図性能計測

### Release 3: Understand & Go

- 3D統合HUD
- コーナー/勾配区間色
- 入口/出口
- ナビ前安全・プライバシー確認
- 走行済み候補
- 地域オフライン保存

## 14. 完了定義

この計画の第一段階は、次がすべて満たされた時に完了とする。

- 初見ユーザーが地域または検索から候補を出せる
- 並び替えの意味を説明なしで選べる
- 一覧と地図の順位・選択が常に一致する
- モバイルで地図と一覧を片手で切り替えられる
- 選択道路の形状、起伏、コーナー傾向、評価根拠を1分以内に理解できる
- 低性能端末には軽量表示が提供される
- 主要操作がキーボード、ズーム、reduced-motionで使える
- 位置情報の送信先と目的が事前に分かる
- 既存の投稿・評価・コミュニティ・ルート機能への導線が残る
- 全テストとproduction buildが成功する

## 15. 実装進捗（2026-09-16）

今回、後続エージェントが継続しやすいように以下を実装した。

- 設定画面に「端末に合わせる／ライト／ダーク」の外観モードを追加
- 外観モードは選択直後に反映し、端末ローカルとログイン中プロフィールの両方へ保存
- `system` 選択時は `prefers-color-scheme` の変化を監視してリアルタイム追従
- 初期HTMLで保存済みテーマを先に適用し、React起動前のライト表示フラッシュを防止
- UIの主要サーフェス、フォーム、モーダル、モバイルシート、地図コントロール、ポップアップをダーク配色化
- MapLibreのベース地図をテーマ対応。地面、土地利用、森林、水域、河川、道路、建物、境界、地名・道路ラベルを切替
- 地形陰影、コース影、選択グロー、等高線、作成中マーカー、検索地点、推薦地点、現在地、注釈もテーマに合わせて再配色
- 地図のテーマ変更は `setStyle` を使わずpaint propertyだけ更新し、コースsource・選択状態・カメラ・3D地形を保持
- モバイルのモーダル型ボトムシートは、全開時にすりガラス背景をタップすると中間（画面高58%）へ1段だけ縮小。中間状態の背景タップは無効とし、誤って閉じたり最小化したりしない
- コース一覧・ルートビルダー・コミュニティ設定など複数シートが同時に存在する場合、開いているシートは常に1枚だけに統制。他は自動で最小化して背面へ隠し、全シートが最小化された時だけ54pxの識別可能なタブとして下端へ縦に段積み表示
- 地図上のルート表示は、公式／自分／フレンドの初期表示、名前検索、タブ、個別チェック、一括表示・非表示、デフォルト復帰、フレンド名・リスト絞り込みへ更新
- パーソナライズは最大3特徴、プリセット、重み調整方式へ更新し、未選択特徴が順位計算へ混入しないよう修正

主な実装箇所は `src/components/ThemeSettings.tsx`、`src/lib/theme.ts`、`src/lib/mapStyle.ts`、`src/components/MapView.tsx`、`src/styles.css`。テーマ解決と地図の明暗差には自動テストを追加した。
