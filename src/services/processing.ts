import { AppConfig } from "../config";
import { DriveClient, DriveFileMetadata } from "../clients/drive";
import { FormsClient } from "../clients/forms";
import { GeminiClient } from "../clients/gemini";
import { MeetingFilesRepository } from "../repositories/meetingFilesRepository";
import { MeetingFile, QuizPayload } from "../types";
import { logger } from "../logger";

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
    const files = await this.drive.listFolderFiles(this.config.googleDriveFolderId);

    let processed = 0;
    let skipped = 0;
    let errors = 0;

    for (const file of files) {
      try {
        const existing = await this.repo.get(file.id);
        const unchanged =
          existing &&
          existing.status === "succeeded" &&
          existing.driveEtag &&
          file.etag &&
          existing.driveEtag === file.etag &&
          !this.hasMetadataChanged(existing, file);

        if (unchanged) {
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

    return { processed, skipped, errors };
  }

  async processFile(input: {
    fileId: string;
    force?: boolean;
    metadata?: DriveFileMetadata;
    questionCount?: number;
  }): Promise<MeetingFile> {
    const { fileId, force = false, metadata, questionCount = 5 } = input;
    const existing = await this.repo.get(fileId);

    if (existing && existing.status === "succeeded" && !force) {
      return existing;
    }

    const meta = metadata ?? (await this.drive.getFileMetadata(fileId));
    const title = meta.name ?? `Meeting ${fileId}`;

    await this.repo.setStatus(fileId, "processing", {
      folderId: this.config.googleDriveFolderId,
      title,
      driveEtag: meta.etag,
      modifiedTime: meta.modifiedTime,
      questionCount
    });

    const transcript = await this.drive.exportDocumentText(fileId);
    const quizPayload = await this.gemini.generateQuiz({
      title,
      transcript,
      questionCount
    });

    const form = await this.forms.createQuizForm(quizPayload);

    await this.repo.setStatus(fileId, "succeeded", {
      folderId: this.config.googleDriveFolderId,
      title,
      driveEtag: meta.etag,
      modifiedTime: meta.modifiedTime,
      formId: form.formId,
      formUrl: form.formUrl,
      geminiSummary: quizPayload.summary,
      questionCount: quizPayload.questions.length
    });

    const record = await this.repo.get(fileId);
    if (!record) {
      throw new Error("Failed to read record after processing");
    }
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
