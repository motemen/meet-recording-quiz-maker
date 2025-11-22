import "dotenv/config";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { DriveClient } from "./clients/drive.js";
import { FormsClient } from "./clients/forms.js";
import { GeminiClient } from "./clients/gemini.js";
import { loadConfig } from "./config.js";
import { logger } from "./logger.js";
import { MeetingFilesRepository } from "./repositories/meetingFilesRepository.js";
import { ProcessingService } from "./services/processing.js";
import { extractFileIdFromUrl } from "./utils/drive.js";

async function readJsonBody<T>(request: Request): Promise<T | undefined> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

async function bootstrap() {
  const config = loadConfig();
  const app = new Hono();

  const repo = new MeetingFilesRepository({ collectionName: config.firestoreCollection });
  const driveClient = new DriveClient();
  const formsClient = new FormsClient({
    driveClient,
    outputFolderId: config.googleDriveOutputFolderId,
  });
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

  app.get("/config", async (c) => {
    const email = await driveClient.getCallerEmail();
    return c.json({
      serviceAccountEmail: email,
      outputFolderId: config.googleDriveOutputFolderId,
    });
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
      input[type="text"] { width: 100%; padding: 0.5rem; font-size: 1rem; box-sizing: border-box; }
      button { margin-top: 0.5rem; padding: 0.5rem 1rem; font-size: 1rem; cursor: pointer; }
      button:disabled { opacity: 0.6; cursor: not-allowed; }
      #status { margin-top: 1rem; white-space: pre-wrap; }
      .config-info { margin: 1rem 0; padding: 1rem; background: #f5f5f5; border-radius: 4px; font-size: 0.9rem; }
      .config-info dt { font-weight: bold; margin-top: 0.5rem; }
      .config-info dd { margin-left: 0; color: #555; }
      .loading { color: #0066cc; }
      .success { color: #008800; }
      .error { color: #cc0000; }
      .quiz-link { margin-top: 1rem; padding: 1rem; background: #e8f5e9; border-radius: 4px; }
      .quiz-link a { color: #1976d2; font-weight: bold; font-size: 1.1rem; }
    </style>
  </head>
  <body>
    <h1>Meet Recording Quiz Maker</h1>

    <div class="config-info">
      <dl>
        <dt>Service Account:</dt>
        <dd id="serviceAccount">Loading...</dd>
        <dt>Output Folder ID:</dt>
        <dd id="outputFolder">Loading...</dd>
      </dl>
    </div>

    <p>Paste a Google Drive file URL to create a quiz.</p>
    <input id="driveUrl" type="text" placeholder="https://docs.google.com/document/d/..." />
    <button id="submit">Create quiz</button>
    <div id="status"></div>

    <script>
      const submit = document.getElementById('submit');
      const driveUrlInput = document.getElementById('driveUrl');
      const statusEl = document.getElementById('status');
      const serviceAccountEl = document.getElementById('serviceAccount');
      const outputFolderEl = document.getElementById('outputFolder');

      let pollInterval = null;

      // Load config info on page load
      async function loadConfig() {
        try {
          const resp = await fetch('/config');
          const data = await resp.json();
          serviceAccountEl.textContent = data.serviceAccountEmail || 'Not available';
          outputFolderEl.textContent = data.outputFolderId || 'Not configured';
        } catch (err) {
          serviceAccountEl.textContent = 'Error loading';
          outputFolderEl.textContent = 'Error loading';
        }
      }

      // Poll file status
      async function pollStatus(fileId) {
        try {
          const resp = await fetch('/files/' + fileId);
          if (!resp.ok) {
            if (resp.status === 404) {
              statusEl.innerHTML = '<span class="loading">Processing... (file not yet tracked)</span>';
              return false;
            }
            throw new Error('Status check failed');
          }

          const data = await resp.json();

          if (data.status === 'completed' && data.formUrl) {
            clearInterval(pollInterval);
            pollInterval = null;
            submit.disabled = false;
            statusEl.innerHTML = '<div class="success">✓ Quiz created successfully!</div>' +
              '<div class="quiz-link"><a href="' + data.formUrl + '" target="_blank">Open Quiz Form →</a></div>';
            return true;
          } else if (data.status === 'failed') {
            clearInterval(pollInterval);
            pollInterval = null;
            submit.disabled = false;
            statusEl.innerHTML = '<span class="error">✗ Processing failed: ' + (data.error || 'Unknown error') + '</span>';
            return true;
          } else {
            statusEl.innerHTML = '<span class="loading">Processing... (status: ' + (data.status || 'unknown') + ')</span>';
            return false;
          }
        } catch (err) {
          statusEl.innerHTML = '<span class="error">Error checking status: ' + err.message + '</span>';
          return false;
        }
      }

      submit.onclick = async () => {
        const driveUrl = driveUrlInput.value.trim();
        if (!driveUrl) {
          statusEl.innerHTML = '<span class="error">Please enter a Drive URL</span>';
          return;
        }

        submit.disabled = true;
        statusEl.innerHTML = '<span class="loading">Submitting...</span>';

        // Clear any existing polling
        if (pollInterval) {
          clearInterval(pollInterval);
          pollInterval = null;
        }

        try {
          const resp = await fetch('/manual', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ driveUrl })
          });
          const data = await resp.json();
          if (!resp.ok) throw new Error(data.error || 'Request failed');

          statusEl.innerHTML = '<span class="loading">Processing started for file: ' + data.fileId + '</span>';

          // Start polling every 2 seconds
          pollInterval = setInterval(() => {
            pollStatus(data.fileId);
          }, 2000);

          // Also check immediately
          await pollStatus(data.fileId);

        } catch (err) {
          submit.disabled = false;
          statusEl.innerHTML = '<span class="error">Error: ' + err.message + '</span>';
        }
      };

      // Load config on page load
      loadConfig();
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
