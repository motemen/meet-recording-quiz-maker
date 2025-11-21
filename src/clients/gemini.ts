import { generateObject } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { z } from "zod";
import { QuizPayload } from "../types";

const QuizSchema: z.ZodType<QuizPayload> = z.object({
  title: z.string(),
  summary: z.string(),
  questions: z.array(
    z.object({
      question: z.string(),
      options: z.array(z.string()).min(2),
      correctOptionIndex: z.number().int(),
      rationale: z.string().optional()
    })
  )
});

export interface GenerateQuizParams {
  title: string;
  transcript: string;
  questionCount: number;
}

export class GeminiClient {
  private modelName: string;
  private apiKey: string;
  private modelFactory: ReturnType<typeof createGoogleGenerativeAI>;

  constructor(options: { modelName: string; apiKey?: string }) {
    this.modelName = options.modelName;
    const apiKey = options.apiKey ?? process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is required for Gemini access");
    }
    this.apiKey = apiKey;
    this.modelFactory = createGoogleGenerativeAI({ apiKey: this.apiKey });
  }

  async generateQuiz(params: GenerateQuizParams): Promise<QuizPayload> {
    const { title, transcript, questionCount } = params;
    const model = this.modelFactory(this.modelName);
    const { object } = await generateObject<z.ZodType<QuizPayload>, "object", QuizPayload>({
      model,
      schema: QuizSchema,
      output: "object",
      prompt: this.buildPrompt(title, transcript, questionCount)
    });
    return {
      title: object.title || `Quiz for ${title}`,
      summary: object.summary || "",
      questions:
        object.questions?.map((q) => ({
          question: q.question,
          options: q.options,
          correctOptionIndex: q.correctOptionIndex,
          rationale: q.rationale ?? ""
        })) ?? []
    };
  }

  private buildPrompt(title: string, transcript: string, questionCount: number): string {
    return `
You are creating a quiz based on a meeting transcript titled "${title}".
Generate ${questionCount} multiple-choice questions that test understanding of the meeting.
Return JSON that matches the provided schema. Use exactly ${questionCount} questions and at least 4 plausible options per question. The correctOptionIndex must be 0-based.

Transcript:
${transcript}
    `.trim();
  }
}
