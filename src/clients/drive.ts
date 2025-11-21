import { type drive_v3, google } from "googleapis";
import { logger } from "../logger";

export interface DriveFileMetadata {
  id: string;
  name?: string;
  mimeType?: string;
  modifiedTime?: string;
  properties?: Record<string, string>;
}

export class DriveClient {
  private drive: drive_v3.Drive;

  constructor() {
    const auth = new google.auth.GoogleAuth({
      scopes: ["https://www.googleapis.com/auth/drive.readonly"],
    });
    void this.logCaller(auth);
    this.drive = google.drive({ version: "v3", auth });
  }

  private async logCaller(auth: InstanceType<typeof google.auth.GoogleAuth>): Promise<void> {
    try {
      const client = await auth.getClient();
      const token = await client.getAccessToken();
      const tokenValue = typeof token === "string" ? token : (token?.token ?? undefined);
      if (!tokenValue) {
        logger.warn("drive_auth_no_token");
        return;
      }
      const res = await fetch(
        `https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(tokenValue)}`,
      );
      if (!res.ok) {
        logger.warn("drive_auth_tokeninfo_failed", { status: res.status });
        return;
      }
      const info = (await res.json()) as { email?: string; scope?: string };
      logger.info("drive_auth_caller", { email: info.email, scopes: info.scope });
    } catch (error) {
      logger.warn("drive_auth_inspect_failed", { error });
    }
  }

  async listFolderFiles(folderId: string, pageSize = 50): Promise<DriveFileMetadata[]> {
    const res = await this.drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      fields: "files(id, name, mimeType, modifiedTime, properties)",
      orderBy: "modifiedTime desc",
      pageSize,
    });

    return (
      res.data.files
        ?.filter((file) => file.id)
        .map((file) => ({
          id: file.id as string,
          name: file.name ?? undefined,
          mimeType: file.mimeType ?? undefined,
          modifiedTime: file.modifiedTime ?? undefined,
          properties: file.properties ?? undefined,
        })) ?? []
    );
  }

  async getFileMetadata(fileId: string): Promise<DriveFileMetadata> {
    const res = await this.drive.files.get({
      fileId,
      fields: "id, name, mimeType, modifiedTime, properties",
    });

    if (!res.data.id) {
      throw new Error("Drive file not found");
    }

    return {
      id: res.data.id,
      name: res.data.name ?? undefined,
      mimeType: res.data.mimeType ?? undefined,
      modifiedTime: res.data.modifiedTime ?? undefined,
      properties: res.data.properties ?? undefined,
    };
  }

  async exportDocumentText(fileId: string): Promise<string> {
    const res = await this.drive.files.export(
      { fileId, mimeType: "text/plain" },
      { responseType: "arraybuffer" },
    );

    if (!res.data) return "";
    const buffer = Buffer.from(res.data as ArrayBuffer);
    return buffer.toString("utf-8");
  }

  async setFileProperties(fileId: string, properties: Record<string, string>): Promise<void> {
    await this.drive.files.update({
      fileId,
      requestBody: { properties },
    });
  }
}
