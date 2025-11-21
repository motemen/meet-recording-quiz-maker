import { z } from "zod";

const configSchema = z.object({
  port: z.coerce.number().default(8080),
  googleDriveFolderId: z.string().min(1, "GOOGLE_DRIVE_FOLDER_ID is required"),
  googleAllowedDomain: z.string().optional(),
  geminiModel: z.string().default("gemini-2.5-flash"),
  quizAdditionalPrompt: z.string().optional(),
  firestoreCollection: z.string().min(1, "FIRESTORE_COLLECTION is required"),
  gcloudProject: z.string().optional()
});

export type AppConfig = z.infer<typeof configSchema>;

export function loadConfig(env = process.env): AppConfig {
  const parsed = configSchema.safeParse({
    port: env.PORT,
    googleDriveFolderId: env.GOOGLE_DRIVE_FOLDER_ID,
    googleAllowedDomain: env.GOOGLE_ALLOWED_DOMAIN,
    geminiModel: env.GEMINI_MODEL,
    quizAdditionalPrompt: env.QUIZ_ADDITIONAL_PROMPT,
    firestoreCollection: env.FIRESTORE_COLLECTION,
    gcloudProject: env.GCLOUD_PROJECT
  });

  if (!parsed.success) {
    throw new Error(
      `Invalid configuration: ${parsed.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join(", ")}`
    );
  }

  return parsed.data;
}
