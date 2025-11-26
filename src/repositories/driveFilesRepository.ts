import { Firestore } from "@google-cloud/firestore";
import type { DriveFile, ProcessingStatus } from "../types";

const COLLECTION_NAME = "driveFiles";

export class DriveFilesRepository {
  private firestore: Firestore;

  constructor(options: { firestore?: Firestore } = {}) {
    this.firestore = options.firestore ?? new Firestore();
  }

  private collection() {
    return this.firestore.collection(COLLECTION_NAME);
  }

  async get(fileId: string): Promise<DriveFile | undefined> {
    const doc = await this.collection().doc(fileId).get();
    if (!doc.exists) return undefined;
    return doc.data() as DriveFile;
  }

  async listRecent(limit = 20): Promise<DriveFile[]> {
    const snapshot = await this.collection().orderBy("updatedAt", "desc").limit(limit).get();
    return snapshot.docs.map((doc) => doc.data() as DriveFile);
  }

  async setStatus(
    fileId: string,
    status: ProcessingStatus,
    payload: Partial<DriveFile> = {},
  ): Promise<void> {
    const now = new Date().toISOString();
    await this.collection()
      .doc(fileId)
      .set(
        {
          fileId,
          status,
          createdAt: payload.createdAt ?? now,
          updatedAt: now,
          ...payload,
        },
        { merge: true },
      );
  }
}
