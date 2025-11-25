import "dotenv/config";
import { resolve } from "node:path";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { DriveClient } from "./clients/drive.js";
import { FormsClient } from "./clients/forms.js";
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
  const staticRoot = resolve(process.cwd(), "dist", "public");

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

  app.use("/assets/*", serveStatic({ root: staticRoot }));
  app.get("/vite.svg", serveStatic({ path: `${staticRoot}/vite.svg` }));
  app.get("/*", serveStatic({ path: `${staticRoot}/index.html` }));

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
