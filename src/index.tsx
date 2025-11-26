import "dotenv/config";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { HttpBindings } from "@hono/node-server";
import { getRequestListener } from "@hono/node-server";
import { Hono } from "hono";
import { serveStatic } from "hono/serve-static.module";
import { createServer as createViteServer, type ViteDevServer } from "vite";

import { DriveClient } from "./clients/drive.js";
import { FormsClient } from "./clients/forms.js";
import { GeminiClient } from "./clients/gemini.js";
import type { AppConfig } from "./config.js";
import { loadConfig } from "./config.js";
import { logger } from "./logger.js";
import { DriveFilesRepository } from "./repositories/driveFilesRepository.js";
import { ProcessingService } from "./services/processing.js";
import type { AppState } from "./ssr/types.js";
import { extractFileIdFromUrl } from "./utils/drive.js";
import { accessSecretPayload } from "./utils/secretManager.js";

type RenderContext = {
  renderPage: (url: string, state: AppState) => Promise<string>;
  devServer?: ViteDevServer;
};

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

function createApiApp(service: ProcessingService, config: AppConfig) {
  const app = new Hono<{ Bindings: HttpBindings }>();

  app.get("/healthz", (c) => c.json({ ok: true }));

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

  return app;
}

function escapeState(state: AppState) {
  return JSON.stringify(state).replace(/</g, "\\u003c");
}

async function createRenderer(
  isProd: boolean,
  templatePath: string,
  clientDistPath: string,
): Promise<RenderContext> {
  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "custom",
    });
    return {
      devServer: vite,
      renderPage: async (url, state) => {
        let template = await readFile(templatePath, "utf-8");
        template = await vite.transformIndexHtml(url, template);
        const { render } = await vite.ssrLoadModule("/src/entry-server.tsx");
        const { html, head } = await render(url, state);
        return template
          .replace("<!--app-html-->", html)
          .replace("<!--app-head-->", head ?? "")
          .replace('"__INITIAL_STATE__"', escapeState(state));
      },
    };
  }

  const serverEntryPath = pathToFileURL(resolve(clientDistPath, "../server/entry-server.js")).href;
  const { render } = await import(serverEntryPath);
  const template = await readFile(resolve(clientDistPath, "index.html"), "utf-8");
  return {
    renderPage: async (url, state) => {
      const { html, head } = await render(url, state);
      return template
        .replace("<!--app-html-->", html)
        .replace("<!--app-head-->", head ?? "")
        .replace('"__INITIAL_STATE__"', escapeState(state));
    },
  };
}

async function bootstrap() {
  const config = loadConfig();
  await ensureGeminiApiKey(config);

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

  const apiApp = createApiApp(service, config);

  const isProd = process.env.NODE_ENV === "production";
  const rootDir = dirname(fileURLToPath(import.meta.url));
  const templatePath = resolve(rootDir, "../index.html");
  const clientDistPath = resolve(rootDir, "../dist/client");
  const renderer = await createRenderer(isProd, templatePath, clientDistPath);

  const app = new Hono<{ Bindings: HttpBindings }>();
  app.route("/", apiApp);

  if (isProd) {
    app.use("/assets/*", serveStatic({ root: clientDistPath }));
    app.use("/favicon.ico", serveStatic({ path: resolve(clientDistPath, "favicon.ico") }));
    app.use("/favicon.svg", serveStatic({ path: resolve(clientDistPath, "favicon.svg") }));
  }

  app.get("*", async (c) => {
    const state: AppState = { serviceAccountEmail: config.serviceAccountEmail };

    const renderPage = async () => {
      const html = await renderer.renderPage(c.req.path, state);
      return c.html(html);
    };

    try {
      return await renderPage();
    } catch (error) {
      logger.error("render_failed", { error });
      return c.text("Internal Server Error", 500);
    }
  });

  const requestListener = getRequestListener((request, env) => app.fetch(request, env));

  const server = createServer((req, res) => {
    if (!isProd && renderer.devServer) {
      renderer.devServer.middlewares(req, res, () => {
        requestListener(req, res);
      });
      return;
    }

    requestListener(req, res);
  });

  const port = config.port;
  server.listen(port, () => {
    logger.info("server_started", { port, mode: isProd ? "production" : "development" });
  });
}

bootstrap().catch((error) => {
  logger.error("Failed to start server", { error });
  process.exit(1);
});
