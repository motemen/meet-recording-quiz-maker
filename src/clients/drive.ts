import { type docs_v1, type drive_v3, google } from "googleapis";
import { logger } from "../logger.js";

export interface DriveFileMetadata {
  id: string;
  name?: string;
  mimeType?: string;
  modifiedTime?: string;
  properties?: Record<string, string>;
}

export interface CreateDocumentResult {
  fileId: string;
  webViewLink?: string;
}

export interface DriveQuota {
  limit?: string;
  usage?: string;
  usageInDrive?: string;
  usageInDriveTrash?: string;
}

export class DriveClient {
  private drive: drive_v3.Drive;
  private docs: docs_v1.Docs;

  constructor() {
    const auth = new google.auth.GoogleAuth({
      scopes: [
        "https://www.googleapis.com/auth/drive.readonly",
        "https://www.googleapis.com/auth/drive.file",
        "https://www.googleapis.com/auth/documents",
      ],
    });
    void this.logCaller(auth);
    this.drive = google.drive({ version: "v3", auth });
    this.docs = google.docs({ version: "v1", auth });
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

  async createBlankDocument(title: string): Promise<CreateDocumentResult> {
    const res = await this.docs.documents.create({
      requestBody: { title },
    });

    const documentId = res.data.documentId;
    if (!documentId) {
      throw new Error("Failed to create Google Doc via Docs API");
    }

    const driveRes = await this.drive.files.get({
      fileId: documentId,
      fields: "id, webViewLink",
      supportsAllDrives: true,
    });

    return {
      fileId: documentId,
      webViewLink: driveRes.data.webViewLink ?? undefined,
    };
  }

  async createFileInFolder(
    title: string,
    folderId: string,
    mimeType = "application/vnd.google-apps.document",
  ): Promise<CreateDocumentResult> {
    const res = await this.drive.files.create({
      requestBody: {
        name: title,
        mimeType,
        parents: [folderId],
      },
      fields: "id, webViewLink",
      supportsAllDrives: true,
    });

    if (!res.data.id) {
      throw new Error("Failed to create file via Drive API");
    }

    return {
      fileId: res.data.id,
      webViewLink: res.data.webViewLink ?? undefined,
    };
  }

  async getQuota(): Promise<DriveQuota> {
    const res = await this.drive.about.get({
      fields: "storageQuota(limit,usage,usageInDrive,usageInDriveTrash)",
    });
    return res.data.storageQuota ?? {};
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

  async moveFileToFolder(fileId: string, folderId: string): Promise<void> {
    // Get current parents
    const file = await this.drive.files.get({
      fileId,
      fields: "parents",
      supportsAllDrives: true,
    });

    const previousParents = file.data.parents?.join(",") || "";

    // Move to new folder by removing from old parents and adding to new parent
    await this.drive.files.update({
      fileId: fileId,
      addParents: folderId,
      removeParents: previousParents,
      supportsAllDrives: true,
    });
  }
}
