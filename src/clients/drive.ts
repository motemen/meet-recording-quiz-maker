import { google, drive_v3 } from "googleapis";

export interface DriveFileMetadata {
  id: string;
  name?: string;
  mimeType?: string;
  modifiedTime?: string;
  etag?: string;
  properties?: Record<string, string>;
}

export class DriveClient {
  private drive: drive_v3.Drive;

  constructor() {
    const auth = new google.auth.GoogleAuth({
      scopes: ["https://www.googleapis.com/auth/drive.readonly"]
    });
    this.drive = google.drive({ version: "v3", auth });
  }

  async listFolderFiles(folderId: string, pageSize = 50): Promise<DriveFileMetadata[]> {
    const res = await this.drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      fields: "files(id, name, mimeType, modifiedTime, properties, etag)",
      orderBy: "modifiedTime desc",
      pageSize
    });

    return (
      res.data.files?.map((file) => ({
        id: file.id!,
        name: file.name ?? undefined,
        mimeType: file.mimeType ?? undefined,
        modifiedTime: file.modifiedTime ?? undefined,
        properties: file.properties ?? undefined,
        etag: file.etag ?? undefined
      })) ?? []
    );
  }

  async getFileMetadata(fileId: string): Promise<DriveFileMetadata> {
    const res = await this.drive.files.get({
      fileId,
      fields: "id, name, mimeType, modifiedTime, properties, etag"
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
      etag: res.data.etag ?? undefined
    };
  }

  async exportDocumentText(fileId: string): Promise<string> {
    const res = await this.drive.files.export(
      { fileId, mimeType: "text/plain" },
      { responseType: "arraybuffer" }
    );

    if (!res.data) return "";
    const buffer = Buffer.from(res.data as ArrayBuffer);
    return buffer.toString("utf-8");
  }

  async setFileProperties(fileId: string, properties: Record<string, string>): Promise<void> {
    await this.drive.files.update({
      fileId,
      requestBody: { properties }
    });
  }
}
