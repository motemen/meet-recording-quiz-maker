# ExecPlan: Meet Recording Quiz Maker

## Goals
- Convert Google Meet transcripts (Docs in a designated Drive folder) into Google Forms quizzes via Gemini.
 - Run on App Engine, with Firestore for state and manual URL input.

## Current Decision Set
- Use pnpm for package management.
- No Pub/Sub, no Form template.
- Env naming: `GEMINI_MODEL`, `GOOGLE_GENERATIVE_AI_API_KEY`, `QUIZ_ADDITIONAL_PROMPT`, `PORT`.

## Milestones
1) **Scaffold (done)**: Express app with routes `/tasks/process`, `/process`, `/files/:fileId`, minimal UI; clients for Drive/Forms/Gemini; Firestore repo; config validation.
2) **Integrate & test**: Install deps with pnpm, run locally with real creds; validate `/tasks/process` against sample Doc.
3) **Deploy**: App Engine deployment with proper service account scopes.
4) **Hardening**: Add retries/backoff for Google APIs, optional Drive property write-back, auth for UI, and monitoring/alerts.

## Open Items
- Decide auth mechanism for UI (`/process`): basic auth vs IAP.
- Decide if Drive file properties should be written in MVP.
- Finalize question count default and prompt tuning for Gemini.
