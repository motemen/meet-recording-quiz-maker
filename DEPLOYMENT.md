# Deployment Guide

本ガイドでは、Meet Recording Quiz Maker を Google Cloud Run にデプロイする手順を説明します。

## 前提条件

- Google Cloud プロジェクトが作成済みであること
- `gcloud` CLI がインストールされていること
- 必要な Google APIs が有効化されていること:
  - Cloud Run API
  - Cloud Scheduler API (定期実行する場合)
  - Google Drive API
  - Google Forms API
  - Cloud Firestore API

## 1. 初期設定

### プロジェクトとリージョンの設定

```bash
# プロジェクトIDを設定
export PROJECT_ID="your-project-id"
export REGION="asia-northeast1"  # 東京リージョン

# gcloud の設定
gcloud config set project $PROJECT_ID
```

### 必要な API の有効化

```bash
gcloud services enable \
  run.googleapis.com \
  cloudscheduler.googleapis.com \
  drive.googleapis.com \
  forms.googleapis.com \
  firestore.googleapis.com
```

## 2. サービスアカウントの作成

Cloud Run で使用するサービスアカウントを作成し、必要な権限を付与します。

```bash
# サービスアカウント名
export SERVICE_ACCOUNT_NAME="meet-quiz-maker"
export SERVICE_ACCOUNT_EMAIL="${SERVICE_ACCOUNT_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

# サービスアカウントの作成
gcloud iam service-accounts create $SERVICE_ACCOUNT_NAME \
  --display-name="Meet Recording Quiz Maker Service Account"

# Firestore のデータベース使用権限を付与
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${SERVICE_ACCOUNT_EMAIL}" \
  --role="roles/datastore.user"
```

**注意**: Google Drive と Forms の権限は、サービスアカウントに対してドメイン委任（Domain-wide Delegation）を設定するか、個別の Drive フォルダ/Forms に対して共有設定で権限を付与する必要があります。

### ドメイン委任を使用する場合

1. [Google Admin Console](https://admin.google.com/) にアクセス
2. **セキュリティ > API の制御 > ドメイン全体の委任** を開く
3. サービスアカウントのクライアント ID を追加し、以下のスコープを設定:
   ```
   https://www.googleapis.com/auth/drive.readonly
   https://www.googleapis.com/auth/drive.file
   https://www.googleapis.com/auth/forms.body
   ```

### フォルダ共有を使用する場合

対象の Drive フォルダをサービスアカウント（`${SERVICE_ACCOUNT_EMAIL}`）と共有し、閲覧権限を付与します。

## 3. Firestore の初期化

Firestore データベースが未作成の場合、以下のコマンドで作成します:

```bash
gcloud firestore databases create --location=$REGION
```

## 4. Cloud Run へのデプロイ

Cloud Run は pnpm に対応しているため、Dockerfile は不要です。ソースコードから直接デプロイできます。

### 環境変数の設定

デプロイ時に環境変数を設定します。まず、必要な値を環境変数として準備します:

```bash
# 必須の環境変数
export FIRESTORE_COLLECTION="meetingFiles"
export GOOGLE_GENERATIVE_AI_API_KEY="your-gemini-api-key"

# オプションの環境変数
export GOOGLE_DRIVE_FOLDER_ID="your-drive-folder-id"  # /tasks/scan を使う場合は必須
export GOOGLE_DRIVE_OUTPUT_FOLDER_ID="your-output-folder-id"  # 作成したフォームの保存先
export GEMINI_MODEL="gemini-2.5-flash"
export QUIZ_ADDITIONAL_PROMPT="Use Japanese"  # 必要に応じて
export GOOGLE_ALLOWED_DOMAIN="yourdomain.com"  # ドメインチェックが必要な場合
```

### デプロイコマンド

```bash
gcloud run deploy meet-quiz-maker \
  --source . \
  --region=$REGION \
  --platform=managed \
  --allow-unauthenticated \
  --service-account=$SERVICE_ACCOUNT_EMAIL \
  --set-env-vars="FIRESTORE_COLLECTION=${FIRESTORE_COLLECTION}" \
  --set-env-vars="GOOGLE_GENERATIVE_AI_API_KEY=${GOOGLE_GENERATIVE_AI_API_KEY}" \
  --set-env-vars="GOOGLE_DRIVE_FOLDER_ID=${GOOGLE_DRIVE_FOLDER_ID}" \
  --set-env-vars="GOOGLE_DRIVE_OUTPUT_FOLDER_ID=${GOOGLE_DRIVE_OUTPUT_FOLDER_ID}" \
  --set-env-vars="GEMINI_MODEL=${GEMINI_MODEL}" \
  --set-env-vars="QUIZ_ADDITIONAL_PROMPT=${QUIZ_ADDITIONAL_PROMPT}" \
  --set-env-vars="GOOGLE_ALLOWED_DOMAIN=${GOOGLE_ALLOWED_DOMAIN}" \
  --set-env-vars="PORT=8080" \
  --port=8080 \
  --timeout=300 \
  --memory=512Mi \
  --cpu=1
```

**注意**:
- `--allow-unauthenticated` は認証なしでアクセスを許可します。本番環境では、`--no-allow-unauthenticated` に変更し、Cloud IAP や独自の認証を設定することを推奨します。
- `--timeout=300` は 5 分のタイムアウトを設定（Gemini API の処理時間を考慮）
- 環境変数は `--set-env-vars` で個別に設定するか、`--env-vars-file` でファイルから読み込むことも可能です

### 環境変数をファイルから設定する場合

`env.yaml` ファイルを作成:

```yaml
FIRESTORE_COLLECTION: "meetingFiles"
GOOGLE_GENERATIVE_AI_API_KEY: "your-gemini-api-key"
GOOGLE_DRIVE_FOLDER_ID: "your-drive-folder-id"
GOOGLE_DRIVE_OUTPUT_FOLDER_ID: "your-output-folder-id"
GEMINI_MODEL: "gemini-2.5-flash"
QUIZ_ADDITIONAL_PROMPT: "Use Japanese"
GOOGLE_ALLOWED_DOMAIN: "yourdomain.com"
PORT: "8080"
```

デプロイコマンドを簡略化:

```bash
gcloud run deploy meet-quiz-maker \
  --source . \
  --region=$REGION \
  --platform=managed \
  --allow-unauthenticated \
  --service-account=$SERVICE_ACCOUNT_EMAIL \
  --env-vars-file=env.yaml \
  --port=8080 \
  --timeout=300 \
  --memory=512Mi \
  --cpu=1
```

## 5. デプロイの確認

デプロイが完了すると、サービスの URL が表示されます:

```
Service [meet-quiz-maker] revision [meet-quiz-maker-00001-xxx] has been deployed and is serving 100 percent of traffic.
Service URL: https://meet-quiz-maker-xxxxxxxxxxxx-an.a.run.app
```

動作確認:

```bash
export SERVICE_URL=$(gcloud run services describe meet-quiz-maker --region=$REGION --format='value(status.url)')

# ヘルスチェック（UI にアクセス）
curl $SERVICE_URL

# 手動処理のテスト
curl -X POST $SERVICE_URL/manual \
  -H "Content-Type: application/json" \
  -d '{"driveUrl": "https://docs.google.com/document/d/YOUR_FILE_ID/edit"}'
```

## 6. Cloud Scheduler の設定（定期実行）

`/tasks/scan` エンドポイントを定期的に実行するために Cloud Scheduler を設定します。

```bash
# App Engine アプリの作成（Cloud Scheduler の前提条件）
gcloud app create --region=$REGION 2>/dev/null || true

# スケジューラジョブの作成（毎時実行の例）
gcloud scheduler jobs create http meet-quiz-scan \
  --location=$REGION \
  --schedule="0 * * * *" \
  --uri="${SERVICE_URL}/tasks/scan" \
  --http-method=POST \
  --oidc-service-account-email=$SERVICE_ACCOUNT_EMAIL \
  --oidc-token-audience=$SERVICE_URL
```

スケジュール形式（cron 形式）:
- `0 * * * *` - 毎時 0 分
- `*/30 * * * *` - 30 分ごと
- `0 9 * * *` - 毎日 9 時

ジョブの手動実行:

```bash
gcloud scheduler jobs run meet-quiz-scan --location=$REGION
```

## 7. 認証の設定（推奨）

本番環境では、エンドポイントへのアクセスを制限することを推奨します。

### Cloud IAP を使用する場合

```bash
# Cloud Run サービスへの認証を必須にする
gcloud run services update meet-quiz-maker \
  --region=$REGION \
  --no-allow-unauthenticated

# IAP の設定（コンソールから実施）
```

### Cloud Scheduler から認証付きでアクセスする場合

上記の `--oidc-service-account-email` と `--oidc-token-audience` を使用することで、OIDC トークンによる認証が行われます。

## 8. ログとモニタリング

### ログの確認

```bash
gcloud run services logs read meet-quiz-maker --region=$REGION --limit=50
```

### リアルタイムログ

```bash
gcloud run services logs tail meet-quiz-maker --region=$REGION
```

### Cloud Console でのモニタリング

[Cloud Run Console](https://console.cloud.google.com/run) でメトリクス、リクエスト数、エラー率などを確認できます。

## 9. アップデート

コードを変更した後、同じデプロイコマンドを再実行するだけで新しいリビジョンがデプロイされます:

```bash
gcloud run deploy meet-quiz-maker \
  --source . \
  --region=$REGION
```

環境変数のみを更新する場合:

```bash
gcloud run services update meet-quiz-maker \
  --region=$REGION \
  --set-env-vars="GEMINI_MODEL=gemini-2.0-flash-exp"
```

## 10. トラブルシューティング

### デプロイが失敗する場合

- ビルドログを確認: Cloud Build のログで pnpm install や build のエラーを確認
- サービスアカウントの権限を確認
- API が有効化されているか確認

### 実行時エラー

- Cloud Run のログを確認:
  ```bash
  gcloud run services logs read meet-quiz-maker --region=$REGION --limit=100
  ```
- 環境変数が正しく設定されているか確認:
  ```bash
  gcloud run services describe meet-quiz-maker --region=$REGION
  ```
- Firestore のコレクションが存在するか確認

### Drive/Forms の権限エラー

- サービスアカウントにドメイン委任が設定されているか確認
- または、Drive フォルダがサービスアカウントと共有されているか確認
- スコープが正しく設定されているか確認

## 参考リンク

- [Cloud Run Documentation](https://cloud.google.com/run/docs)
- [Cloud Scheduler Documentation](https://cloud.google.com/scheduler/docs)
- [Service Account Domain-wide Delegation](https://developers.google.com/identity/protocols/oauth2/service-account#delegatingauthority)
