import { GoogleGenerativeAI } from "@google/generative-ai";
import { QuizPayload } from "../types";

export interface GenerateQuizParams {
  title: string;
  transcript: string;
  questionCount: number;
}

export class GeminiClient {
  private modelName: string;
  private client: GoogleGenerativeAI;

  constructor(options: { modelName: string; apiKey?: string }) {
    this.modelName = options.modelName;
    const apiKey = options.apiKey ?? process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is required for Gemini access");
    }

    this.client = new GoogleGenerativeAI(apiKey);
  }

  async generateQuiz(params: GenerateQuizParams): Promise<QuizPayload> {
    const { title, transcript, questionCount } = params;
    const model = this.client.getGenerativeModel({ model: this.modelName });
    const prompt = this.buildPrompt(title, transcript, questionCount);
    const result = await model.generateContent(prompt);
    const text = result.response.text();

    const parsed = this.parseQuizJson(text);
    return {
      title: parsed.title ?? `Quiz for ${title}`,
      summary: parsed.summary ?? "",
      questions: parsed.questions ?? []
    };
  }

  private buildPrompt(title: string, transcript: string, questionCount: number): string {
    return `
You are creating a quiz based on a meeting transcript titled "${title}".
Generate ${questionCount} multiple-choice questions that test understanding of the meeting.
Return JSON only in the following shape:
{
  "title": string,
  "summary": string,
  "questions": [
    {
      "question": string,
      "options": [string, string, string, string],
      "correctOptionIndex": number (0-based),
      "rationale": string
    }
  ]
}

Transcript:
${transcript}
    `.trim();
  }

  private parseQuizJson(text: string): Partial<QuizPayload> {
    try {
      const jsonStart = text.indexOf("{");
      const jsonText = jsonStart >= 0 ? text.slice(jsonStart) : text;
      return JSON.parse(jsonText);
    } catch (error) {
      throw new Error(`Failed to parse Gemini response as JSON: ${String(error)}; response=${text}`);
    }
  }
}
