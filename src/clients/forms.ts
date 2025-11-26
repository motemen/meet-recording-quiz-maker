import type { OAuth2Client } from "google-auth-library";
import { type forms_v1, google } from "googleapis";
import { logger } from "../logger.js";
import type { QuizPayload } from "../types";
import { createImpersonatedAuthClient } from "../utils/googleAuth.js";
import type { DriveClient } from "./drive";

export interface CreateFormResult {
  formId: string;
  formUrl: string;
}

export interface FormsClientOptions {
  driveClient: DriveClient;
  outputFolderId: string;
  serviceAccountEmail: string;
}

export class FormsClient {
  private authPromise: Promise<OAuth2Client>;
  private formsPromise: Promise<forms_v1.Forms>;
  private driveClient: DriveClient;
  private outputFolderId: string;

  constructor(options: FormsClientOptions) {
    const scopes = [
      "https://www.googleapis.com/auth/cloud-platform",
      "https://www.googleapis.com/auth/drive",
    ];
    this.authPromise = createImpersonatedAuthClient(options.serviceAccountEmail, scopes);
    this.formsPromise = this.authPromise.then((auth) => google.forms({ version: "v1", auth }));
    this.driveClient = options.driveClient;
    this.outputFolderId = options.outputFolderId;
  }

  async createBlankForm(title: string): Promise<CreateFormResult> {
    const forms = await this.formsPromise;
    const createRes = await forms.forms.create({
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

    const { data: form } = await forms.forms.get({ formId });
    const formUrl = form.responderUri ?? "";

    await this.moveFormToOutputFolder(formId);

    return { formId, formUrl };
  }

  async createQuizForm(quiz: QuizPayload): Promise<CreateFormResult> {
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

    const forms = await this.formsPromise;

    await forms.forms.batchUpdate({
      formId,
      requestBody: { requests },
    });

    const { data: form } = await forms.forms.get({ formId });
    const formUrl = form.responderUri ?? "";

    return {
      formId,
      formUrl,
    };
  }

  private async clearFormItems(formId: string): Promise<void> {
    const forms = await this.formsPromise;
    const { data } = await forms.forms.get({ formId, fields: "items" });
    const items = data.items ?? [];
    if (items.length === 0) return;

    const deleteRequests = items
      .map(
        (_, index): forms_v1.Schema$Request => ({
          deleteItem: { location: { index } },
        }),
      )
      .reverse();

    await forms.forms.batchUpdate({
      formId,
      requestBody: { requests: deleteRequests },
    });
  }

  private async moveFormToOutputFolder(formId: string): Promise<void> {
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
