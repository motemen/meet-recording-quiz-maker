import "dotenv/config";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { DriveClient } from "./clients/drive.js";
import { FormsClient } from "./clients/forms.js";
import { FormsRestClient } from "./clients/formsRest.js";
import { GeminiClient } from "./clients/gemini.js";
import { loadConfig } from "./config.js";
import type { AppConfig } from "./config.js";
import { logger } from "./logger.js";
import { MeetingFilesRepository } from "./repositories/meetingFilesRepository.js";
import { ProcessingService } from "./services/processing.js";
import { extractFileIdFromUrl } from "./utils/drive.js";
import { accessSecretPayload } from "./utils/secretManager.js";

async function readJsonBody<T>(request: Request): Promise<T | undefined> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

async function ensureGeminiApiKey(config: AppConfig) {
  if (process.env.GOOGLE_GENERATIVE_AI_API_KEY) return;
  if (!config.googleGenerativeAiApiKeySecret) {
    throw new Error(
      "GOOGLE_GENERATIVE_AI_API_KEY is not set and GOOGLE_GENERATIVE_AI_API_KEY_SECRET is not configured",
    );
  }
  const apiKey = await accessSecretPayload(config.googleGenerativeAiApiKeySecret);
  process.env.GOOGLE_GENERATIVE_AI_API_KEY = apiKey.trim();
  logger.info("gemini_api_key_loaded_from_secret", {
    secret: config.googleGenerativeAiApiKeySecret,
  });
}

async function bootstrap() {
  const config = loadConfig();
  await ensureGeminiApiKey(config);
  const app = new Hono();

  const repo = new MeetingFilesRepository({ collectionName: config.firestoreCollection });
  const driveClient = new DriveClient();
  const formsClient = new FormsClient({
    driveClient,
    outputFolderId: config.googleDriveOutputFolderId,
  });
  const formsRestClient = new FormsRestClient();
  const geminiClient = new GeminiClient({ modelName: config.geminiModel });
  const service = new ProcessingService({
    config,
    repo,
    driveClient,
    formsClient,
    geminiClient,
  });

  app.get("/healthz", (c) => {
    return c.json({ ok: true });
  });

  app.get("/debug/forms", (c) => {
    return c.html(`
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Debug Form Creator</title>
    <style>
      body { font-family: sans-serif; max-width: 720px; margin: 2rem auto; padding: 0 1rem; }
      input[type="text"] { width: 100%; padding: 0.5rem; font-size: 1rem; }
      button { margin-top: 0.5rem; padding: 0.5rem 1rem; font-size: 1rem; }
      #result { margin-top: 1rem; white-space: pre-wrap; }
      section { margin-bottom: 2rem; }
    </style>
  </head>
  <body>
    <h1>Debug Form Creator</h1>
    <p>Use these helpers to create placeholder forms via the usual client or raw REST call. IAP authentication on the page handles access.</p>
    <section>
      <h2>Create via Google client</h2>
      <input id="title-client" type="text" placeholder="Optional title (defaults to timestamp)" />
      <button data-endpoint="/debug/forms/create" data-title-input="title-client">Create Form</button>
    </section>
    <section>
      <h2>Create via REST API</h2>
      <input id="title-rest" type="text" placeholder="Optional title (defaults to timestamp)" />
      <button data-endpoint="/debug/forms/create-rest" data-title-input="title-rest">Create Form (REST)</button>
    </section>
    <section>
      <h2>Create a blank Google Doc</h2>
      <input id="title-doc" type="text" placeholder="Optional title (defaults to timestamp)" />
      <button data-endpoint="/debug/docs/create" data-title-input="title-doc">Create Doc</button>
    </section>
    <section>
      <h2>Create Doc in output folder (Drive files.create)</h2>
      <input id="title-doc-output" type="text" placeholder="Optional title (defaults to timestamp)" />
      <button data-endpoint="/debug/docs/create-in-output-folder" data-title-input="title-doc-output">Create Doc in output folder</button>
    </section>
    <section>
      <h2>Check Drive quota</h2>
      <p>Calls Drive API About.get to see current storage quota.</p>
      <button data-endpoint="/debug/drive/quota" data-method="GET">Check quota</button>
    </section>
    <div id="result"></div>
    <script>
      const result = document.getElementById('result');
      document.querySelectorAll('button[data-endpoint]').forEach((btn) => {
        btn.onclick = async () => {
          const inputId = btn.dataset.titleInput;
          const titleInput = inputId ? document.getElementById(inputId) : null;
          const title = titleInput ? titleInput.value : '';
          result.textContent = 'Submitting...';
          try {
            const method = btn.dataset.method || 'POST';
            const init = { method, headers: {}, body: undefined };
            if (method === 'POST') {
              init.headers = { 'Content-Type': 'application/json' };
              init.body = JSON.stringify({ title });
            }
            const resp = await fetch(btn.dataset.endpoint, init);
            const data = await resp.json();
            if (!resp.ok) throw new Error(data.error || 'Request failed');
            result.textContent = JSON.stringify(data, null, 2);
          } catch (err) {
            result.textContent = 'Error: ' + err.message;
          }
        };
      });
    </script>
  </body>
</html>
    `);
  });

  app.post("/debug/forms/create", async (c) => {
    const body = await readJsonBody<{ title?: unknown }>(c.req.raw);
    const title =
      typeof body?.title === "string" && body.title.trim().length > 0
        ? body.title.trim()
        : `Debug form ${new Date().toISOString()}`;

    try {
      const result = await formsClient.createBlankForm(title);
      logger.info("debug_form_created", { formId: result.formId, method: "forms_client" });
      return c.json(result);
    } catch (error) {
      logger.error("debug_form_create_failed", { error, method: "forms_client" });
      return c.json({ error: "debug form creation failed", details: String(error) }, 500);
    }
  });

  app.post("/debug/forms/create-rest", async (c) => {
    const body = await readJsonBody<{ title?: unknown }>(c.req.raw);
    const title =
      typeof body?.title === "string" && body.title.trim().length > 0
        ? body.title.trim()
        : `Debug form (REST) ${new Date().toISOString()}`;

    try {
      const result = await formsRestClient.createBlankForm(title);
      logger.info("debug_form_created", { formId: result.formId, method: "rest_api" });
      return c.json(result);
    } catch (error) {
      logger.error("debug_form_create_failed", { error, method: "rest_api" });
      return c.json(
        { error: "debug form creation via REST failed", details: String(error) },
        500,
      );
    }
  });

  app.post("/debug/docs/create", async (c) => {
    const body = await readJsonBody<{ title?: unknown }>(c.req.raw);
    const title =
      typeof body?.title === "string" && body.title.trim().length > 0
        ? body.title.trim()
        : `Debug doc ${new Date().toISOString()}`;

    try {
      const doc = await driveClient.createBlankDocument(title);
      logger.info("debug_doc_created", { fileId: doc.fileId });
      return c.json(doc);
    } catch (error) {
      logger.error("debug_doc_create_failed", { error });
      return c.json({ error: "debug doc creation failed", details: String(error) }, 500);
    }
  });

  app.post("/debug/docs/create-in-output-folder", async (c) => {
    if (!config.googleDriveOutputFolderId) {
      return c.json({ error: "GOOGLE_DRIVE_OUTPUT_FOLDER_ID is not configured" }, 400);
    }
    const body = await readJsonBody<{ title?: unknown }>(c.req.raw);
    const title =
      typeof body?.title === "string" && body.title.trim().length > 0
        ? body.title.trim()
        : `Debug doc (output folder) ${new Date().toISOString()}`;

    try {
      const doc = await driveClient.createFileInFolder(
        title,
        config.googleDriveOutputFolderId,
      );
      logger.info("debug_doc_created_in_output", { fileId: doc.fileId });
      return c.json(doc);
    } catch (error) {
      logger.error("debug_doc_create_in_output_failed", { error });
      return c.json(
        { error: "debug doc creation in output folder failed", details: String(error) },
        500,
      );
    }
  });

  app.get("/debug/drive/quota", async (c) => {
    try {
      const quota = await driveClient.getQuota();
      logger.info("debug_drive_quota_fetched");
      return c.json(quota);
    } catch (error) {
      logger.error("debug_drive_quota_failed", { error });
      return c.json({ error: "failed to fetch drive quota", details: String(error) }, 500);
    }
  });

  app.post("/tasks/scan", async (c) => {
    logger.info("http_scan_requested");
    if (!config.googleDriveFolderId) {
      return c.json(
        {
          error:
            "GOOGLE_DRIVE_FOLDER_ID is not configured. Scan functionality requires a folder ID.",
        },
        400,
      );
    }
    try {
      const result = await service.scanFolder();
      return c.json(result);
    } catch (error) {
      logger.error("scan failed", { error });
      return c.json({ error: "scan failed", details: String(error) }, 500);
    }
  });

  app.post("/tasks/process", async (c) => {
    const body = await readJsonBody<{ fileId?: unknown; force?: unknown; questionCount?: unknown }>(
      c.req.raw,
    );
    if (!body) return c.json({ error: "Invalid JSON body" }, 400);

    const { fileId, force, questionCount } = body;
    const numericQuestionCount =
      typeof questionCount === "number"
        ? questionCount
        : typeof questionCount === "string" && Number.isFinite(Number(questionCount))
          ? Number(questionCount)
          : undefined;
    if (!fileId || typeof fileId !== "string") {
      return c.json({ error: "fileId is required" }, 400);
    }

    logger.info("http_process_requested", {
      fileId,
      force: !!force,
      questionCount: numericQuestionCount,
    });

    try {
      const record = await service.processFile({
        fileId,
        force: !!force,
        questionCount: numericQuestionCount,
      });
      return c.json(record);
    } catch (error) {
      logger.error("process failed", { fileId, error });
      return c.json({ error: "process failed", details: String(error) }, 500);
    }
  });

  app.post("/manual", async (c) => {
    const body = await readJsonBody<{
      driveUrl?: unknown;
      force?: unknown;
      questionCount?: unknown;
    }>(c.req.raw);
    if (!body) return c.json({ error: "Invalid JSON body" }, 400);

    const { driveUrl, force, questionCount } = body;
    const numericQuestionCount =
      typeof questionCount === "number"
        ? questionCount
        : typeof questionCount === "string" && Number.isFinite(Number(questionCount))
          ? Number(questionCount)
          : undefined;
    if (!driveUrl || typeof driveUrl !== "string") {
      return c.json({ error: "driveUrl is required" }, 400);
    }
    const fileId = extractFileIdFromUrl(driveUrl);
    if (!fileId) {
      return c.json({ error: "driveUrl is invalid or missing file id" }, 400);
    }

    logger.info("http_manual_requested", {
      driveUrl,
      fileId,
      force: !!force,
      questionCount: numericQuestionCount,
    });

    try {
      const record = await service.processFile({
        fileId,
        force: !!force,
        questionCount: numericQuestionCount,
      });
      return c.json(record);
    } catch (error) {
      logger.error("manual processing failed", { fileId, error });
      return c.json({ error: "manual processing failed", details: String(error) }, 500);
    }
  });

  app.get("/files/:fileId", async (c) => {
    const { fileId } = c.req.param();
    const record = await service.getStatus(fileId);
    if (!record) return c.json({ error: "not found" }, 404);
    return c.json(record);
  });

  app.get("/", (c) => {
    return c.html(`
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Meet Recording Quiz Maker</title>
    <style>
      body { font-family: sans-serif; max-width: 720px; margin: 2rem auto; padding: 0 1rem; }
      input[type="text"] { width: 100%; padding: 0.5rem; font-size: 1rem; }
      button { margin-top: 0.5rem; padding: 0.5rem 1rem; font-size: 1rem; }
      #status { margin-top: 1rem; white-space: pre-wrap; }
    </style>
  </head>
  <body>
    <h1>Meet Recording Quiz Maker</h1>
    <p>Paste a Google Drive file URL to create a quiz.</p>
    <input id="driveUrl" type="text" placeholder="https://docs.google.com/document/d/..." />
    <button id="submit">Create quiz</button>
    <div id="status"></div>
    <script>
      const submit = document.getElementById('submit');
      const driveUrlInput = document.getElementById('driveUrl');
      const statusEl = document.getElementById('status');

      submit.onclick = async () => {
        const driveUrl = driveUrlInput.value;
        statusEl.textContent = 'Submitting...';
        try {
          const resp = await fetch('/manual', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ driveUrl })
          });
          const data = await resp.json();
          if (!resp.ok) throw new Error(data.error || 'Request failed');
          statusEl.textContent = 'Processing started for file ' + data.fileId + '. Refresh /files/' + data.fileId;
        } catch (err) {
          statusEl.textContent = 'Error: ' + err.message;
        }
      };
    </script>
  </body>
</html>
    `);
  });

  const port = config.port;
  serve(
    {
      fetch: app.fetch,
      port,
    },
    () => {
      logger.info("server_started", { port });
    },
  );
}

bootstrap().catch((error) => {
  logger.error("Failed to start server", { error });
  process.exit(1);
});
