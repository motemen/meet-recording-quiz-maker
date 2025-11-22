import { type forms_v1, google } from "googleapis";
import { logger } from "../logger";
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
        "https://www.googleapis.com/auth/forms.body",
        "https://www.googleapis.com/auth/forms.responses.readonly",
      ],
    });
    this.forms = google.forms({ version: "v1", auth });
    this.driveClient = options.driveClient ?? null;
    this.outputFolderId = options.outputFolderId;
  }

  async createQuizForm(quiz: QuizPayload): Promise<CreateFormResult> {
    const createRes = await this.forms.forms.create({
      requestBody: {
        info: {
          title: quiz.title,
        },
      },
    });

    const formId = createRes.data.formId;
    if (!formId) {
      throw new Error("Failed to create Google Form");
    }

    const requests: forms_v1.Schema$Request[] = [
      {
        updateFormInfo: {
          info: { documentTitle: quiz.title },
          updateMask: "documentTitle",
        },
      },
      ...(quiz.summary
        ? [
            {
              updateFormInfo: {
                info: { description: quiz.summary },
                updateMask: "description",
              },
            } satisfies forms_v1.Schema$Request,
          ]
        : []),
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

    const filteredRequests = requests.filter(Boolean) as forms_v1.Schema$Request[];

    if (filteredRequests.length > 0) {
      await this.forms.forms.batchUpdate({
        formId,
        requestBody: { requests: filteredRequests },
      });
    }

    const formData = createRes.data as forms_v1.Schema$Form & { formUri?: string };
    const formUrl = formData.responderUri ?? formData.formUri ?? "";

    // Move form to output folder if configured
    if (this.outputFolderId && this.driveClient) {
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

    return {
      formId,
      formUrl,
    };
  }
}
