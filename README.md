# うちログ Firebase共有版 v1.1.3

夫婦2人で家事・買い物をリアルタイム共有する静的Webアプリです。Firebase AuthenticationのGoogleログインとCloud Firestoreを使用します。

## 主な機能

- Googleログイン、ログアウト、ログイン状態保持
- `allowedUsers/{uid}` による利用者制限
- 買い物、家事、履歴、期限、ワンタップ項目のリアルタイム共有
- 記録の追加、編集、完了、削除
- 既存localStorageデータの重複防止付き移行
- ブラウザ内レシートOCR（画像はFirebaseへ送信・保存しません）
- JSONバックアップ、PWA対応、オフライン状態表示

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

### `migrations/{uid}`

端末データの移行完了マーカーです。途中失敗を完了扱いにしないため、全データと設定の保存後に作成します。

## Repository構造

- `authRepository`：ログイン、ログアウト、認証状態購読
- `accessRepository`：`allowedUsers/{uid}` の取得と許可判定
- `eventRepository`：`add`、`update`、`remove`、`subscribe`、`getAll`、移行
- `settingsRepository`：`settings/default` の購読と更新

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

1. ZIPを展開し、`uchilog_app_v1.1.3` 内の公開ファイルをGitHub Pagesの公開元へ上書き
2. `firebase-config.js` が本番設定になっていることを確認
3. Gitで変更をコミットしてpush
4. GitHubの「Settings」→「Pages」でデプロイ完了を確認
5. Firebase AuthenticationのAuthorized domainsに `<ユーザー名>.github.io` を登録
6. iPhone Safariでページを一度閉じて開き直す

Service Workerのキャッシュ名は `uchilog-v1.1.3` です。更新版はインストール時に待機をスキップし、activate時に旧キャッシュを削除して既存ページを制御します。それでも旧画面が残る場合はページを閉じて開き直してください。

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
