export type ProcessingStatus = "pending" | "processing" | "succeeded" | "failed";

export interface MeetingFile {
  fileId: string;
  folderId?: string;
  title?: string;
  status: ProcessingStatus;
  modifiedTime?: string;
  formId?: string;
  formUrl?: string;
  geminiSummary?: string;
  questionCount?: number;
  error?: string;
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
