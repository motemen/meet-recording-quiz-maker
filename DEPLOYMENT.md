# Deployment Guide

This guide explains how to deploy the Meet Recording Quiz Maker to **App Engine Standard (single service)**.

## Prerequisites

- Google Cloud project created
- `gcloud` CLI installed
- Required Google APIs enabled:
  - App Engine Admin API
  - Cloud Scheduler API (for scheduled execution)
  - Google Drive API
  - Google Forms API
  - Cloud Firestore API
  - Secret Manager API

Enable them together:

```bash
gcloud services enable \
  appengine.googleapis.com \
  cloudscheduler.googleapis.com \
  drive.googleapis.com \
  forms.googleapis.com \
  firestore.googleapis.com \
  secretmanager.googleapis.com
```

## 1. Initial Setup

### Configure Project and Region

```bash
export PROJECT_ID="your-project-id"
export REGION="asia-northeast1"  # App Engine location

gcloud config set project $PROJECT_ID
```

## 2. Create Service Account

Create a runtime service account and grant the needed permissions.

```bash
export SERVICE_ACCOUNT_NAME="meet-quiz-maker"
export SERVICE_ACCOUNT_EMAIL="${SERVICE_ACCOUNT_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

gcloud iam service-accounts create $SERVICE_ACCOUNT_NAME \
  --display-name="Meet Recording Quiz Maker Service Account"

# Firestore access
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${SERVICE_ACCOUNT_EMAIL}" \
  --role="roles/datastore.user"

# Secret Manager access (if using secrets)
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${SERVICE_ACCOUNT_EMAIL}" \
  --role="roles/secretmanager.secretAccessor"
```

**Drive/Forms scopes**: Either configure domain-wide delegation for the service account or share the Drive folder/Forms with `${SERVICE_ACCOUNT_EMAIL}`.

### Using Domain-wide Delegation

1. Go to [Google Admin Console](https://admin.google.com/)
2. **Security > API controls > Domain-wide delegation**
3. Add the service account client ID with scopes:
   ```
   https://www.googleapis.com/auth/drive.readonly
   https://www.googleapis.com/auth/drive.file
   https://www.googleapis.com/auth/forms.body
   ```

### Using Folder Sharing

Share the target Drive folder with the service account and grant viewer permissions.

## 3. Initialize Firestore

If Firestore database doesn't exist, create it:

```bash
gcloud firestore databases create --location=$REGION
```

## 4. Secret Management (Recommended)

Keep API keys in Secret Manager.

```bash
# Create Gemini API key as a secret
echo -n "your-actual-gemini-api-key" | gcloud secrets create gemini-api-key \
  --data-file=- \
  --replication-policy="automatic"

# Add new versions as needed
echo -n "new-api-key-value" | gcloud secrets versions add gemini-api-key --data-file=-
```

Grant `roles/secretmanager.secretAccessor` to the runtime service account (see section 2).

## 5. Build Locally

```bash
pnpm install
pnpm run build  # produces dist/
```

`dist/` must exist because App Engine will run `npm run start` against the compiled output; it will not run `pnpm run build` for you.

## 6. Configure `app.yaml`

Set environment variables:

```yaml
env_variables:
  FIRESTORE_COLLECTION: "meetingFiles"
  GOOGLE_GENERATIVE_AI_API_KEY: "your-gemini-key"
  GOOGLE_DRIVE_FOLDER_ID: "optional-folder-id"
  GOOGLE_DRIVE_OUTPUT_FOLDER_ID: "optional-output-folder-id"
  GEMINI_MODEL: "gemini-2.5-flash"
  QUIZ_ADDITIONAL_PROMPT: ""
  GOOGLE_ALLOWED_DOMAIN: ""
  PORT: "8080"
```

For secrets, load values at deploy time instead of storing them in `app.yaml`:

```bash
gcloud app deploy app.yaml --project=$PROJECT_ID \
  --set-env-vars "GOOGLE_GENERATIVE_AI_API_KEY=$(gcloud secrets versions access latest --secret=gemini-api-key)"
```

## 7. Deploy to App Engine Standard

```bash
# First time only
gcloud app create --region=$REGION

# Deploy the service
gcloud app deploy app.yaml --project=$PROJECT_ID
```

Make sure the App Engine default service account (or the one configured for the service) has Drive, Forms, Firestore, and Secret Manager access as needed.

## 8. Verify Deployment

```bash
gcloud app browse --project=$PROJECT_ID

curl https://${PROJECT_ID}.an.r.appspot.com/healthz
```

## 9. Configure Cloud Scheduler (Periodic Execution)

Schedule `/tasks/scan`:

```bash
SERVICE_URL="https://${PROJECT_ID}.an.r.appspot.com"

gcloud scheduler jobs create http meet-quiz-scan \
  --location=$REGION \
  --schedule="0 * * * *" \
  --uri="${SERVICE_URL}/tasks/scan" \
  --http-method=POST \
  --oidc-service-account-email=$SERVICE_ACCOUNT_EMAIL \
  --oidc-token-audience=$SERVICE_URL
```

Example schedules:
- `0 * * * *` - Every hour at 0 minutes
- `*/30 * * * *` - Every 30 minutes
- `0 9 * * *` - Daily at 9:00 AM

Manual execution:

```bash
gcloud scheduler jobs run meet-quiz-scan --location=$REGION
```

## 10. Authentication Setup (Recommended)

Enable IAP on the App Engine default service to restrict access.

```bash
PROJECT_ID="your-project-id"

gcloud services enable iap.googleapis.com --project=$PROJECT_ID

gcloud iap web enable --resource-type=app-engine --project=$PROJECT_ID

gcloud iap web add-iam-policy-binding \
  --resource-type=app-engine \
  --project=$PROJECT_ID \
  --member="user:alice@example.com" \
  --role="roles/iap.httpsResourceAccessor"
```

An OAuth consent screen must be configured before enabling IAP.

## 11. Logs and Monitoring

```bash
gcloud app logs read --project=$PROJECT_ID --limit=50
gcloud app logs tail --project=$PROJECT_ID
```

View metrics and request stats in the [App Engine Console](https://console.cloud.google.com/appengine).

## 12. Troubleshooting

- Check build logs if deployment fails (`gcloud app deploy --verbosity=debug`)
- Verify service account permissions for Firestore, Secret Manager, Drive, and Forms
- Confirm Firestore collection exists
- If Drive/Forms access fails, ensure domain-wide delegation or folder sharing is configured correctly
