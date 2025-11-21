import { Firestore } from "@google-cloud/firestore";
import type { MeetingFile, ProcessingStatus } from "../types";

export class MeetingFilesRepository {
  private collectionName: string;
  private firestore: Firestore;

  constructor(options: { firestore?: Firestore; collectionName: string }) {
    this.collectionName = options.collectionName;
    this.firestore = options.firestore ?? new Firestore();
  }

  private collection() {
    return this.firestore.collection(this.collectionName);
  }

  async get(fileId: string): Promise<MeetingFile | undefined> {
    const doc = await this.collection().doc(fileId).get();
    if (!doc.exists) return undefined;
    return doc.data() as MeetingFile;
  }

  async listRecent(limit = 20): Promise<MeetingFile[]> {
    const snapshot = await this.collection().orderBy("updatedAt", "desc").limit(limit).get();
    return snapshot.docs.map((doc) => doc.data() as MeetingFile);
  }

  async setStatus(
    fileId: string,
    status: ProcessingStatus,
    payload: Partial<MeetingFile> = {},
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
