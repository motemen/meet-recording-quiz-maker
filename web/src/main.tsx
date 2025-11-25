import { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";

type ManualResponse = {
  fileId: string;
  status?: string;
};

type ErrorResponse = {
  error?: string;
  details?: string;
};

function App() {
  const [driveUrl, setDriveUrl] = useState("");
  const [questionCount, setQuestionCount] = useState<string | undefined>("10");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<ManualResponse | undefined>();
  const [error, setError] = useState<string | undefined>();

  const isValid = useMemo(() => driveUrl.trim().length > 0, [driveUrl]);

  const handleSubmit = async () => {
    setIsSubmitting(true);
    setError(undefined);
    setResult(undefined);

    try {
      const response = await fetch("/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          driveUrl: driveUrl.trim(),
          questionCount: questionCount ? Number(questionCount) : undefined,
        }),
      });

      const body = (await response.json()) as ManualResponse | ErrorResponse;
      if (!response.ok) {
        const message = "error" in body && body.error ? body.error : "Request failed";
        throw new Error(message);
      }

      setResult(body as ManualResponse);
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Unexpected error");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 px-6 py-10">
      <header className="space-y-2 text-center">
        <p className="text-sm uppercase tracking-[0.2em] text-slate-400">
          Google Meet → Google Forms
        </p>
        <h1 className="text-3xl font-bold">Meet Recording Quiz Maker</h1>
        <p className="text-base text-slate-300">
          Paste a Google Drive transcript URL to generate a quiz. The request will run through the
          existing /manual API endpoint.
        </p>
      </header>

      <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 shadow-xl shadow-slate-950/60">
        <div className="space-y-4">
          <label className="block space-y-2">
            <span className="text-sm font-semibold text-slate-100">Google Drive file URL</span>
            <input
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-4 py-3 text-base text-slate-50 shadow-inner shadow-black/20 focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
              type="url"
              placeholder="https://docs.google.com/document/d/..."
              value={driveUrl}
              onChange={(e) => setDriveUrl(e.target.value)}
            />
          </label>

          <label className="block space-y-2">
            <span className="text-sm font-semibold text-slate-100">
              Number of quiz questions (optional)
            </span>
            <input
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-4 py-3 text-base text-slate-50 shadow-inner shadow-black/20 focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
              type="number"
              inputMode="numeric"
              min="1"
              placeholder="Auto"
              value={questionCount ?? ""}
              onChange={(e) => setQuestionCount(e.target.value || undefined)}
            />
            <p className="text-sm text-slate-400">
              Leave blank to let the service decide how many questions to build.
            </p>
          </label>

          <button
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-cyan-500 px-4 py-3 text-base font-semibold text-slate-950 shadow-lg shadow-cyan-500/20 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
            type="button"
            disabled={!isValid || isSubmitting}
            onClick={handleSubmit}
          >
            {isSubmitting ? "Submitting..." : "Create quiz"}
          </button>
        </div>

        <div className="mt-6 space-y-3">
          {error ? (
            <div className="rounded-lg border border-red-500/50 bg-red-500/10 px-4 py-3 text-red-100">
              Error: {error}
            </div>
          ) : null}

          {result ? (
            <div className="space-y-2 rounded-lg border border-green-500/50 bg-green-500/10 px-4 py-3 text-green-50">
              <div className="font-semibold">Processing started</div>
              <div className="text-sm text-green-100">
                File ID: <span className="font-mono">{result.fileId}</span>
              </div>
              <div className="text-sm text-green-100">
                Check status at <code className="font-mono">/files/{result.fileId}</code>.
              </div>
            </div>
          ) : null}
        </div>
      </section>
    </main>
  );
}

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(<App />);
}
