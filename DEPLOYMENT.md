# Deployment Guide

This guide provides step-by-step instructions to deploy the Meet Recording Quiz Maker to Google Cloud Run.

## Prerequisites

- Google Cloud Project with billing enabled
- gcloud CLI installed and authenticated (`gcloud auth login`)
- Docker installed locally
- Google Drive folder with meeting transcripts (optional, for automatic scanning)
- Gemini API key

## Environment Variables

Set your GCP project ID:

```bash
export PROJECT_ID="your-project-id"
export REGION="asia-northeast1"  # or your preferred region
export SERVICE_NAME="meet-recording-quiz-maker"
```

## Step 1: Enable Required APIs

```bash
gcloud config set project $PROJECT_ID

gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  cloudscheduler.googleapis.com \
  drive.googleapis.com \
  forms.googleapis.com \
  firestore.googleapis.com \
  generativelanguage.googleapis.com
```

## Step 2: Create Firestore Database

If you don't have a Firestore database yet:

```bash
# Create a Firestore database in native mode
gcloud firestore databases create --location=$REGION
```

## Step 3: Create Service Account

Create a service account with necessary permissions:

```bash
# Create service account
gcloud iam service-accounts create $SERVICE_NAME \
  --display-name="Meet Recording Quiz Maker Service Account"

export SERVICE_ACCOUNT="${SERVICE_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

# Grant Firestore access
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${SERVICE_ACCOUNT}" \
  --role="roles/datastore.user"

# Note: For Drive and Forms access, you'll need to:
# 1. Create OAuth credentials or use domain-wide delegation
# 2. Share the Drive folder with the service account email
# 3. Grant the service account Forms creation permissions
```

### Domain-Wide Delegation (Optional)

If using Google Workspace, you can set up domain-wide delegation:

1. Go to Google Cloud Console → IAM & Admin → Service Accounts
2. Click on the service account
3. Click "Advanced settings" → "Enable Domain-wide delegation"
4. Note the Client ID
5. Go to Google Workspace Admin Console → Security → API Controls → Domain-wide Delegation
6. Add the Client ID with these OAuth scopes:
   - `https://www.googleapis.com/auth/drive.readonly`
   - `https://www.googleapis.com/auth/forms.body`

## Step 4: Create Artifact Registry Repository

```bash
# Create repository for Docker images
gcloud artifacts repositories create $SERVICE_NAME \
  --repository-format=docker \
  --location=$REGION \
  --description="Meet Recording Quiz Maker container images"

# Configure Docker authentication
gcloud auth configure-docker ${REGION}-docker.pkg.dev
```

## Step 5: Build and Push Docker Image

```bash
# Build Docker image
docker build -t ${REGION}-docker.pkg.dev/${PROJECT_ID}/${SERVICE_NAME}/${SERVICE_NAME}:latest .

# Push to Artifact Registry
docker push ${REGION}-docker.pkg.dev/${PROJECT_ID}/${SERVICE_NAME}/${SERVICE_NAME}:latest
```

## Step 6: Deploy to Cloud Run

### Prepare Environment Variables

Create a file `env.yaml` with your configuration:

```yaml
FIRESTORE_COLLECTION: "meetingFiles"
GOOGLE_GENERATIVE_AI_API_KEY: "your-gemini-api-key"
GOOGLE_DRIVE_FOLDER_ID: "your-drive-folder-id"  # Optional
GEMINI_MODEL: "gemini-2.5-flash"
PORT: "8080"
```

**Important**: Do not commit `env.yaml` to version control. Add it to `.gitignore`.

### Deploy Service

```bash
gcloud run deploy $SERVICE_NAME \
  --image=${REGION}-docker.pkg.dev/${PROJECT_ID}/${SERVICE_NAME}/${SERVICE_NAME}:latest \
  --platform=managed \
  --region=$REGION \
  --service-account=$SERVICE_ACCOUNT \
  --env-vars-file=env.yaml \
  --allow-unauthenticated \
  --memory=512Mi \
  --cpu=1 \
  --timeout=300 \
  --max-instances=10
```

**Note**: `--allow-unauthenticated` makes the service public. For production, consider:
- Using `--no-allow-unauthenticated` and setting up Identity-Aware Proxy (IAP)
- Adding Basic Authentication
- Using Cloud Scheduler with OIDC authentication

Get the service URL:

```bash
export SERVICE_URL=$(gcloud run services describe $SERVICE_NAME --region=$REGION --format='value(status.url)')
echo "Service URL: $SERVICE_URL"
```

## Step 7: Set Up Cloud Scheduler (Optional)

Create a scheduled job to scan the Drive folder periodically:

```bash
# Create scheduler job to run every hour
gcloud scheduler jobs create http ${SERVICE_NAME}-scan \
  --location=$REGION \
  --schedule="0 * * * *" \
  --uri="${SERVICE_URL}/tasks/scan" \
  --http-method=POST \
  --oidc-service-account-email=$SERVICE_ACCOUNT \
  --oidc-token-audience=$SERVICE_URL
```

**Note**: This requires `GOOGLE_DRIVE_FOLDER_ID` to be configured.

Schedule variations:
- Every 6 hours: `0 */6 * * *`
- Daily at 9 AM: `0 9 * * *`
- Every 30 minutes: `*/30 * * * *`

## Step 8: Verify Deployment

Test the endpoints:

```bash
# Check service health
curl $SERVICE_URL/

# Manually process a file (replace with your Drive URL)
curl -X POST $SERVICE_URL/manual \
  -H "Content-Type: application/json" \
  -d '{
    "driveUrl": "https://docs.google.com/document/d/YOUR_FILE_ID/edit",
    "questionCount": 10
  }'

# Check file status
curl $SERVICE_URL/files/YOUR_FILE_ID
```

## Updating the Service

After making code changes:

```bash
# Rebuild and push image
docker build -t ${REGION}-docker.pkg.dev/${PROJECT_ID}/${SERVICE_NAME}/${SERVICE_NAME}:latest .
docker push ${REGION}-docker.pkg.dev/${PROJECT_ID}/${SERVICE_NAME}/${SERVICE_NAME}:latest

# Deploy new version
gcloud run deploy $SERVICE_NAME \
  --image=${REGION}-docker.pkg.dev/${PROJECT_ID}/${SERVICE_NAME}/${SERVICE_NAME}:latest \
  --region=$REGION
```

Or use the `--source` flag to build and deploy in one step:

```bash
gcloud run deploy $SERVICE_NAME \
  --source=. \
  --region=$REGION \
  --service-account=$SERVICE_ACCOUNT \
  --env-vars-file=env.yaml
```

## Monitoring and Logs

View logs:

```bash
# Stream logs
gcloud run services logs tail $SERVICE_NAME --region=$REGION

# View recent logs
gcloud run services logs read $SERVICE_NAME --region=$REGION --limit=50
```

View metrics in Cloud Console:
- Go to Cloud Run → Select your service
- Click "Metrics" tab to see request count, latency, errors

## Security Considerations

### Production Deployment

For production use, consider these security enhancements:

1. **Authentication**: Add authentication to endpoints
   ```bash
   gcloud run deploy $SERVICE_NAME \
     --no-allow-unauthenticated \
     --region=$REGION
   ```

2. **Identity-Aware Proxy (IAP)**: Set up IAP for user-based access control

3. **Secret Manager**: Store sensitive values in Secret Manager instead of environment variables
   ```bash
   # Create secret
   echo -n "your-api-key" | gcloud secrets create gemini-api-key --data-file=-

   # Grant service account access
   gcloud secrets add-iam-policy-binding gemini-api-key \
     --member="serviceAccount:${SERVICE_ACCOUNT}" \
     --role="roles/secretmanager.secretAccessor"

   # Deploy with secret
   gcloud run deploy $SERVICE_NAME \
     --update-secrets=GOOGLE_GENERATIVE_AI_API_KEY=gemini-api-key:latest \
     --region=$REGION
   ```

4. **VPC Connector**: Use VPC connector for private network access

### Google API Permissions

Ensure your service account has access to:
- **Drive folder**: Share the folder with the service account email
- **Forms**: Service account needs Forms API enabled and appropriate OAuth scopes
- **Firestore**: IAM role `roles/datastore.user` (already granted in Step 3)

## Troubleshooting

### Common Issues

**"Permission denied" errors**:
- Verify service account has correct IAM roles
- Check that Drive folder is shared with service account
- Ensure domain-wide delegation is set up (if using Workspace)

**"Container failed to start"**:
- Check logs: `gcloud run services logs read $SERVICE_NAME --region=$REGION`
- Verify environment variables are set correctly
- Test Docker image locally: `docker run -p 8080:8080 --env-file .env IMAGE_URL`

**"Gemini API errors"**:
- Verify `GOOGLE_GENERATIVE_AI_API_KEY` is correct
- Check API quotas in Cloud Console
- Ensure Generative Language API is enabled

**"Firestore errors"**:
- Verify Firestore database exists
- Check service account has `roles/datastore.user`
- Verify `FIRESTORE_COLLECTION` is set

## Cost Optimization

- Set `--max-instances` to limit scaling
- Use `--min-instances=0` (default) to scale to zero when idle
- Adjust `--memory` and `--cpu` based on actual usage
- Monitor costs in Cloud Console → Billing

## Next Steps

- Set up monitoring alerts for errors and high latency
- Configure log-based metrics for business insights
- Add retry logic for API failures
- Implement authentication (Basic Auth or IAP)
- Set up Cloud Build for CI/CD pipeline
- Consider writing quiz results back to Drive file properties

## Resources

- [Cloud Run Documentation](https://cloud.google.com/run/docs)
- [Cloud Scheduler Documentation](https://cloud.google.com/scheduler/docs)
- [Artifact Registry Documentation](https://cloud.google.com/artifact-registry/docs)
- [Firestore Documentation](https://cloud.google.com/firestore/docs)
