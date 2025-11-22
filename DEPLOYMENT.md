# Deployment Guide

This guide explains how to deploy the Meet Recording Quiz Maker to Google Cloud Run.

## Prerequisites

- Google Cloud project created
- `gcloud` CLI installed
- Required Google APIs enabled:
  - Cloud Run API
  - Cloud Scheduler API (for scheduled execution)
  - Google Drive API
  - Google Forms API
  - Cloud Firestore API
  - Secret Manager API

## 1. Initial Setup

### Configure Project and Region

```bash
# Set project ID
export PROJECT_ID="your-project-id"
export REGION="asia-northeast1"  # Tokyo region

# Configure gcloud
gcloud config set project $PROJECT_ID
```

### Enable Required APIs

```bash
gcloud services enable \
  run.googleapis.com \
  cloudscheduler.googleapis.com \
  drive.googleapis.com \
  forms.googleapis.com \
  firestore.googleapis.com \
  secretmanager.googleapis.com
```

## 2. Create Service Account

Create a service account for Cloud Run and grant necessary permissions.

```bash
# Service account name
export SERVICE_ACCOUNT_NAME="meet-quiz-maker"
export SERVICE_ACCOUNT_EMAIL="${SERVICE_ACCOUNT_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

# Create service account
gcloud iam service-accounts create $SERVICE_ACCOUNT_NAME \
  --display-name="Meet Recording Quiz Maker Service Account"

# Grant Firestore database user permission
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${SERVICE_ACCOUNT_EMAIL}" \
  --role="roles/datastore.user"

# Grant Secret Manager secret accessor permission (if using Secret Manager)
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${SERVICE_ACCOUNT_EMAIL}" \
  --role="roles/secretmanager.secretAccessor"
```

**Note**: For Google Drive and Forms permissions, you need to either configure Domain-wide Delegation for the service account, or share individual Drive folders/Forms with the service account.

### Using Domain-wide Delegation

1. Access [Google Admin Console](https://admin.google.com/)
2. Navigate to **Security > API controls > Domain-wide delegation**
3. Add the service account's client ID and configure these scopes:
   ```
   https://www.googleapis.com/auth/drive.readonly
   https://www.googleapis.com/auth/drive.file
   https://www.googleapis.com/auth/forms.body
   ```

### Using Folder Sharing

Share the target Drive folder with the service account (`${SERVICE_ACCOUNT_EMAIL}`) and grant viewer permissions.

## 3. Initialize Firestore

If Firestore database doesn't exist, create it:

```bash
gcloud firestore databases create --location=$REGION
```

## 4. Secret Management (Recommended)

For sensitive information like API keys, it's recommended to use **Secret Manager** instead of setting them directly as environment variables.

### Create Secrets in Secret Manager

```bash
# Create Gemini API key as a secret
echo -n "your-actual-gemini-api-key" | gcloud secrets create gemini-api-key \
  --data-file=- \
  --replication-policy="automatic"

# Create other secrets as needed
# echo -n "your-value" | gcloud secrets create secret-name --data-file=- --replication-policy="automatic"
```

### Verify Secrets

```bash
# List secrets
gcloud secrets list

# View secret value (for testing only, don't run in production)
gcloud secrets versions access latest --secret="gemini-api-key"
```

### Update Secrets

```bash
# Add new version to existing secret
echo -n "new-api-key-value" | gcloud secrets versions add gemini-api-key --data-file=-
```

**Note**: When using Secret Manager, the service account needs the `roles/secretmanager.secretAccessor` role (already configured in section 2).

## 5. Deploy to Cloud Run

Cloud Run supports pnpm natively, so no Dockerfile is required. You can deploy directly from source.

### Environment Variables Setup

Prepare environment variables for deployment:

```bash
# Required environment variables
export FIRESTORE_COLLECTION="meetingFiles"
export GOOGLE_GENERATIVE_AI_API_KEY="your-gemini-api-key"

# Optional environment variables
export GOOGLE_DRIVE_FOLDER_ID="your-drive-folder-id"  # Required if using /tasks/scan
export GOOGLE_DRIVE_OUTPUT_FOLDER_ID="your-output-folder-id"  # Where created forms will be saved
export GEMINI_MODEL="gemini-2.5-flash"
export QUIZ_ADDITIONAL_PROMPT="Use Japanese"  # Optional
export GOOGLE_ALLOWED_DOMAIN="yourdomain.com"  # Optional domain validation
```

### Deploy Command

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

**Notes**:
- `--allow-unauthenticated` allows unauthenticated access. For production, change to `--no-allow-unauthenticated` and configure Cloud IAP or custom authentication.
- `--timeout=300` sets 5-minute timeout (considering Gemini API processing time)
- Environment variables can be set individually with `--set-env-vars` or loaded from a file with `--env-vars-file`

### Using Environment Variables File

Create `env.yaml` file:

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

Simplified deploy command:

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

### Using Secret Manager (Recommended)

When managing sensitive information with Secret Manager, use the `--set-secrets` option.

```bash
# Load Gemini API key from Secret Manager
gcloud run deploy meet-quiz-maker \
  --source . \
  --region=$REGION \
  --platform=managed \
  --allow-unauthenticated \
  --service-account=$SERVICE_ACCOUNT_EMAIL \
  --set-env-vars="FIRESTORE_COLLECTION=meetingFiles" \
  --set-env-vars="GOOGLE_DRIVE_FOLDER_ID=${GOOGLE_DRIVE_FOLDER_ID}" \
  --set-env-vars="GOOGLE_DRIVE_OUTPUT_FOLDER_ID=${GOOGLE_DRIVE_OUTPUT_FOLDER_ID}" \
  --set-env-vars="GEMINI_MODEL=gemini-2.5-flash" \
  --set-env-vars="QUIZ_ADDITIONAL_PROMPT=Use Japanese" \
  --set-env-vars="GOOGLE_ALLOWED_DOMAIN=yourdomain.com" \
  --set-env-vars="PORT=8080" \
  --set-secrets="GOOGLE_GENERATIVE_AI_API_KEY=gemini-api-key:latest" \
  --port=8080 \
  --timeout=300 \
  --memory=512Mi \
  --cpu=1
```

`--set-secrets` format:
- `ENVIRONMENT_VARIABLE_NAME=secret-name:version`
- Version can be `latest` for the most recent version, or specific versions like `1`, `2`, etc.

**Benefits**:
- API keys don't appear in command history or logs
- Easy secret rotation
- Version control allows rollback to previous values
- Access control via IAM

## 6. Verify Deployment

After deployment completes, the service URL will be displayed:

```
Service [meet-quiz-maker] revision [meet-quiz-maker-00001-xxx] has been deployed and is serving 100 percent of traffic.
Service URL: https://meet-quiz-maker-xxxxxxxxxxxx-an.a.run.app
```

Test the deployment:

```bash
export SERVICE_URL=$(gcloud run services describe meet-quiz-maker --region=$REGION --format='value(status.url)')

# Health check (access UI)
curl $SERVICE_URL

# Test manual processing
curl -X POST $SERVICE_URL/manual \
  -H "Content-Type: application/json" \
  -d '{"driveUrl": "https://docs.google.com/document/d/YOUR_FILE_ID/edit"}'
```

## 7. Configure Cloud Scheduler (Periodic Execution)

Set up Cloud Scheduler to periodically execute the `/tasks/scan` endpoint.

```bash
# Create App Engine app (prerequisite for Cloud Scheduler)
gcloud app create --region=$REGION 2>/dev/null || true

# Create scheduler job (hourly execution example)
gcloud scheduler jobs create http meet-quiz-scan \
  --location=$REGION \
  --schedule="0 * * * *" \
  --uri="${SERVICE_URL}/tasks/scan" \
  --http-method=POST \
  --oidc-service-account-email=$SERVICE_ACCOUNT_EMAIL \
  --oidc-token-audience=$SERVICE_URL
```

Schedule format (cron syntax):
- `0 * * * *` - Every hour at 0 minutes
- `*/30 * * * *` - Every 30 minutes
- `0 9 * * *` - Daily at 9:00 AM

Manual job execution:

```bash
gcloud scheduler jobs run meet-quiz-scan --location=$REGION
```

## 8. Authentication Setup (Recommended)

For production environments, it's recommended to restrict endpoint access.

### Using Cloud IAP

```bash
# Require authentication for Cloud Run service
gcloud run services update meet-quiz-maker \
  --region=$REGION \
  --no-allow-unauthenticated

# Configure IAP (done via console)
```

### Authenticated Access from Cloud Scheduler

Using `--oidc-service-account-email` and `--oidc-token-audience` as shown above enables OIDC token-based authentication.

## 9. Logs and Monitoring

### View Logs

```bash
gcloud run services logs read meet-quiz-maker --region=$REGION --limit=50
```

### Real-time Logs

```bash
gcloud run services logs tail meet-quiz-maker --region=$REGION
```

### Monitoring in Cloud Console

View metrics, request counts, error rates, and more in [Cloud Run Console](https://console.cloud.google.com/run).

## 10. Updates

After code changes, simply re-run the same deploy command to deploy a new revision:

```bash
gcloud run deploy meet-quiz-maker \
  --source . \
  --region=$REGION
```

To update only environment variables:

```bash
gcloud run services update meet-quiz-maker \
  --region=$REGION \
  --set-env-vars="GEMINI_MODEL=gemini-2.0-flash-exp"
```

## 11. Troubleshooting

### Deployment Failures

- Check build logs: Review Cloud Build logs for pnpm install or build errors
- Verify service account permissions
- Confirm APIs are enabled

### Runtime Errors

- Check Cloud Run logs:
  ```bash
  gcloud run services logs read meet-quiz-maker --region=$REGION --limit=100
  ```
- Verify environment variables are correctly set:
  ```bash
  gcloud run services describe meet-quiz-maker --region=$REGION
  ```
- Confirm Firestore collection exists

### Drive/Forms Permission Errors

- Verify service account has domain-wide delegation configured
- Or verify Drive folder is shared with the service account
- Confirm scopes are correctly configured

## Reference Links

- [Cloud Run Documentation](https://cloud.google.com/run/docs)
- [Cloud Scheduler Documentation](https://cloud.google.com/scheduler/docs)
- [Secret Manager Documentation](https://cloud.google.com/secret-manager/docs)
- [Cloud Run and Secret Manager Integration](https://cloud.google.com/run/docs/configuring/secrets)
- [Service Account Domain-wide Delegation](https://developers.google.com/identity/protocols/oauth2/service-account#delegatingauthority)
