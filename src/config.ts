import { z } from "zod";

const configSchema = z.object({
  port: z.coerce.number().default(8080),
  googleDriveFolderId: z.string().optional(),
  googleDriveOutputFolderId: z.string().optional(),
  googleAllowedDomain: z.string().optional(),
  geminiModel: z.string().default("gemini-2.5-flash"),
  quizAdditionalPrompt: z.string().optional(),
  firestoreCollection: z.string().min(1, "FIRESTORE_COLLECTION is required"),
  gcloudProject: z.string().optional(),
  googleGenerativeAiApiKeySecret: z.string().optional(),
});

export type AppConfig = z.infer<typeof configSchema>;

export function loadConfig(env = process.env): AppConfig {
  const parsed = configSchema.safeParse({
    port: env.PORT,
    googleDriveFolderId: env.GOOGLE_DRIVE_FOLDER_ID,
    googleDriveOutputFolderId: env.GOOGLE_DRIVE_OUTPUT_FOLDER_ID,
    googleAllowedDomain: env.GOOGLE_ALLOWED_DOMAIN,
    geminiModel: env.GEMINI_MODEL,
    quizAdditionalPrompt: env.QUIZ_ADDITIONAL_PROMPT,
    firestoreCollection: env.FIRESTORE_COLLECTION,
    gcloudProject: env.GCLOUD_PROJECT,
    googleGenerativeAiApiKeySecret: env.GOOGLE_GENERATIVE_AI_API_KEY_SECRET,
  });

  if (!parsed.success) {
    throw new Error(
      `Invalid configuration: ${parsed.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join(", ")}`,
    );
  }

  return parsed.data;
}
