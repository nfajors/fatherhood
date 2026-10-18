import { z } from "zod";
import { QUIZ_POLICY } from "@/lib/learning/quizzes";

/** A question as the editor sends it. Content rules live in questionProblem(). */
export const questionFields = z.object({
  prompt: z.string().max(1_000),
  kind: z.enum(["single", "multiple"]),
  options: z.array(z.string().max(300)).max(QUIZ_POLICY.maxOptions),
  correct: z.array(z.number().int().min(0)).max(QUIZ_POLICY.maxOptions),
  explanation: z.string().max(2_000).nullable().optional(),
});
