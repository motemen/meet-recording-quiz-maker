import { google } from "googleapis";
import { logger } from "../logger.js";
import type { CreateFormResult } from "./forms.js";

export class FormsRestClient {
  private auth: InstanceType<typeof google.auth.GoogleAuth>;

  constructor() {
    this.auth = new google.auth.GoogleAuth({
      scopes: ["https://www.googleapis.com/auth/drive.file"],
    });
  }

  async createBlankForm(title: string): Promise<CreateFormResult> {
    const client = await this.auth.getClient();
    const token = await client.getAccessToken();
    const accessToken = token?.token;
    if (!accessToken) {
      throw new Error("Failed to acquire access token for Forms API");
    }

    const response = await fetch("https://forms.googleapis.com/v1/forms", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        info: {
          title,
          documentTitle: title,
        },
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      logger.error("forms_rest_create_failed", {
        status: response.status,
        body: errorBody,
      });
      throw new Error(`Forms REST create failed with status ${response.status}`);
    }

    const data = (await response.json()) as { formId?: string; responderUri?: string };
    if (!data.formId) {
      throw new Error("Forms REST create response missing formId");
    }

    return { formId: data.formId, formUrl: data.responderUri ?? "" };
  }
}
