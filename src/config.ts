import { z } from "zod";

const configSchema = z.object({
  port: z.coerce.number().default(8080),
  googleDriveOutputFolderId: z.string().min(1, "GOOGLE_DRIVE_OUTPUT_FOLDER_ID is required"),
  geminiModel: z.string().default("gemini-2.5-flash"),
  quizAdditionalPrompt: z.string().optional(),
  quizQuestionCount: z.coerce.number().optional(),
  googleGenerativeAiApiKeySecret: z.string().optional(),
  serviceAccountEmail: z.string().min(1, "SERVICE_ACCOUNT_EMAIL is required"),
});

export type AppConfig = z.infer<typeof configSchema>;

export function loadConfig(env = process.env): AppConfig {
  const parsed = configSchema.safeParse({
    port: env.PORT,
    googleDriveOutputFolderId: env.GOOGLE_DRIVE_OUTPUT_FOLDER_ID,
    geminiModel: env.GEMINI_MODEL,
    quizAdditionalPrompt: env.QUIZ_ADDITIONAL_PROMPT,
    quizQuestionCount: env.QUIZ_QUESTION_COUNT,
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

  return parsed.data;
}
