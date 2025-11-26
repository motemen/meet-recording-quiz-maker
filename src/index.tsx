import "dotenv/config";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import type { FC, JSX } from "hono/jsx";
import { jsxRenderer } from "hono/jsx-renderer";
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

const CopyIcon: FC<JSX.HTMLAttributes> = (props) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
    {...props}
  >
    <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
    <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h8" />
  </svg>
);

const CheckIcon: FC<JSX.HTMLAttributes> = (props) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
    {...props}
  >
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

const Layout = jsxRenderer(({ children }) => (
  <html lang="en">
    <head>
      <meta charSet="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>Meet Recording Quiz Maker</title>
      <script src="https://cdn.tailwindcss.com" />
      <style>{`
        .icon-fade {
          transition: opacity 200ms ease;
        }
      `}</style>
    </head>
    <body className="min-h-screen bg-slate-50 text-slate-900">
      <main className="mx-auto flex max-w-4xl flex-col gap-8 px-4 py-10 md:px-6">{children}</main>
    </body>
  </html>
));

type HomePageProps = {
  serviceAccountEmail: string;
};

const HomePage: FC<HomePageProps> = ({ serviceAccountEmail }) => {
  const submissionScript = `(() => {
    const form = document.getElementById('manual-form');
    const statusEl = document.getElementById('status');
    const copyBtn = document.getElementById('copy-email');
    if (!form || !statusEl) return;

    let pollTimer;
    let copyResetTimer;
    const copyIcon = copyBtn?.querySelector('[data-icon="copy"]');
    const checkIcon = copyBtn?.querySelector('[data-icon="check"]');

    const showCopyIcon = () => {
      copyIcon?.classList.remove('opacity-0');
      copyIcon?.classList.add('opacity-100');
      checkIcon?.classList.remove('opacity-100');
      checkIcon?.classList.add('opacity-0');
    };

    const showCheckIconTemporarily = () => {
      copyIcon?.classList.remove('opacity-100');
      copyIcon?.classList.add('opacity-0');
      checkIcon?.classList.remove('opacity-0');
      checkIcon?.classList.add('opacity-100');
      if (copyResetTimer) clearTimeout(copyResetTimer);
      copyResetTimer = setTimeout(showCopyIcon, 2000);
    };

    copyBtn?.addEventListener('click', async () => {
      try {
        const email = copyBtn.dataset.email || '';
        await navigator.clipboard.writeText(email);
        showCheckIconTemporarily();
      } catch (error) {
        console.error('copy failed', error);
        showCopyIcon();
      }
    });

    const renderStatus = (record) => {
      if (!record) return;
      let text = 'Status: ' + record.status;
      if (record.title) text += '\\nTitle: ' + record.title;
      if (record.formUrl) text += '\\nForm URL: ' + record.formUrl;
      if (record.progress) {
        const { step, message, percent } = record.progress;
        const percentText = typeof percent === 'number' ? percent + '% ' : '';
        text += '\\nProgress: ' + percentText + step + (message ? ' (' + message + ')' : '');
      }
      if (record.error) text += '\\nError: ' + record.error;
      statusEl.textContent = text;
    };

    const startPolling = (fileId) => {
      const poll = async () => {
        try {
          const resp = await fetch('/files/' + fileId);
          if (!resp.ok) throw new Error('Failed to fetch status');
          const data = await resp.json();
          renderStatus(data);
          if (data.status === 'succeeded' || data.status === 'failed') return;
          pollTimer = setTimeout(poll, 2000);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          statusEl.textContent = 'Status check error: ' + message;
        }
      };
      poll();
    };

    form.addEventListener('submit', async (event) => {
      event.preventDefault();

      const driveUrlInput = form.querySelector('[name="driveUrl"]');
      const submitBtn = form.querySelector('button[type="submit"]');
      const driveUrl = driveUrlInput?.value?.trim();
      const force = true;

      if (!driveUrl) {
        statusEl.textContent = 'Please enter a Drive URL.';
        return;
      }

      if (pollTimer) clearTimeout(pollTimer);
      statusEl.textContent = 'Submitting...';
      if (submitBtn) submitBtn.disabled = true;
      try {
        const resp = await fetch('/process', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ driveUrl, force })
        });
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.error || 'Request failed');
        renderStatus(data);
        if (data.fileId) startPolling(data.fileId);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        statusEl.textContent = 'Error: ' + message;
      } finally {
        if (submitBtn) submitBtn.disabled = false;
      }
    });
  })();`;

  return (
    <>
      <header className="space-y-4">
        <h1 className="text-3xl font-bold leading-tight text-slate-900">
          Meet Recording Quiz Maker
        </h1>
        <p className="text-base text-slate-700">
          Share the document with{" "}
          <span className="inline-flex items-center gap-2 rounded-lg bg-slate-100 px-2 py-1 text-slate-900 transition hover:bg-slate-200 focus-within:bg-slate-200">
            <span className="font-mono">{serviceAccountEmail}</span>
            <button
              id="copy-email"
              type="button"
              data-email={serviceAccountEmail}
              className="inline-flex items-center justify-center rounded-md border border-slate-300 p-1 text-slate-700 transition hover:border-indigo-300 hover:text-indigo-700 hover:bg-indigo-50 focus:outline-none focus:ring-2 focus:ring-indigo-200"
              aria-label="Copy service account email"
            >
              <span className="relative inline-flex h-4 w-4 items-center justify-center">
                <CopyIcon
                  className="icon-fade absolute inset-0 h-4 w-4 opacity-100"
                  data-icon="copy"
                  aria-hidden="true"
                  focusable="false"
                />
                <CheckIcon
                  className="icon-fade absolute inset-0 h-4 w-4 opacity-0 text-emerald-600"
                  data-icon="check"
                  aria-hidden="true"
                  focusable="false"
                />
              </span>
            </button>
          </span>{" "}
          to create a quiz.
        </p>
      </header>

      <form id="manual-form" className="space-y-4">
        <div>
          <input
            name="driveUrl"
            type="url"
            required
            placeholder="https://docs.google.com/document/d/..."
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-base shadow-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200"
          />
        </div>

        <button
          type="submit"
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-300"
        >
          Create quiz
        </button>
      </form>

      <pre id="status" className="whitespace-pre-wrap text-sm leading-relaxed text-slate-800" />

      <script dangerouslySetInnerHTML={{ __html: submissionScript }} />
    </>
  );
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

async function bootstrap() {
  const config = loadConfig();
  await ensureGeminiApiKey(config);
  const app = new Hono();

  app.use("/*", Layout);

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

  app.get("/", (c) => c.render(<HomePage serviceAccountEmail={config.serviceAccountEmail} />));

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
