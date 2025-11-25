import type { DriveClient, DriveFileMetadata } from "../clients/drive";
import type { FormsClient } from "../clients/forms";
import type { GeminiClient } from "../clients/gemini";
import type { AppConfig } from "../config";
import { logger } from "../logger.js";
import type { MeetingFilesRepository } from "../repositories/meetingFilesRepository";
import type { MeetingFile } from "../types";

export interface ProcessingServiceDeps {
  config: AppConfig;
  repo: MeetingFilesRepository;
  driveClient: DriveClient;
  formsClient: FormsClient;
  geminiClient: GeminiClient;
}

export class ProcessingService {
  private config: AppConfig;
  private repo: MeetingFilesRepository;
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

  async processFile(input: {
    fileId: string;
    force?: boolean;
    metadata?: DriveFileMetadata;
    questionCount?: number;
  }): Promise<MeetingFile> {
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

    const meta = metadata ?? (await this.drive.getFileMetadata(fileId));
    const title = meta.name ?? `Meeting ${fileId}`;

    await this.repo.setStatus(fileId, "processing", {
      folderId: this.config.googleDriveFolderId,
      title,
      modifiedTime: meta.modifiedTime,
      questionCount,
    });

    const transcript = await this.drive.exportDocumentText(fileId);
    logger.info("process_file_transcript_fetched", {
      fileId,
      transcriptLength: transcript.length,
    });
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

    const form = await this.forms.createQuizForm(quizPayload);
    logger.info("process_file_form_created", {
      fileId,
      formId: form.formId,
      formUrl: form.formUrl,
    });

    await this.repo.setStatus(fileId, "succeeded", {
      folderId: this.config.googleDriveFolderId,
      title,
      modifiedTime: meta.modifiedTime,
      formId: form.formId,
      formUrl: form.formUrl,
      geminiSummary: quizPayload.summary,
      questionCount: quizPayload.questions.length,
    });

    const record = await this.repo.get(fileId);
    if (!record) {
      throw new Error("Failed to read record after processing");
    }
    logger.info("process_file_complete", { fileId, status: record.status });
    return record;
  }

  async getStatus(fileId: string): Promise<MeetingFile | undefined> {
    return this.repo.get(fileId);
  }

  private hasMetadataChanged(existing: MeetingFile, meta: DriveFileMetadata): boolean {
    if (!existing.modifiedTime || !meta.modifiedTime) return false;
    return existing.modifiedTime !== meta.modifiedTime;
  }
}
