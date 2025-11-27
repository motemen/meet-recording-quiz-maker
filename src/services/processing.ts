import { FieldValue } from "@google-cloud/firestore";
import type { DriveClient, DriveFileMetadata } from "../clients/drive";
import type { FormsClient } from "../clients/forms";
import type { GeminiClient } from "../clients/gemini";
import type { AppConfig } from "../config";
import { logger } from "../logger.js";
import type { DriveFilesRepository } from "../repositories/driveFilesRepository";
import type { DriveFile, ProcessingProgress, ProcessingStep, QuizPayload } from "../types";

export interface ProcessingServiceDeps {
  config: AppConfig;
  repo: DriveFilesRepository;
  driveClient: DriveClient;
  formsClient: FormsClient;
  geminiClient: GeminiClient;
}

export class ProcessingService {
  private config: AppConfig;
  private repo: DriveFilesRepository;
  private drive: DriveClient;
  private forms: FormsClient;
  private gemini: GeminiClient;

  constructor(deps: ProcessingServiceDeps) {
    this.config = deps.config;
    this.repo = deps.repo;
    this.drive = deps.driveClient;
    this.forms = deps.formsClient;
    this.gemini = deps.geminiClient;
  }

  async scanFolder(): Promise<{ processed: number; skipped: number; errors: number }> {
    if (!this.config.googleDriveFolderId) {
      throw new Error("GOOGLE_DRIVE_FOLDER_ID is required for folder scanning");
    }
    logger.info("scan_folder_start", { folderId: this.config.googleDriveFolderId });
    const files = await this.drive.listFolderFiles(this.config.googleDriveFolderId);
    logger.info("scan_folder_listed", { fileCount: files.length });

    let processed = 0;
    let skipped = 0;
    let errors = 0;

    for (const file of files) {
      try {
        const existing = await this.repo.get(file.id);
        const unchanged =
          existing && existing.status === "succeeded" && !this.hasMetadataChanged(existing, file);

        if (unchanged) {
          logger.debug("scan_file_skipped_unchanged", { fileId: file.id });
          skipped += 1;
          continue;
        }

        await this.processFile({ fileId: file.id, metadata: file });
        processed += 1;
      } catch (error) {
        errors += 1;
        logger.error("Failed processing file during scan", { fileId: file.id, error });
      }
    }

    const summary = { processed, skipped, errors };
    logger.info("scan_folder_complete", summary);
    return summary;
  }

  async enqueueProcessing(input: {
    fileId: string;
    force?: boolean;
    questionCount?: number;
  }): Promise<DriveFile> {
    const { fileId, force = false, questionCount = 10 } = input;
    const existing = await this.repo.get(fileId);
    if (existing && existing.status === "succeeded" && !force) {
      return existing;
    }

    const clear = FieldValue.delete();
    await this.repo.setStatus(fileId, "processing", {
      title: clear,
      modifiedTime: clear,
      formId: clear,
      formUrl: clear,
      geminiSummary: clear,
      error: clear,
      progress: { step: "queued", message: "Queued for processing", percent: 0 },
      questionCount,
    });

    void this.processFile({ fileId, force, questionCount }).catch((error) => {
      const message = error instanceof Error && error.message ? error.message : "Processing failed";
      logger.error("enqueue_processing_failed", { fileId, error });
      void this.repo.setStatus(fileId, "failed", {
        error: message,
        progress: { step: "error", message, percent: 100 },
      });
    });

    const record = await this.repo.get(fileId);
    if (!record) {
      throw new Error("Failed to enqueue processing");
    }
    return record;
  }

  async processFile(input: {
    fileId: string;
    force?: boolean;
    metadata?: DriveFileMetadata;
    questionCount?: number;
  }): Promise<DriveFile> {
    const { fileId, force = false, metadata, questionCount = 10 } = input;
    logger.info("process_file_start", {
      fileId,
      force,
      requestedQuestionCount: questionCount,
      hasMetadata: Boolean(metadata),
    });
    const existing = await this.repo.get(fileId);

    if (existing && existing.status === "succeeded" && !force) {
      logger.info("process_file_short_circuit_existing", { fileId });
      return existing;
    }

    const clear = FieldValue.delete();
    await this.repo.setStatus(fileId, "processing", {
      title: clear,
      modifiedTime: clear,
      formId: clear,
      formUrl: clear,
      geminiSummary: clear,
      error: clear,
      progress: { step: "metadata", message: "Fetching metadata", percent: 5 },
      questionCount,
    });

    try {
      const meta = metadata ?? (await this.drive.getFileMetadata(fileId));
      const title = meta.name ?? `Meeting ${fileId}`;

      await this.repo.setStatus(fileId, "processing", {
        title,
        modifiedTime: meta.modifiedTime,
        questionCount,
        progress: { step: "metadata", message: "Metadata fetched", percent: 10 },
      });

      await this.drive.logCaller();
      const transcript = await this.drive.exportDocumentText(fileId);
      logger.info("process_file_transcript_fetched", {
        fileId,
        transcriptLength: transcript.length,
      });
      await this.updateProgress(fileId, "transcript", "Transcript fetched", 40);

      const quizPayload = await this.gemini.generateQuiz({
        title,
        transcript,
        questionCount,
        additionalPrompt: this.config.quizAdditionalPrompt,
      });
      logger.info("process_file_quiz_generated", {
        fileId,
        questionCount: quizPayload.questions.length,
        hasSummary: Boolean(quizPayload.summary),
        usedAdditionalPrompt: Boolean(this.config.quizAdditionalPrompt),
      });
      await this.updateProgress(fileId, "quiz", "Quiz generated", 70);

      const randomizedQuiz = this.shuffleQuizOptions(quizPayload);

      const form = await this.forms.createQuizForm(randomizedQuiz);
      logger.info("process_file_form_created", {
        fileId,
        formId: form.formId,
        formUrl: form.formUrl,
      });
      await this.updateProgress(fileId, "form", "Form created", 90);

      await this.repo.setStatus(fileId, "succeeded", {
        title,
        modifiedTime: meta.modifiedTime,
        formId: form.formId,
        formUrl: form.formUrl,
        geminiSummary: quizPayload.summary,
        questionCount: quizPayload.questions.length,
        progress: { step: "done", message: "Completed", percent: 100 },
      });

      const record = await this.repo.get(fileId);
      if (!record) {
        throw new Error("Failed to read record after processing");
      }
      logger.info("process_file_complete", { fileId, status: record.status });
      return record;
    } catch (error) {
      const message = error instanceof Error && error.message ? error.message : "Processing failed";
      await this.repo.setStatus(fileId, "failed", {
        error: message,
        progress: { step: "error", message, percent: 100 },
      });
      logger.error("process_file_failed", { fileId, error });
      throw error;
    }
  }

  async getStatus(fileId: string): Promise<DriveFile | undefined> {
    return this.repo.get(fileId);
  }

  private hasMetadataChanged(existing: DriveFile, meta: DriveFileMetadata): boolean {
    if (!existing.modifiedTime || !meta.modifiedTime) return false;
    return existing.modifiedTime !== meta.modifiedTime;
  }

  private shuffleQuizOptions(quiz: QuizPayload): QuizPayload {
    return {
      ...quiz,
      questions: quiz.questions.map((question) => {
        const safeCorrectIndex = Math.max(
          0,
          Math.min(question.options.length - 1, question.correctOptionIndex),
        );
        const indexedOptions = question.options.map((value, index) => ({
          value,
          originalIndex: index,
        }));
        for (let i = indexedOptions.length - 1; i > 0; i -= 1) {
          const j = Math.floor(Math.random() * (i + 1));
          [indexedOptions[i], indexedOptions[j]] = [indexedOptions[j], indexedOptions[i]];
        }
        const newCorrectIndex = indexedOptions.findIndex(
          (option) => option.originalIndex === safeCorrectIndex,
        );
        return {
          ...question,
          options: indexedOptions.map((option) => option.value),
          correctOptionIndex: newCorrectIndex >= 0 ? newCorrectIndex : 0,
        };
      }),
    };
  }

  private async updateProgress(
    fileId: string,
    step: ProcessingStep,
    message: string,
    percent: number,
  ): Promise<void> {
    const progress: ProcessingProgress = { step, message, percent };
    await this.repo.setStatus(fileId, "processing", { progress });
  }
}
