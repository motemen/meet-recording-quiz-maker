# Meet Recording Quiz Maker

App Engine service that turns Google Meet recordings (Docs transcripts in a Drive folder) into Google Forms quizzes using Gemini, with state tracked in Firestore.

## Architecture

- App Engine service (Hono/Node) with routes for per-file processing (`/tasks/process`), Drive URL submission (`/process`), status lookup (`/files/:fileId`), and a minimal UI (`/`).
- Drive client: fetches file metadata and exports Docs to text for supplied file IDs.
- Gemini client: generates quiz JSON from transcript using Vercel AI SDK (`generateObject`) with schema validation.
- Forms client: creates a quiz-form (radio MCQ) and returns `formId`/`formUrl`.
- Firestore: collection (`driveFiles`) stores `fileId`, `status`, `modifiedTime`, `title`, `formId`, `formUrl`, `geminiSummary`, `questionCount`, timestamps, and `error`.

## Environment

Required env vars:

- `SERVICE_ACCOUNT_EMAIL`: service account email used for Drive/Docs/Forms impersonation.
- `GOOGLE_DRIVE_OUTPUT_FOLDER_ID`: output Drive folder where created forms will be placed. Supports shared drives.
- One of:
  - `GOOGLE_GENERATIVE_AI_API_KEY`: API key for Gemini (used by Vercel AI SDK; read from env).
  - `GOOGLE_GENERATIVE_AI_API_KEY_SECRET`: Secret Manager resource name
    (`projects/{project}/secrets/{secret}/versions/{version}`) to fetch the API key.

Optional:

- `GEMINI_MODEL`: Gemini model name (default: `gemini-2.5-flash`).
- `QUIZ_ADDITIONAL_PROMPT`: extra instructions appended to the Gemini prompt (e.g. `Use Japanese`).
- `PORT`: server port (default: `8080`).

Firestore collection name is fixed to `driveFiles`; no environment variable is needed.

Permissions (service account used by App Engine):

- Drive file scope (to move created forms to output folder).
- Forms create/body scope.
- Firestore access.

## Endpoints

- `POST /tasks/process` — body `{ fileId, force?, questionCount? }` processes one file.
- `POST /process` — body `{ driveUrl, force?, questionCount? }` parses `fileId`, enqueues processing, and returns immediately. Firestore records now include a coarse `progress` hint.
- `GET /files/:fileId` — returns stored status/metadata.
- `GET /` — minimal UI to paste a Drive URL.

## Development

```bash
pnpm install
pnpm run dev
```

Create a `.env` (see `.env.example`) to supply secrets/IDs; they are loaded via `dotenv`.

## Deployment

See [DEPLOYMENT.md](./DEPLOYMENT.md) for detailed instructions on deploying to App Engine and setting up App Engine Cron.

## Next steps

- Run with real creds (`pnpm run dev`) and test `/tasks/process` on a sample Doc.
- Decide UI auth (basic auth or IAP) and whether to write Drive file properties (processed/formUrl).
- Add retries/backoff and monitoring once basic flow is verified.
