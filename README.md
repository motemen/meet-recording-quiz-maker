# Meet Recording Quiz Maker

Cloud Run service that turns Google Meet recordings (Docs transcripts in a Drive folder) into Google Forms quizzes using Gemini, with state tracked in Firestore.

## Environment

Required env vars:

- `GOOGLE_DRIVE_FOLDER_ID`: target Drive folder to scan.
- `GEMINI_MODEL`: Gemini model name (default: `gemini-1.5-pro`).
- `GEMINI_API_KEY`: API key for Gemini (or set up auth for Vertex if preferred).
- `FIRESTORE_COLLECTION`: Firestore collection name (default: `meetingFiles`).
- `GOOGLE_ALLOWED_DOMAIN`: optional domain check for owners.
- `PORT`: server port (default: `8080`).

Permissions (service account on Cloud Run):

- Drive read-only for the folder.
- Forms create/body scope.
- Firestore access.

## Endpoints

- `POST /tasks/scan` — scans `GOOGLE_DRIVE_FOLDER_ID` for new/changed files and processes them.
- `POST /tasks/process` — body `{ fileId, force?, questionCount? }` processes one file.
- `POST /manual` — body `{ driveUrl, force?, questionCount? }` parses `fileId` and processes.
- `GET /files/:fileId` — returns stored status/metadata.
- `GET /` — minimal UI to paste a Drive URL.

## Development

```bash
pnpm install
pnpm run dev
```

Deploy to Cloud Run with a service account that has Drive + Forms + Firestore scopes, and set up Cloud Scheduler to hit `/tasks/scan` periodically.
