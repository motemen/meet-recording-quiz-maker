export type ProcessingStatus = "pending" | "processing" | "succeeded" | "failed";

export type ProcessingStep =
  | "queued"
  | "metadata"
  | "transcript"
  | "quiz"
  | "form"
  | "done"
  | "error";

export interface ProcessingProgress {
  step: ProcessingStep;
  message?: string;
  percent?: number;
}

export interface DriveFile {
  fileId: string;
  title?: string;
  status: ProcessingStatus;
  modifiedTime?: string;
  formId?: string;
  formUrl?: string;
  geminiSummary?: string;
  questionCount?: number;
  error?: string;
  progress?: ProcessingProgress;
  createdAt: string;
  updatedAt: string;
}

export interface QuizQuestion {
  question: string;
  options: string[];
  correctOptionIndex: number;
  rationale?: string;
}

export interface QuizPayload {
  title: string;
  summary: string;
  questions: QuizQuestion[];
}
