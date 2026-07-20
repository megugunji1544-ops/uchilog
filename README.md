# うちログ Firebase共有版 v1.4.0

夫婦2人で家事・買い物をリアルタイム共有する静的Webアプリです。Firebase AuthenticationのGoogleログインとCloud Firestoreを使用します。

## 主な機能

- Googleログイン、ログアウト、ログイン状態保持
- `allowedUsers/{uid}` による利用者制限
- 買い物、家事、履歴、期限、ワンタップ項目のリアルタイム共有
- 記録の追加、編集、完了、削除
- 既存localStorageデータの重複防止付き移行
- ブラウザ内レシートOCR（画像はFirebaseへ送信・保存しません）
- JSONバックアップ、PWA対応、オフライン状態表示
- 未購入件数、新着商品、買い物リストの最終更新者・相対時刻表示
- スーパー向けの全画面「買い物モード」
- アプリ起動時の買い物状況案内
- 購入履歴を商品ごとにまとめ、在庫切れを買い物リストへ戻せる「おうちストック」

## ファイル構成

- `index.html`：画面構造
- `styles.css`：既存デザインと認証・同期UI
- `app.js`：表示と操作。Firebaseを直接操作しません
- `repositories.js`：Authentication、アクセス判定、events、settingsのRepository層
- `firebase-config.js`：このアプリ用Firebase設定
- `firebase-config.example.js`：設定例
- `firestore.rules`：Firestore Security Rules
- `firebase.json` / `.firebaserc.example`：Firebase Hosting・ルール配備設定例
- `sw.js`：PWAキャッシュ

## Firebaseプロジェクト設定

### 1. Webアプリ

Firebaseコンソールでプロジェクト `uchilog-app` を開きます。プロジェクト設定の「マイアプリ」でWebアプリを登録し、表示された設定を `firebase-config.js` に記載します。納品版には指定された設定を反映済みです。

FirebaseのWeb設定値はクライアント識別用であり秘密鍵ではありません。データ保護は必ずAuthenticationとSecurity Rulesで行います。

### 2. Google Authentication

1. Firebaseコンソールの「Authentication」→「始める」を選択
2. 「Sign-in method」でGoogleを有効化
3. サポートメールを設定して保存
4. 「Settings」→「Authorized domains」に公開先ドメインを追加

Googleログインは全環境で `signInWithPopup()` のみ使用します。iPhone SafariとGitHub Pagesの組み合わせで認証状態を引き継げないことがあるため、`signInWithRedirect()` と `getRedirectResult()` は使用していません。ログイン処理は「Googleでログイン」ボタンを押したときだけ開始します。

### 3. Firestore Database

1. 「Firestore Database」→「データベースの作成」
2. 利用地域を選択
3. 本番モードで作成
4. `firestore.rules` の内容を「ルール」へ貼り付けて公開

ルール反映前に本番利用しないでください。未ログイン・未許可ユーザーはevents、settings、migrationsを読み書きできません。利用者は自分の `allowedUsers/{uid}` だけを読み取れますが、自分自身を追加・変更・削除できません。

## 夫婦2人をallowedUsersへ登録する

1. 公開したアプリでGoogleログイン
2. 未許可画面の「UIDをコピー」を押す
3. Firebaseコンソールの「Firestore Database」→「データ」を開く
4. `allowedUsers` コレクションを作成
5. ドキュメントIDにコピーしたUIDを指定
6. 次のフィールドを追加

| フィールド | 型 | 値 |
|---|---|---|
| `displayName` | string | 利用者名 |
| `email` | string | Googleアカウントのメール |
| `role` | string | `member` |
| `active` | boolean | `true` |

`createdAt` は任意です。Firebaseコンソールで入力しにくければ省略できます。

7. アプリを再読み込みして本体が表示されることを確認
8. もう一人も同じ手順で登録

利用停止時は対象ドキュメントの `active` を `false` にします。

## データ構造

### `allowedUsers/{uid}`

利用許可情報です。本人は読み取りだけ可能です。

### `settings/default`

```json
{
  "householdName": "我が家",
  "quickItems": [
    {"text": "トイレ掃除", "category": "cleaning", "interval": null}
  ]
}
```

### `events/{eventId}`

```json
{
  "category": "shopping",
  "action": "wanted",
  "item": "ヨーグルト",
  "note": "",
  "performedAt": "2026-07-19",
  "interval": null,
  "createdAt": "serverTimestamp",
  "updatedAt": "serverTimestamp",
  "createdBy": "Firebase Authentication UID",
  "createdByName": "ユーザー表示名"
}
```

`action` は `wanted`（買いたい）、`bought`（購入済み）、`done`（家事等の完了）です。

### `userStates/{uid}`

```json
{
  "shoppingLastSeenAt": "serverTimestamp",
  "updatedAt": "serverTimestamp"
}
```

買い物の新着確認時刻です。本人のドキュメントだけ本人が読み書きできます。初回ログイン時に自動作成されるため、既存の買い物が一斉に新着になることはありません。

`settings/default`には買い物リスト全体の最終更新者・時刻として、`shoppingLastUpdatedBy`、`shoppingLastUpdatedByName`、`shoppingLastUpdatedAt`が必要に応じて追加されます。

### `migrations/{uid}`

端末データの移行完了マーカーです。途中失敗を完了扱いにしないため、全データと設定の保存後に作成します。

## Repository構造

- `authRepository`：ログイン、ログアウト、認証状態購読
- `accessRepository`：`allowedUsers/{uid}` の取得と許可判定
- `eventRepository`：`add`、`update`、`remove`、`subscribe`、`getAll`、移行
- `settingsRepository`：`settings/default` の購読と更新
- `userStateRepository`：本人の新着確認状態の初期化と更新

UIの `app.js` はlocalStorageやFirestoreへ共有データを直接保存しません。localStorageへの直接アクセスは旧データ読み取りと端末別移行済みフラグに限定しています。

## localStorage移行

許可ユーザーの初回ログイン時、`uchilog_v1` にデータがあれば移行確認を表示します。

- 「移行する」：eventsとワンタップ項目をFirestoreへ保存
- 「今はしない」：何も変更せず、次回も確認可能
- 各イベントのFirestoreドキュメントIDは、UIDと旧データIDから決定的に生成
- 途中で失敗して再実行しても同じドキュメントを上書きするため重複しない
- 全処理完了後だけ `migrations/{uid}` を作成
- 旧localStorageは自動削除せず、端末内バックアップとして保持

同じ端末の同じ旧データを夫婦それぞれが移行すると別UID由来のデータとして登録されます。移行操作は旧データを所有する一人だけが行ってください。

## レシートOCR

画像処理はTesseract.jsによりブラウザ内で行います。画像はFirestoreにもFirebase Storageにも保存しません。ユーザーが確定した商品名だけをeventsへ保存します。OCR失敗後も商品名を手入力できます。初回OCRにはTesseract.jsと言語データ取得のためインターネット接続が必要です。

## ローカル起動

ES Modulesを使用するため、`index.html` の直接開きではなくHTTPサーバーを使います。

```bash
python3 -m http.server 8080
```

`http://localhost:8080` を開きます。Firebase AuthenticationのAuthorized domainsに `localhost` があることを確認してください。

## 公開

Firebase Hosting例：

```bash
npm install -g firebase-tools
firebase login
cp .firebaserc.example .firebaserc
firebase deploy --only hosting,firestore:rules
```

同梱の `firebase.json` は本フォルダを公開ディレクトリとして使用し、READMEやRules等をHosting対象から除外します。SPAへの全URL書き換えは不要です。公開後、公開ドメインをAuthenticationのAuthorized domainsに追加します。

### GitHub Pagesへ反映する場合

1. `uchilog_firebase_v1.4.0.zip`を展開
2. 展開したファイルをGitHub Pagesの公開元へ上書き（`functions/`や`node_modules/`は不要）
3. `firebase-config.js` が本番設定になっていることを確認
4. Gitで変更をコミットしてpush
5. GitHubの「Settings」→「Pages」で公開元ブランチ／フォルダとデプロイ完了を確認
6. Firebase AuthenticationのAuthorized domainsに `<ユーザー名>.github.io` を登録
7. `firestore.rules`をFirebaseコンソールへ反映
8. iPhone Safariではページを閉じて開き直す
9. ホーム画面追加版はアプリを完全に終了して再度起動し、変わらなければSafariで公開URLを一度開いてから再起動

Service Workerのキャッシュ名は `uchilog-v1.4.0` です。更新版はインストール時に待機をスキップし、activate時に旧キャッシュを削除して既存ページを制御します。

## 動作確認

1. 未ログイン時にログイン画面だけが表示される
2. 未許可アカウントではデータが表示されず、名前・メール・UIDが確認できる
3. UIDコピー後、allowedUsersへ登録して再読み込みすると本体が表示される
4. 2台でログインし、片方の追加・編集・購入完了・削除が他方へ即時反映される
5. ログアウト後に共有データが消え、Firestoreリスナーが解除される
6. 未許可UIDでFirestore events/settingsの読み取りが拒否される
7. 旧データ移行を再実行しても重複しない
8. OCR後、Firestoreに画像やStorageオブジェクトが作られない
9. 機内モードでオフライン表示になり、画面が白くならない
10. ログアウト後にログイン画面へ戻り、自動ログインが始まらない
11. Popupを閉じた場合、エラーが表示されてログインボタンが再度有効になる
12. 未購入件数が追加・購入完了・削除で変化する
13. 相手の新規商品だけに新着が付き、買い物タブまたは買い物モード確認後に消える
14. 買い物の追加・編集・削除・購入完了で最終更新者と時刻が変わる
15. 買い物モードの連続タップが二重更新にならず、0件時に完了表示になる
16. 起動時案内が新着／未購入あり／未購入なしで切り替わる

ルールの拒否確認にはFirebase Emulator Suiteまたは別の未許可Googleアカウントを使用してください。

## 既知の制約

- 家庭は1つのみで、すべての許可ユーザーが同じeventsとsettingsを共有します
- allowedUsersの管理画面・招待コードはありません
- 管理操作はFirebaseコンソールで行います
- FirestoreのローカルキャッシュはSDK既定動作です。完全なオフライン書き込み保証を目的とした専用UIはありません
- Tesseract.jsとFirebase SDKをCDNから取得するため、初回表示にはインターネット接続が必要です
- JSON書き出しのFirestore TimestampはSDKの内部表現で出力される場合があります
- Safariの設定やコンテンツブロッカーがPopupを禁止している場合は、エラーを表示します。リダイレクト認証への自動切り替えは行いません

## 将来、家庭グループ方式へ変更する場合

`households/{householdId}` とメンバー情報を追加し、events/settingsを家庭配下へ移します。主な変更箇所は `repositories.js` のコレクションパス、`firestore.rules` の所属判定、`accessRepository` の許可モデル、ログイン後の家庭選択UI、localStorage移行先です。UI側はRepository APIを維持すれば変更を最小化できます。

## v1.4.0 変更点

- 「ストック」タブと「おうちストック」ページを追加
- 購入済み履歴を商品名ごとにまとめ、最後の購入日と購入者を表示
- 「在庫切れ」を押すと、その商品を買いたいものへ再追加
- すでに買いたいものにある商品は「買うものに追加済み」と表示し、重複登録を防止
- 追加処理中の連続タップを防止し、失敗時は日本語エラーを表示
- 新しいコレクションやFirestore Rules変更なし
- キャッシュ名を`uchilog-v1.4.0`へ更新

## v1.3.1 変更点

- 買い物案内カード全体をタップして買い物モードを開けるよう変更
- 「今日の家」カードを白背景へ変更
- 買い物案内カードを淡いピンク背景へ変更
- 買いたいもの件数を赤色で強調
- キャッシュ名を`uchilog-v1.3.1`へ更新

## v1.3.0 変更点

- 買いたいもの件数バッジと起動時案内を追加
- 相手が追加した未確認商品へ新着マークを追加
- ユーザー別確認状態`userStates/{uid}`を追加
- 買い物リストの最終更新者・相対時刻を追加
- 未購入品に集中できる全画面買い物モードを追加
- Push通知、FCM、Cloud Functionsは使用しない
- キャッシュ名を`uchilog-v1.3.0`へ更新

Firebaseコンソール側で必要な作業は、同梱`firestore.rules`の反映だけです。`userStates/{uid}`は許可ユーザーの初回利用時に自動作成されます。Blazeプラン、VAPIDキー、Cloud Functionsのデプロイは不要です。

### v1.3.0の変更ファイル

- `index.html`：件数・案内・買い物モードUI
- `styles.css`：新着表示とスマートフォン向け買い物モード
- `app.js`：件数、新着、相対時刻、買い物モード、起動時案内
- `repositories.js`：`userStateRepository`と買い物更新情報
- `firestore.rules`：本人専用`userStates/{uid}`ルール
- `sw.js`：v1.3.0キャッシュ
- `README.md`：設定・データ・公開手順

新規ファイルと削除ファイルはありません。通知関連ファイルと`functions/`はv1.2.2で削除済みで、v1.3.0にも含まれません。

## v1.2.2 変更点

- プッシュ通知機能を一時的に取り下げ
- 通知設定UI、Firebase Messaging、通知トークン、Cloud Functionsを削除
- Service Workerを通常のPWAキャッシュ機能だけに戻し、キャッシュ名を `uchilog-v1.2.2` に更新

以前のv1.2.0でCloud Functionsをデプロイ済みの場合は、コード更新とは別に次のコマンドで通知関数を停止してください。

```bash
firebase functions:delete notifyShoppingAdded notifyShoppingBought --region asia-northeast1
```

Firestoreに残っている`notificationTokens`コレクションは使用されません。不要であればFirebaseコンソールから削除できます。

## v1.2.1 変更点

- 「買いたいもの」「買ったもの」のカテゴリ選択欄がCSSの詳細度により表示される問題を修正
- 買い物フォームのカテゴリと目安日数をネイティブの`hidden`属性で確実に非表示化
- キャッシュ名を `uchilog-v1.2.1` に更新


## v1.1.4 変更点

- 「買いたいもの」「買ったもの」ではカテゴリ選択欄を表示しません。
- 買い物入力欄で、改行または読点・カンマ区切りによる複数項目の一括登録に対応しました。
- 編集時は従来どおり1件ずつ編集します。
