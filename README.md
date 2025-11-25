# Meet Recording Quiz Maker

Cloud Run service that turns Google Meet recordings (Docs transcripts in a Drive folder) into Google Forms quizzes using Gemini, with state tracked in Firestore.

## Architecture

- Cloud Run service (Express) with routes for scanning (`/tasks/scan`), per-file processing (`/tasks/process`), manual submission (`/manual`), status lookup (`/files/:fileId`), and a minimal UI (`/`).
- Drive client: lists files in configured folder (if `GOOGLE_DRIVE_FOLDER_ID` is set), fetches metadata, exports Docs to text.
- Gemini client: generates quiz JSON from transcript using Vercel AI SDK (`generateObject`) with schema validation.
- Forms client: creates a quiz-form (radio MCQ) and returns `formId`/`formUrl`.
- Firestore: collection stores `fileId`, `status`, `modifiedTime`, `title`, `formId`, `formUrl`, `geminiSummary`, `questionCount`, timestamps, and `error`.

## Environment

Required env vars:

- `FIRESTORE_COLLECTION`: Firestore collection name.
- One of:
  - `GOOGLE_GENERATIVE_AI_API_KEY`: API key for Gemini (used by Vercel AI SDK; read from env).
  - `GOOGLE_GENERATIVE_AI_API_KEY_SECRET`: Secret Manager resource name
    (`projects/{project}/secrets/{secret}/versions/{version}`) to fetch the API key.

Optional:

- `GOOGLE_DRIVE_FOLDER_ID`: target Drive folder to scan. Required for `/tasks/scan` endpoint; not needed for manual operation via `/manual`.
- `GOOGLE_DRIVE_OUTPUT_FOLDER_ID`: output Drive folder where created forms will be placed. Supports shared drives. If not set, forms remain in the creator's "My Drive".
- `GEMINI_MODEL`: Gemini model name (default: `gemini-2.5-flash`).
- `QUIZ_ADDITIONAL_PROMPT`: extra instructions appended to the Gemini prompt (e.g. `Use Japanese`).
- `GOOGLE_ALLOWED_DOMAIN`: optional domain check for owners.
- `PORT`: server port (default: `8080`).

Permissions (service account on Cloud Run):

- Drive read-only for the folder (scanning).
- Drive file scope (to move created forms to output folder).
- Forms create/body scope.
- Firestore access.

## Endpoints

- `POST /tasks/scan` — scans `GOOGLE_DRIVE_FOLDER_ID` for new/changed files and processes them. Requires `GOOGLE_DRIVE_FOLDER_ID` to be configured.
- `POST /tasks/process` — body `{ fileId, force?, questionCount? }` processes one file.
- `POST /manual` — body `{ driveUrl, force?, questionCount? }` parses `fileId` and processes. Works without `GOOGLE_DRIVE_FOLDER_ID`.
- `GET /files/:fileId` — returns stored status/metadata.
- `GET /` — minimal UI to paste a Drive URL.

## Development

```bash
pnpm install
pnpm run dev
```

Create a `.env` (see `.env.example`) to supply secrets/IDs; they are loaded via `dotenv`.

## Deployment

See [DEPLOYMENT.md](./DEPLOYMENT.md) for detailed instructions on deploying to Google Cloud Run and setting up Cloud Scheduler.

## Next steps

- Run with real creds (`pnpm run dev`) and test `/tasks/process` on a sample Doc.
- Configure Cloud Scheduler → `/tasks/scan` on Cloud Run.
- Decide UI auth (basic auth or IAP) and whether to write Drive file properties (processed/formUrl).
- Add retries/backoff and monitoring once basic flow is verified.
