import { google, forms_v1 } from "googleapis";
import { QuizPayload } from "../types";

export interface CreateFormResult {
  formId: string;
  formUrl: string;
}

export class FormsClient {
  private forms: forms_v1.Forms;

  constructor() {
    const auth = new google.auth.GoogleAuth({
      scopes: ["https://www.googleapis.com/auth/forms.body", "https://www.googleapis.com/auth/forms.responses.readonly"]
    });
    this.forms = google.forms({ version: "v1", auth });
  }

  async createQuizForm(quiz: QuizPayload): Promise<CreateFormResult> {
    const createRes = await this.forms.forms.create({
      requestBody: {
        info: {
          title: quiz.title,
          documentTitle: quiz.title,
          description: quiz.summary
        }
      }
    });

    const formId = createRes.data.formId;
    if (!formId) {
      throw new Error("Failed to create Google Form");
    }

    const requests: forms_v1.Schema$Request[] = [
      {
        updateSettings: {
          settings: { quizSettings: { isQuiz: true } },
          updateMask: "quizSettings.isQuiz"
        }
      },
      ...quiz.questions.map((q, index): forms_v1.Schema$Request => ({
        createItem: {
          item: {
            title: q.question,
            questionItem: {
              question: {
                required: true,
                choiceQuestion: {
                  type: "RADIO",
                  options: q.options.map((option) => ({ value: option })),
                  shuffle: false
                }
              }
            }
          },
          location: { index }
        }
      }))
    ];

    if (requests.length > 0) {
      await this.forms.forms.batchUpdate({
        formId,
        requestBody: { requests }
      });
    }

    const formData = createRes.data as forms_v1.Schema$Form & { formUri?: string };
    const formUrl = formData.responderUri ?? formData.formUri ?? "";

    return {
      formId,
      formUrl
    };
  }
}
