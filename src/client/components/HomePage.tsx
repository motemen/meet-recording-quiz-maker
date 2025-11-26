import type React from "react";
import { useEffect, useRef, useState } from "react";

type ProcessingStatus = "pending" | "processing" | "succeeded" | "failed";

type ProgressInfo = {
  step: string;
  message?: string;
  percent?: number;
};

type StatusRecord = {
  fileId: string;
  status: ProcessingStatus;
  title?: string;
  formUrl?: string;
  progress?: ProgressInfo;
  error?: string;
};

type HomePageProps = {
  serviceAccountEmail: string;
};

const CopyIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
    focusable="false"
  >
    <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
    <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h8" />
  </svg>
);

export const HomePage: React.FC<HomePageProps> = ({ serviceAccountEmail }) => {
  const [driveUrl, setDriveUrl] = useState("");
  const [_status, setStatus] = useState<StatusRecord | null>(null);
  const [statusMessage, setStatusMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const pollTimerRef = useRef<NodeJS.Timeout | null>(null);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(serviceAccountEmail);
    } catch (error) {
      console.error("copy failed", error);
    }
  };

  const renderStatus = (record: StatusRecord | null) => {
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
    setStatusMessage(text);
  };

  const startPolling = (fileId: string) => {
    const poll = async () => {
      try {
        const resp = await fetch(`/files/${fileId}`);
        if (!resp.ok) throw new Error("Failed to fetch status");
        const data = (await resp.json()) as StatusRecord;
        setStatus(data);
        renderStatus(data);
        if (data.status === "succeeded" || data.status === "failed") return;
        pollTimerRef.current = setTimeout(poll, 2000);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setStatusMessage(`Status check error: ${message}`);
      }
    };
    poll();
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    const trimmedUrl = driveUrl.trim();
    if (!trimmedUrl) {
      setStatusMessage("Please enter a Drive URL.");
      return;
    }

    if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    setStatusMessage("Submitting...");
    setIsSubmitting(true);

    try {
      const resp = await fetch("/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ driveUrl: trimmedUrl, force: true }),
      });
      const data = (await resp.json()) as StatusRecord & { error?: string };
      if (!resp.ok) throw new Error(data.error || "Request failed");
      setStatus(data);
      renderStatus(data);
      if (data.fileId) startPolling(data.fileId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatusMessage(`Error: ${message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  useEffect(() => {
    return () => {
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    };
  }, []);

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
              type="button"
              onClick={handleCopy}
              className="inline-flex items-center justify-center rounded-md border border-slate-300 p-1 text-slate-700 transition hover:border-indigo-300 hover:text-indigo-700 hover:bg-indigo-50 focus:outline-none focus:ring-2 focus:ring-indigo-200"
              aria-label="Copy service account email"
            >
              <CopyIcon className="h-4 w-4" />
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
            onChange={(e) => setDriveUrl(e.target.value)}
            placeholder="https://docs.google.com/document/d/..."
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-base shadow-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200"
          />
        </div>

        <button
          type="submit"
          disabled={isSubmitting}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-300 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Create quiz
        </button>
      </form>

      <pre className="whitespace-pre-wrap text-sm leading-relaxed text-slate-800">
        {statusMessage}
      </pre>
    </>
  );
};
