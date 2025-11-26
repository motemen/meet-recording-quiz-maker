import "dotenv/config";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createServer as createViteServer, type ViteDevServer } from "vite";
import { Hono } from "hono";
import { DriveClient } from "./clients/drive.js";
import { FormsClient } from "./clients/forms.js";
import { GeminiClient } from "./clients/gemini.js";
import type { AppConfig } from "./config.js";
import { loadConfig } from "./config.js";
import { logger } from "./logger.js";
import { DriveFilesRepository } from "./repositories/driveFilesRepository.js";
import { ProcessingService } from "./services/processing.js";
import { extractFileIdFromUrl } from "./utils/drive.js";
import { accessSecretPayload } from "./utils/secretManager.js";
import type { AppState } from "./ssr/types.js";

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

function isApiRoute(pathname: string) {
  return (
    pathname === "/healthz" ||
    pathname.startsWith("/tasks/scan") ||
    pathname.startsWith("/tasks/process") ||
    pathname.startsWith("/process") ||
    pathname.startsWith("/files/")
  );
}

function getContentType(filePath: string) {
  if (filePath.endsWith(".js")) return "application/javascript";
  if (filePath.endsWith(".css")) return "text/css";
  if (filePath.endsWith(".svg")) return "image/svg+xml";
  if (filePath.endsWith(".json")) return "application/json";
  if (filePath.endsWith(".png")) return "image/png";
  if (filePath.endsWith(".jpg") || filePath.endsWith(".jpeg")) return "image/jpeg";
  if (filePath.endsWith(".ico")) return "image/x-icon";
  return "application/octet-stream";
}

async function nodeRequestToFetchRequest(req: IncomingMessage, url: URL) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (!value) continue;
    if (Array.isArray(value)) {
      value.forEach((item) => headers.append(key, item));
    } else {
      headers.set(key, value);
    }
  }

  const method = req.method || "GET";
  if (method === "GET" || method === "HEAD") {
    return new Request(url, { method, headers });
  }

  const chunks: Uint8Array[] = [];
  await new Promise<void>((resolvePromise, rejectPromise) => {
    req
      .on("data", (chunk) => chunks.push(chunk))
      .on("end", () => resolvePromise())
      .on("error", (error) => rejectPromise(error));
  });

  return new Request(url, { method, headers, body: Buffer.concat(chunks) });
}

async function sendResponse(res: ServerResponse, response: Response) {
  res.statusCode = response.status;
  for (const [key, value] of response.headers.entries()) {
    res.setHeader(key, value);
  }
  if (!response.body) {
    res.end();
    return;
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  res.end(buffer);
}

function createApiApp(service: ProcessingService, config: AppConfig) {
  const app = new Hono();

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
          .replace("__INITIAL_STATE__", escapeState(state));
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
        .replace("__INITIAL_STATE__", escapeState(state));
    },
  };
}

async function tryServeStatic(clientDistPath: string, url: URL, res: ServerResponse) {
  if (
    !url.pathname.startsWith("/assets/") &&
    url.pathname !== "/favicon.ico" &&
    url.pathname !== "/favicon.svg"
  ) {
    return false;
  }

  const relativePath = url.pathname.startsWith("/") ? url.pathname.slice(1) : url.pathname;
  const filePath = resolve(clientDistPath, relativePath);
  if (!filePath.startsWith(clientDistPath)) return false;

  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) return false;
    res.statusCode = 200;
    res.setHeader("Content-Type", getContentType(filePath));
    await new Promise<void>((resolvePromise) => {
      createReadStream(filePath)
        .on("end", () => resolvePromise())
        .pipe(res);
    });
    return true;
  } catch {
    return false;
  }
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

  const server = createServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);

    if (isApiRoute(url.pathname)) {
      try {
        const request = await nodeRequestToFetchRequest(req, url);
        const response = await apiApp.fetch(request);
        await sendResponse(res, response);
      } catch (error) {
        logger.error("api_request_failed", { error });
        res.statusCode = 500;
        res.end("Internal Server Error");
      }
      return;
    }

    if (isProd && (await tryServeStatic(clientDistPath, url, res))) {
      return;
    }

    try {
      const state: AppState = { serviceAccountEmail: config.serviceAccountEmail };
      if (!isProd && renderer.devServer) {
        renderer.devServer.middlewares(req, res, async () => {
          try {
            const html = await renderer.renderPage(url.pathname, state);
            res.statusCode = 200;
            res.setHeader("Content-Type", "text/html");
            res.end(html);
          } catch (error) {
            logger.error("ssr_render_failed", { error });
            res.statusCode = 500;
            res.end("SSR render failed");
          }
        });
        return;
      }

      const html = await renderer.renderPage(url.pathname, state);
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/html");
      res.end(html);
    } catch (error) {
      logger.error("render_failed", { error });
      res.statusCode = 500;
      res.end("Internal Server Error");
    }
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
