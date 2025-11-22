import { type drive_v3, type forms_v1, google } from "googleapis";
import { logger } from "../logger";
import type { QuizPayload } from "../types";

export interface CreateFormResult {
  formId: string;
  formUrl: string;
}

export class FormsClient {
  private forms: forms_v1.Forms;
  private drive: drive_v3.Drive;
  private outputFolderId?: string;

  constructor() {
    const auth = new google.auth.GoogleAuth({
      scopes: [
        "https://www.googleapis.com/auth/forms.body",
        "https://www.googleapis.com/auth/forms.responses.readonly",
        "https://www.googleapis.com/auth/drive.file",
      ],
    });
    this.forms = google.forms({ version: "v1", auth });
    this.drive = google.drive({ version: "v3", auth });
    this.outputFolderId = process.env.GOOGLE_DRIVE_OUTPUT_FOLDER_ID;
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
    if (this.outputFolderId) {
      try {
        await this.moveFormToFolder(formId, this.outputFolderId);
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

  private async moveFormToFolder(formId: string, folderId: string): Promise<void> {
    // Get current parents
    const file = await this.drive.files.get({
      fileId: formId,
      fields: "parents",
      supportsAllDrives: true,
    });

    const previousParents = file.data.parents?.join(",") || "";

    // Move to new folder by removing from old parents and adding to new parent
    await this.drive.files.update({
      fileId: formId,
      addParents: folderId,
      removeParents: previousParents,
      supportsAllDrives: true,
    });
  }
}
