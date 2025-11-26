import { useEffect, useRef } from "react";
import { CopyIcon } from "./CopyIcon";

type HomePageProps = {
  serviceAccountEmail: string;
};

export function HomePage({ serviceAccountEmail }: HomePageProps) {
  const statusRef = useRef<HTMLPreElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const copyBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const form = formRef.current;
    const statusEl = statusRef.current;
    const copyBtn = copyBtnRef.current;

    if (!form || !statusEl) return;

    let pollTimer: NodeJS.Timeout | undefined;

    const copyHandler = async () => {
      try {
        await navigator.clipboard.writeText(serviceAccountEmail);
      } catch (error) {
        console.error("copy failed", error);
      }
    };

    if (copyBtn) {
      copyBtn.addEventListener("click", copyHandler);
    }

    const renderStatus = (record: {
      status?: string;
      title?: string;
      formUrl?: string;
      progress?: { step?: string; message?: string; percent?: number };
      error?: string;
    }) => {
      if (!record) return;
      let text = `Status: ${record.status}`;
      if (record.title) text += `\nTitle: ${record.title}`;
      if (record.formUrl) text += `\nForm URL: ${record.formUrl}`;
      if (record.progress) {
        const { step, message, percent } = record.progress;
        const percentText = typeof percent === "number" ? `${percent}% ` : "";
        text += `\nProgress: ${percentText}${step}${message ? ` (${message})` : ""}`;
      }
      if (record.error) text += `\nError: ${record.error}`;
      statusEl.textContent = text;
    };

    const startPolling = (fileId: string) => {
      const poll = async () => {
        try {
          const resp = await fetch(`/files/${fileId}`);
          if (!resp.ok) throw new Error("Failed to fetch status");
          const data = await resp.json();
          renderStatus(data);
          if (data.status === "succeeded" || data.status === "failed") return;
          pollTimer = setTimeout(poll, 2000);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          statusEl.textContent = `Status check error: ${message}`;
        }
      };
      poll();
    };

    const submitHandler = async (event: Event) => {
      event.preventDefault();

      const driveUrlInput = form.querySelector<HTMLInputElement>('[name="driveUrl"]');
      const submitBtn = form.querySelector<HTMLButtonElement>('button[type="submit"]');
      const driveUrl = driveUrlInput?.value?.trim();
      const force = true;

      if (!driveUrl) {
        statusEl.textContent = "Please enter a Drive URL.";
        return;
      }

      if (pollTimer) clearTimeout(pollTimer);
      statusEl.textContent = "Submitting...";
      if (submitBtn) submitBtn.disabled = true;
      try {
        const resp = await fetch("/process", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ driveUrl, force }),
        });
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.error || "Request failed");
        renderStatus(data);
        if (data.fileId) startPolling(data.fileId);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        statusEl.textContent = `Error: ${message}`;
      } finally {
        if (submitBtn) submitBtn.disabled = false;
      }
    };

    form.addEventListener("submit", submitHandler);

    return () => {
      if (pollTimer) clearTimeout(pollTimer);
      form.removeEventListener("submit", submitHandler);
      if (copyBtn) {
        copyBtn.removeEventListener("click", copyHandler);
      }
    };
  }, [serviceAccountEmail]);

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
              ref={copyBtnRef}
              type="button"
              className="inline-flex items-center justify-center rounded-md border border-slate-300 p-1 text-slate-700 transition hover:border-indigo-300 hover:text-indigo-700 hover:bg-indigo-50 focus:outline-none focus:ring-2 focus:ring-indigo-200"
              aria-label="Copy service account email"
            >
              <CopyIcon className="h-4 w-4" />
            </button>
          </span>{" "}
          to create a quiz.
        </p>
      </header>

      <form ref={formRef} id="manual-form" className="space-y-4">
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

      <pre
        ref={statusRef}
        id="status"
        className="whitespace-pre-wrap text-sm leading-relaxed text-slate-800"
      />
    </>
  );
}
