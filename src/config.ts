import { z } from "zod";

const configSchema = z.object({
  port: z.coerce.number().default(8080),
  googleDriveFolderId: z.string().optional(),
  googleDriveOutputFolderId: z.string().min(1, "GOOGLE_DRIVE_OUTPUT_FOLDER_ID is required"),
  googleAllowedDomain: z.string().optional(),
  geminiModel: z.string().default("gemini-2.5-flash"),
  quizAdditionalPrompt: z.string().optional(),
  gcloudProject: z.string().optional(),
  googleGenerativeAiApiKeySecret: z.string().optional(),
  serviceAccountEmail: z.string().min(1, "SERVICE_ACCOUNT_EMAIL is required"),
});

export type AppConfig = z.infer<typeof configSchema> & {
  firestoreCollection: typeof FIRESTORE_COLLECTION;
};

export const FIRESTORE_COLLECTION = "driveFiles";

export function loadConfig(env = process.env): AppConfig {
  const parsed = configSchema.safeParse({
    port: env.PORT,
    googleDriveFolderId: env.GOOGLE_DRIVE_FOLDER_ID,
    googleDriveOutputFolderId: env.GOOGLE_DRIVE_OUTPUT_FOLDER_ID,
    googleAllowedDomain: env.GOOGLE_ALLOWED_DOMAIN,
    geminiModel: env.GEMINI_MODEL,
    quizAdditionalPrompt: env.QUIZ_ADDITIONAL_PROMPT,
    gcloudProject: env.GCLOUD_PROJECT,
    googleGenerativeAiApiKeySecret: env.GOOGLE_GENERATIVE_AI_API_KEY_SECRET,
    serviceAccountEmail: env.SERVICE_ACCOUNT_EMAIL,
  });

  if (!parsed.success) {
    throw new Error(
      `Invalid configuration: ${parsed.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join(", ")}`,
    );
  }

  return { ...parsed.data, firestoreCollection: FIRESTORE_COLLECTION };
}
