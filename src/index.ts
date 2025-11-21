import express from "express";
import { loadConfig } from "./config.js";
import { logger } from "./logger.js";
import { MeetingFilesRepository } from "./repositories/meetingFilesRepository.js";
import { DriveClient } from "./clients/drive.js";
import { FormsClient } from "./clients/forms.js";
import { GeminiClient } from "./clients/gemini.js";
import { ProcessingService } from "./services/processing.js";
import { extractFileIdFromUrl } from "./utils/drive.js";

async function bootstrap() {
  const config = loadConfig();
  const app = express();
  app.use(express.json());

  const repo = new MeetingFilesRepository({ collectionName: config.firestoreCollection });
  const driveClient = new DriveClient();
  const formsClient = new FormsClient();
  const geminiClient = new GeminiClient({ modelName: config.geminiModel });
  const service = new ProcessingService({
    config,
    repo,
    driveClient,
    formsClient,
    geminiClient
  });

  app.get("/healthz", (_req, res) => {
    res.json({ ok: true });
  });

  app.post("/tasks/scan", async (_req, res) => {
    try {
      const result = await service.scanFolder();
      res.json(result);
    } catch (error) {
      logger.error("scan failed", { error });
      res.status(500).json({ error: "scan failed", details: String(error) });
    }
  });

  app.post("/tasks/process", async (req, res) => {
    const { fileId, force, questionCount } = req.body ?? {};
    if (!fileId || typeof fileId !== "string") {
      return res.status(400).json({ error: "fileId is required" });
    }

    try {
      const record = await service.processFile({ fileId, force: !!force, questionCount });
      res.json(record);
    } catch (error) {
      logger.error("process failed", { fileId, error });
      res.status(500).json({ error: "process failed", details: String(error) });
    }
  });

  app.post("/manual", async (req, res) => {
    const { driveUrl, force, questionCount } = req.body ?? {};
    if (!driveUrl || typeof driveUrl !== "string") {
      return res.status(400).json({ error: "driveUrl is required" });
    }
    const fileId = extractFileIdFromUrl(driveUrl);
    if (!fileId) {
      return res.status(400).json({ error: "driveUrl is invalid or missing file id" });
    }

    try {
      const record = await service.processFile({ fileId, force: !!force, questionCount });
      res.json(record);
    } catch (error) {
      logger.error("manual processing failed", { fileId, error });
      res.status(500).json({ error: "manual processing failed", details: String(error) });
    }
  });

  app.get("/files/:fileId", async (req, res) => {
    const { fileId } = req.params;
    const record = await service.getStatus(fileId);
    if (!record) return res.status(404).json({ error: "not found" });
    res.json(record);
  });

  app.get("/", (_req, res) => {
    res.type("html").send(`
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
  app.listen(port, () => {
    logger.info("server_started", { port });
  });
}

bootstrap().catch((error) => {
  logger.error("Failed to start server", { error });
  process.exit(1);
});
