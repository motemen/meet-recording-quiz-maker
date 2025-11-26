import type { FormEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { DriveFile } from "../types.js";
import type { AppState } from "./types.js";

function formatStatus(record?: DriveFile) {
  if (!record) return "";
  const lines = [`Status: ${record.status}`];
  if (record.title) lines.push(`Title: ${record.title}`);
  if (record.formUrl) lines.push(`Form URL: ${record.formUrl}`);
  if (record.progress) {
    const { step, message, percent } = record.progress;
    const percentText = typeof percent === "number" ? `${percent}% ` : "";
    lines.push(`Progress: ${percentText}${step}${message ? ` (${message})` : ""}`);
  }
  if (record.error) lines.push(`Error: ${record.error}`);
  return lines.join("\n");
}

async function copyToClipboard(value: string) {
  try {
    await navigator.clipboard.writeText(value);
  } catch (error) {
    console.error("copy failed", error);
  }
}

async function readJson<T>(response: Response) {
  const data = await response.json();
  return data as T;
}

export function App({ initialState }: { initialState: AppState }) {
  const [driveUrl, setDriveUrl] = useState("");
  const [record, setRecord] = useState<DriveFile | undefined>(initialState.initialRecord);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const statusText = useMemo(() => formatStatus(record), [record]);

  useEffect(() => {
    return () => {
      if (pollTimer.current) clearTimeout(pollTimer.current);
    };
  }, []);

  const startPolling = (fileId: string) => {
    const poll = async () => {
      try {
        const resp = await fetch(`/files/${fileId}`);
        const data = await readJson<DriveFile | { error: string }>(resp);
        if ("fileId" in (data as DriveFile) || (data as DriveFile).status) {
          const driveFile = data as DriveFile;
          setRecord(driveFile);
          if (driveFile.status === "succeeded" || driveFile.status === "failed") return;
        }
        pollTimer.current = setTimeout(poll, 2000);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(`Status check error: ${message}`);
      }
    };
    poll();
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    if (!driveUrl.trim()) {
      setError("Please enter a Drive URL.");
      return;
    }
    if (pollTimer.current) {
      clearTimeout(pollTimer.current);
      pollTimer.current = null;
    }
    setIsSubmitting(true);
    try {
      const resp = await fetch("/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ driveUrl: driveUrl.trim(), force: true }),
      });
      const data = await readJson<DriveFile | { error: string; fileId?: string }>(resp);
      if (!resp.ok) {
        const message = (data as { error?: string }).error || "Request failed";
        throw new Error(message);
      }
      const driveFile = data as DriveFile;
      setRecord(driveFile);
      if (driveFile.fileId) startPolling(driveFile.fileId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(`Error: ${message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-8 px-4 py-10 md:px-6">
      <header className="space-y-4">
        <h1 className="text-3xl font-bold leading-tight text-slate-900">
          Meet Recording Quiz Maker
        </h1>
        <p className="text-base text-slate-700">
          Share the document with{" "}
          <span className="inline-flex items-center gap-2 rounded-lg bg-slate-100 px-2 py-1 text-slate-900 transition hover:bg-slate-200 focus-within:bg-slate-200">
            <span className="font-mono">{initialState.serviceAccountEmail}</span>
            <button
              type="button"
              onClick={() => copyToClipboard(initialState.serviceAccountEmail)}
              className="inline-flex items-center justify-center rounded-md border border-slate-300 p-1 text-slate-700 transition hover:border-indigo-300 hover:text-indigo-700 hover:bg-indigo-50 focus:outline-none focus:ring-2 focus:ring-indigo-200"
              aria-label="Copy service account email"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-4 w-4"
                aria-hidden="true"
                focusable="false"
              >
                <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
                <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h8" />
              </svg>
            </button>
          </span>{" "}
          to create a quiz.
        </p>
      </header>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <input
            name="driveUrl"
            type="url"
            required
            value={driveUrl}
            onChange={(event) => setDriveUrl(event.target.value)}
            placeholder="https://docs.google.com/document/d/..."
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-base shadow-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200"
          />
        </div>

        <button
          type="submit"
          disabled={isSubmitting}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-300 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {isSubmitting ? "Submitting..." : "Create quiz"}
        </button>
      </form>

      {error ? (
        <p className="text-sm text-red-600" role="alert">
          {error}
        </p>
      ) : null}

      <output
        className="whitespace-pre-wrap text-sm leading-relaxed text-slate-800"
        aria-live="polite"
      >
        {statusText || "Enter a Drive URL to create a quiz."}
      </output>
    </main>
  );
}
