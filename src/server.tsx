import "dotenv/config";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { renderToString } from "react-dom/server";
import type { ViteDevServer } from "vite";
import { createServer as createViteServer } from "vite";
import { DriveClient } from "./clients/drive.js";
import { FormsClient } from "./clients/forms.js";
import { GeminiClient } from "./clients/gemini.js";
import { App, type AppProps } from "./components/App";
import type { AppConfig } from "./config.js";
import { loadConfig } from "./config.js";
import { logger } from "./logger.js";
import { DriveFilesRepository } from "./repositories/driveFilesRepository.js";
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

  const repo = new DriveFilesRepository();
  const driveClient = new DriveClient({ serviceAccountEmail: config.serviceAccountEmail });
  const formsClient = new FormsClient({
    driveClient,
    outputFolderId: config.googleDriveOutputFolderId,
    serviceAccountEmail: config.serviceAccountEmail,
  });
  const geminiClient = new GeminiClient({ modelName: config.geminiModel });
  const service = new ProcessingService({
    config,
    repo,
    driveClient,
    formsClient,
    geminiClient,
  });

  // Vite SSR setup
  const isDev = process.env.NODE_ENV !== "production";
  let vite: ViteDevServer | undefined;

  if (isDev) {
    vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "custom",
    });
    const viteServer = vite;
    app.use("*", async (c, next) => {
      if (c.req.path.startsWith("/src") || c.req.path.startsWith("/@")) {
        // Let Vite handle module requests
        return new Promise((resolve) => {
          viteServer.middlewares(c.req.raw as never, c.res as never, () => {
            resolve(next());
          });
        });
      }
      await next();
    });
  }

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

  app.post("/process", async (c) => {
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

    logger.info("http_process_requested_from_drive_url", {
      driveUrl,
      fileId,
      force: !!force,
      questionCount: numericQuestionCount,
    });

    try {
      const record = await service.enqueueProcessing({
        fileId,
        force: !!force,
        questionCount: numericQuestionCount,
      });
      return c.json(record);
    } catch (error) {
      logger.error("process enqueue failed", { fileId, error });
      const errorMessage =
        error instanceof Error && error.message ? error.message : "processing enqueue failed";
      return c.json({ error: errorMessage, details: String(error) }, 500);
    }
  });

  app.get("/files/:fileId", async (c) => {
    const { fileId } = c.req.param();
    const record = await service.getStatus(fileId);
    if (!record) return c.json({ error: "not found" }, 404);
    return c.json(record);
  });

  // SSR route for homepage
  app.get("/", async (c) => {
    const appProps: AppProps = {
      serviceAccountEmail: config.serviceAccountEmail,
    };

    let html: string;

    if (isDev && vite) {
      // Development: use Vite's transform
      const template = readFileSync(resolve("index.html"), "utf-8");
      const transformedTemplate = await vite.transformIndexHtml(c.req.url, template);

      const appHtml = renderToString(<App {...appProps} />);

      html = transformedTemplate
        .replace("<!--app-html-->", appHtml)
        .replace(
          "</body>",
          `<script>window.__SSR_DATA__ = ${JSON.stringify(appProps)};</script></body>`,
        );
    } else {
      // Production: use manifest
      const manifestPath = resolve("dist/client/.vite/manifest.json");
      const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
      const entry = manifest["src/client.tsx"];

      const appHtml = renderToString(<App {...appProps} />);

      let scriptTags = "";
      if (entry) {
        const cssFiles = entry.css || [];
        const cssTags = cssFiles
          .map((css: string) => `<link rel="stylesheet" href="/${css}">`)
          .join("\n");

        scriptTags = `${cssTags}
<script type="module" src="/${entry.file}"></script>`;
      }

      html = `<!DOCTYPE html>
<html lang="en">
	<head>
		<meta charset="UTF-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1.0" />
		<title>Meet Recording Quiz Maker</title>
		<script src="https://cdn.tailwindcss.com"></script>
	</head>
	<body>
		<div id="root">${appHtml}</div>
		<script>window.__SSR_DATA__ = ${JSON.stringify(appProps)};</script>
		${scriptTags}
	</body>
</html>`;
    }

    return c.html(html);
  });

  // Static files for production
  if (!isDev) {
    const { serveStatic } = await import("@hono/node-server/serve-static");
    app.use("/assets/*", serveStatic({ root: "./dist/client" }));
  }

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
