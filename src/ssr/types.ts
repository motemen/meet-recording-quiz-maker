import type { DriveFile } from "../types.js";

export type AppState = {
  serviceAccountEmail: string;
  initialRecord?: DriveFile;
};

export type RenderResult = {
  html: string;
  state: AppState;
  head?: string;
};
