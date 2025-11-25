import { type forms_v1, google } from "googleapis";
import { logger } from "../logger.js";
import type { QuizPayload } from "../types";
import type { DriveClient } from "./drive";

export interface CreateFormResult {
  formId: string;
  formUrl: string;
}

export interface FormsClientOptions {
  driveClient?: DriveClient;
  outputFolderId?: string;
}

export class FormsClient {
  private forms: forms_v1.Forms;
  private driveClient: DriveClient | null;
  private outputFolderId?: string;

  constructor(options: FormsClientOptions = {}) {
    const auth = new google.auth.GoogleAuth({
      scopes: [
        "https://www.googleapis.com/auth/cloud-platform",
        "https://www.googleapis.com/auth/drive",
      ],
    });
    this.forms = google.forms({ version: "v1", auth });
    this.driveClient = options.driveClient ?? null;
    this.outputFolderId = options.outputFolderId;

    // Validate that driveClient is provided when outputFolderId is specified
    if (this.outputFolderId && !this.driveClient) {
      throw new Error(
        "driveClient is required when outputFolderId is specified. Cannot move forms without DriveClient.",
      );
    }
  }

  async createBlankForm(title: string): Promise<CreateFormResult> {
    const createRes = await this.forms.forms.create({
      requestBody: {
        info: {
          title,
          documentTitle: title,
        },
      },
    });

    const formId = createRes.data.formId;
    if (!formId) {
      throw new Error("Failed to create Google Form");
    }

    const { data: form } = await this.forms.forms.get({ formId });
    const formUrl = form.responderUri ?? "";

    await this.moveFormToOutputFolder(formId);

    return { formId, formUrl };
  }

  async createQuizForm(quiz: QuizPayload): Promise<CreateFormResult> {
    if (!this.outputFolderId || !this.driveClient) {
      throw new Error(
        "outputFolderId and driveClient are required when creating quiz forms in Drive",
      );
    }

    // Service accounts cannot create the form in their own drive space, so create
    // the shell file directly in the shared output folder via Drive first.
    const formShell = await this.driveClient.createFileInFolder(
      quiz.title,
      this.outputFolderId,
      "application/vnd.google-apps.form",
    );

    const formId = formShell.fileId;
    if (!formId) {
      throw new Error("Failed to create Google Form");
    }

    await this.clearFormItems(formId);

    const updateFormInfoMask: string[] = ["title"];
    if (quiz.summary) {
      updateFormInfoMask.push("description");
    }

    const requests: forms_v1.Schema$Request[] = [
      {
        updateFormInfo: {
          info: {
            title: quiz.title,
            description: quiz.summary ?? undefined,
          },
          updateMask: updateFormInfoMask.join(","),
        },
      },
      {
        updateSettings: {
          settings: { quizSettings: { isQuiz: true } },
          updateMask: "quizSettings.isQuiz",
        },
      },
      ...quiz.questions.map((q, index): forms_v1.Schema$Request => {
        const correctValue = q.options[q.correctOptionIndex] ?? q.options[0] ?? "";
        return {
          createItem: {
            item: {
              title: q.question,
              questionItem: {
                question: {
                  required: true,
                  choiceQuestion: {
                    type: "RADIO",
                    options: q.options.map((option) => ({ value: option })),
                    shuffle: false,
                  },
                  grading: {
                    pointValue: 1,
                    correctAnswers: { answers: [{ value: correctValue }] },
                    whenRight: q.rationale ? { text: q.rationale } : undefined,
                    whenWrong: q.rationale ? { text: q.rationale } : undefined,
                  },
                },
              },
            },
            location: { index },
          },
        };
      }),
    ];

    await this.forms.forms.batchUpdate({
      formId,
      requestBody: { requests },
    });

    const { data: form } = await this.forms.forms.get({ formId });
    const formUrl = form.responderUri ?? "";

    return {
      formId,
      formUrl,
    };
  }

  private async clearFormItems(formId: string): Promise<void> {
    const { data } = await this.forms.forms.get({ formId, fields: "items" });
    const items = data.items ?? [];
    if (items.length === 0) return;

    const deleteRequests = items
      .map(
        (_, index): forms_v1.Schema$Request => ({
          deleteItem: { location: { index } },
        }),
      )
      .reverse();

    await this.forms.forms.batchUpdate({
      formId,
      requestBody: { requests: deleteRequests },
    });
  }

  private async moveFormToOutputFolder(formId: string): Promise<void> {
    if (!this.outputFolderId || !this.driveClient) {
      return;
    }
    try {
      await this.driveClient.moveFileToFolder(formId, this.outputFolderId);
      logger.info("form_moved_to_output_folder", {
        formId,
        outputFolderId: this.outputFolderId,
      });
    } catch (error) {
      logger.error("failed_to_move_form", {
        formId,
        outputFolderId: this.outputFolderId,
        error,
      });
      // Don't fail the entire operation if moving fails
    }
  }
}
