import type { OAuth2Client } from "google-auth-library";
import { type docs_v1, type drive_v3, google } from "googleapis";
import { logger } from "../logger.js";
import { createImpersonatedAuthClient } from "../utils/googleAuth.js";

interface DriveClientOptions {
  serviceAccountEmail: string;
}

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
  private authPromise: Promise<OAuth2Client>;
  private drivePromise: Promise<drive_v3.Drive>;
  private docsPromise: Promise<docs_v1.Docs>;

  constructor(options: DriveClientOptions) {
    this.authPromise = this.createAuthClient(options.serviceAccountEmail);
    this.drivePromise = this.authPromise.then((auth) => google.drive({ version: "v3", auth }));
    this.docsPromise = this.authPromise.then((auth) => google.docs({ version: "v1", auth }));
  }

  private createAuthClient(serviceAccountEmail: string): Promise<OAuth2Client> {
    const scopes = [
      "https://www.googleapis.com/auth/drive.readonly",
      "https://www.googleapis.com/auth/drive.file",
      "https://www.googleapis.com/auth/documents",
    ];
    return createImpersonatedAuthClient(serviceAccountEmail, scopes);
  }

  async logCaller(): Promise<void> {
    try {
      const client = await this.authPromise;
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
    const drive = await this.drivePromise;
    const res = await drive.files.list({
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
    logger.debug("drive_get_file_metadata_start", { fileId });
    try {
      const drive = await this.drivePromise;
      const res = await drive.files.get({
        fileId,
        fields: "id, name, mimeType, modifiedTime, properties",
        supportsAllDrives: true,
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
    } catch (error) {
      logger.error("drive_get_file_metadata_failed", { fileId, error });
      throw error;
    }
  }

  async createBlankDocument(title: string): Promise<CreateDocumentResult> {
    const docs = await this.docsPromise;
    const drive = await this.drivePromise;
    const res = await docs.documents.create({
      requestBody: { title },
    });

    const documentId = res.data.documentId;
    if (!documentId) {
      throw new Error("Failed to create Google Doc via Docs API");
    }

    const driveRes = await drive.files.get({
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
    const drive = await this.drivePromise;
    const res = await drive.files.create({
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
    const drive = await this.drivePromise;
    const res = await drive.about.get({
      fields: "storageQuota(limit,usage,usageInDrive,usageInDriveTrash)",
    });
    return res.data.storageQuota ?? {};
  }

  async exportDocumentText(fileId: string): Promise<string> {
    const drive = await this.drivePromise;
    const res = await drive.files.export(
      { fileId, mimeType: "text/plain" },
      { responseType: "arraybuffer" },
    );

    if (!res.data) return "";
    const buffer = Buffer.from(res.data as ArrayBuffer);
    return buffer.toString("utf-8");
  }

  async setFileProperties(fileId: string, properties: Record<string, string>): Promise<void> {
    const drive = await this.drivePromise;
    await drive.files.update({
      fileId,
      requestBody: { properties },
    });
  }

  async moveFileToFolder(fileId: string, folderId: string): Promise<void> {
    const drive = await this.drivePromise;
    // Get current parents
    const file = await drive.files.get({
      fileId,
      fields: "parents",
      supportsAllDrives: true,
    });

    const previousParents = file.data.parents?.join(",") || "";

    // Move to new folder by removing from old parents and adding to new parent
    await drive.files.update({
      fileId: fileId,
      addParents: folderId,
      removeParents: previousParents,
      supportsAllDrives: true,
    });
  }
}
