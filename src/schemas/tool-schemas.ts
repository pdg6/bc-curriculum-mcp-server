/**
 * Zod schemas for all MCP tool inputs.
 *
 * Grade 0 = Kindergarten (represented as "K" in user-facing text).
 */

import { z } from "zod";
import { SUBJECT_SLUGS, CONTENT_TYPES, GRADE_MIN, GRADE_MAX } from "../constants.js";

// ─── Shared Enums ────────────────────────────────────────────────

const SubjectEnum = z
  .enum(SUBJECT_SLUGS)
  .describe("BC curriculum subject slug (e.g., 'adst', 'science')");

const GradeSchema = z
  .number()
  .int()
  .min(GRADE_MIN)
  .max(GRADE_MAX)
  .describe(`Grade level (${GRADE_MIN}=Kindergarten, 1-${GRADE_MAX})`);

const ContentTypeEnum = z
  .enum([...CONTENT_TYPES, "all"] as [string, ...string[]])
  .describe("Type of curriculum content to filter by");

// ─── Tool Input Schemas ──────────────────────────────────────────

export const SearchCurriculumSchema = z
  .object({
    query: z
      .string()
      .min(2, "Query must be at least 2 characters")
      .max(500, "Query must not exceed 500 characters")
      .describe(
        "Natural language search query (e.g., 'empathetic design thinking')"
      ),
    subject: SubjectEnum.optional(),
    grade: GradeSchema.optional(),
    content_type: ContentTypeEnum.default("all").optional(),
    limit: z
      .number()
      .int()
      .min(1)
      .max(50)
      .default(10)
      .describe("Maximum results to return (default 10)"),
  })
  .strict();

export type SearchCurriculumInput = z.infer<typeof SearchCurriculumSchema>;

export const GetCourseCurriculumSchema = z
  .object({
    subject: SubjectEnum,
    grade: GradeSchema,
    course: z
      .string()
      .optional()
      .describe(
        "Course slug (e.g., 'technology-explorations'). If omitted, returns all courses for subject+grade."
      ),
  })
  .strict();

export type GetCourseCurriculumInput = z.infer<
  typeof GetCourseCurriculumSchema
>;

export const GetGradeProgressionSchema = z
  .object({
    subject: SubjectEnum,
    grade_from: GradeSchema.describe("Starting grade (0=K)"),
    grade_to: GradeSchema.describe("Ending grade"),
    focus: z
      .enum(["big_ideas", "competencies", "content", "all"])
      .default("all")
      .optional()
      .describe("Which curriculum element to trace across grades"),
    query: z
      .string()
      .min(2)
      .max(500)
      .optional()
      .describe("Optional: focus the progression on a specific concept (e.g., 'evidence', 'multiplication'). When provided, only items matching this query are shown at each grade."),
  })
  .strict();

export type GetGradeProgressionInput = z.infer<
  typeof GetGradeProgressionSchema
>;

export const GetCompetencyConnectionsSchema = z
  .object({
    competency_text: z
      .string()
      .min(3)
      .describe("A competency description to find connections for"),
    scope: z
      .enum(["same_subject", "cross_subject", "all"])
      .default("all")
      .optional()
      .describe("Where to search for related competencies"),
  })
  .strict();

export type GetCompetencyConnectionsInput = z.infer<
  typeof GetCompetencyConnectionsSchema
>;

export const GetCoreCompetenciesSchema = z
  .object({
    domain: z
      .enum(["communication", "thinking", "personal_social", "all"])
      .default("all")
      .optional()
      .describe("Core competency domain to retrieve"),
  })
  .strict();

export type GetCoreCompetenciesInput = z.infer<
  typeof GetCoreCompetenciesSchema
>;

export const GetAssessmentResourcesSchema = z
  .object({
    subject: SubjectEnum.optional(),
    grade: GradeSchema.optional(),
    resource_type: z
      .enum(["classroom-assessment", "reporting", "standards-based", "all"])
      .default("all")
      .optional()
      .describe("Type of assessment resource"),
  })
  .strict();

export type GetAssessmentResourcesInput = z.infer<
  typeof GetAssessmentResourcesSchema
>;

export const GetFpplSchema = z
  .object({
    subject: SubjectEnum.optional().describe(
      "Optional: filter connections to a specific subject"
    ),
  })
  .strict();

export type GetFpplInput = z.infer<typeof GetFpplSchema>;

export const ListCoursesSchema = z
  .object({
    subject: SubjectEnum.optional(),
    grade: GradeSchema.optional(),
  })
  .strict();

export type ListCoursesInput = z.infer<typeof ListCoursesSchema>;

export const GetCrawlStatusSchema = z
  .object({
    subject: SubjectEnum.optional().describe(
      "Optional: check specific subject"
    ),
  })
  .strict();

export type GetCrawlStatusInput = z.infer<typeof GetCrawlStatusSchema>;

// ─── New Tool Schemas ─────────────────────────────────────────────

export const SearchCrossCurricularSchema = z
  .object({
    subjects: z
      .array(SubjectEnum)
      .min(2, "Provide at least two subjects to compare")
      .max(9)
      .describe("Two or more subject slugs to compare (e.g., ['science', 'adst'])"),
    grade: GradeSchema,
    focus: z
      .enum(["big_ideas", "competencies", "content", "all"])
      .default("all")
      .optional()
      .describe("Which curriculum element to compare across subjects"),
    query: z
      .string()
      .min(2)
      .max(500)
      .optional()
      .describe("Optional: narrow to a specific concept (e.g., 'evidence', 'design thinking')"),
    limit: z
      .number()
      .int()
      .min(1)
      .max(50)
      .default(20)
      .describe("Maximum connections to return (default 20)"),
  })
  .strict();

export type SearchCrossCurricularInput = z.infer<typeof SearchCrossCurricularSchema>;

export const GetCurriculumChangesSchema = z
  .object({
    since: z
      .string()
      .optional()
      .describe("ISO date string — show changes detected after this date (e.g., '2026-01-15'). Defaults to last 30 days."),
    subject: SubjectEnum.optional(),
    grade: GradeSchema.optional(),
    change_type: z
      .enum(["added", "removed", "modified", "all"])
      .default("all")
      .optional()
      .describe("Filter by type of change"),
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .default(50)
      .describe("Maximum changelog entries to return (default 50)"),
  })
  .strict();

export type GetCurriculumChangesInput = z.infer<typeof GetCurriculumChangesSchema>;

export const GetCourseHistorySchema = z
  .object({
    subject: SubjectEnum,
    grade: GradeSchema,
    course: z
      .string()
      .optional()
      .describe("Course slug (e.g., 'chemistry'). If omitted, shows history for all courses at subject+grade."),
  })
  .strict();

export type GetCourseHistoryInput = z.infer<typeof GetCourseHistorySchema>;
