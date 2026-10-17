import { z } from "zod";

/** Lesson fields accepted by the admin API. */
export const lessonFields = z.object({
  title: z.string().trim().min(1).max(140),
  summary: z
    .string()
    .trim()
    .max(1000)
    .transform((v) => v || null)
    .nullable()
    .optional(),
  videoId: z.uuid().nullable().optional(),
  isPreview: z.boolean().optional(),
});
