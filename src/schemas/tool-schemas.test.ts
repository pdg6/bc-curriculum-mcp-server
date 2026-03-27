/**
 * Validation tests for all 12 tool input schemas.
 *
 * Tests both valid inputs (should parse) and invalid inputs (should reject).
 */

import { describe, it, expect } from "vitest";
import {
  SearchCurriculumSchema,
  GetCourseCurriculumSchema,
  GetGradeProgressionSchema,
  GetCompetencyConnectionsSchema,
  GetCoreCompetenciesSchema,
  GetAssessmentResourcesSchema,
  GetFpplSchema,
  ListCoursesSchema,
  GetCrawlStatusSchema,
  SearchCrossCurricularSchema,
  GetCurriculumChangesSchema,
  GetCourseHistorySchema,
} from "./tool-schemas.js";

// ─── SearchCurriculumSchema ──────────────────────────────────────

describe("SearchCurriculumSchema", () => {
  it("accepts a valid search query", () => {
    const result = SearchCurriculumSchema.safeParse({ query: "design thinking" });
    expect(result.success).toBe(true);
  });

  it("accepts full params with filters", () => {
    const result = SearchCurriculumSchema.safeParse({
      query: "coding",
      subject: "adst",
      grade: 8,
      content_type: "competency",
      limit: 20,
    });
    expect(result.success).toBe(true);
  });

  it("rejects query shorter than 2 chars", () => {
    const result = SearchCurriculumSchema.safeParse({ query: "x" });
    expect(result.success).toBe(false);
  });

  it("rejects invalid subject slug", () => {
    const result = SearchCurriculumSchema.safeParse({ query: "test", subject: "history" });
    expect(result.success).toBe(false);
  });

  it("rejects grade out of range", () => {
    const result = SearchCurriculumSchema.safeParse({ query: "test", grade: 13 });
    expect(result.success).toBe(false);
    const result2 = SearchCurriculumSchema.safeParse({ query: "test", grade: -1 });
    expect(result2.success).toBe(false);
  });

  it("rejects limit above 50", () => {
    const result = SearchCurriculumSchema.safeParse({ query: "test", limit: 100 });
    expect(result.success).toBe(false);
  });

  it("rejects unknown properties (strict mode)", () => {
    const result = SearchCurriculumSchema.safeParse({ query: "test", foo: "bar" });
    expect(result.success).toBe(false);
  });
});

// ─── GetCourseCurriculumSchema ───────────────────────────────────

describe("GetCourseCurriculumSchema", () => {
  it("accepts subject + grade", () => {
    const result = GetCourseCurriculumSchema.safeParse({ subject: "science", grade: 5 });
    expect(result.success).toBe(true);
  });

  it("accepts subject + grade + course slug", () => {
    const result = GetCourseCurriculumSchema.safeParse({
      subject: "adst",
      grade: 10,
      course: "computer-studies",
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing required fields", () => {
    expect(GetCourseCurriculumSchema.safeParse({ subject: "science" }).success).toBe(false);
    expect(GetCourseCurriculumSchema.safeParse({ grade: 5 }).success).toBe(false);
  });

  it("accepts grade 0 (Kindergarten)", () => {
    const result = GetCourseCurriculumSchema.safeParse({ subject: "mathematics", grade: 0 });
    expect(result.success).toBe(true);
  });
});

// ─── GetGradeProgressionSchema ───────────────────────────────────

describe("GetGradeProgressionSchema", () => {
  it("accepts valid range", () => {
    const result = GetGradeProgressionSchema.safeParse({
      subject: "science",
      grade_from: 3,
      grade_to: 7,
    });
    expect(result.success).toBe(true);
  });

  it("accepts optional focus and query", () => {
    const result = GetGradeProgressionSchema.safeParse({
      subject: "mathematics",
      grade_from: 0,
      grade_to: 12,
      focus: "big_ideas",
      query: "multiplication",
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid focus value", () => {
    const result = GetGradeProgressionSchema.safeParse({
      subject: "science",
      grade_from: 1,
      grade_to: 5,
      focus: "invalid",
    });
    expect(result.success).toBe(false);
  });
});

// ─── GetCompetencyConnectionsSchema ──────────────────────────────

describe("GetCompetencyConnectionsSchema", () => {
  it("accepts competency text", () => {
    const result = GetCompetencyConnectionsSchema.safeParse({
      competency_text: "Use reasoning to explore and make connections",
    });
    expect(result.success).toBe(true);
  });

  it("accepts optional scope", () => {
    const result = GetCompetencyConnectionsSchema.safeParse({
      competency_text: "critical thinking and analysis",
      scope: "cross_subject",
    });
    expect(result.success).toBe(true);
  });

  it("rejects text shorter than 3 chars", () => {
    const result = GetCompetencyConnectionsSchema.safeParse({ competency_text: "ab" });
    expect(result.success).toBe(false);
  });
});

// ─── GetCoreCompetenciesSchema ───────────────────────────────────

describe("GetCoreCompetenciesSchema", () => {
  it("accepts empty input (all domains)", () => {
    const result = GetCoreCompetenciesSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("accepts specific domain", () => {
    expect(GetCoreCompetenciesSchema.safeParse({ domain: "communication" }).success).toBe(true);
    expect(GetCoreCompetenciesSchema.safeParse({ domain: "thinking" }).success).toBe(true);
    expect(GetCoreCompetenciesSchema.safeParse({ domain: "personal_social" }).success).toBe(true);
  });

  it("rejects invalid domain", () => {
    const result = GetCoreCompetenciesSchema.safeParse({ domain: "math" });
    expect(result.success).toBe(false);
  });
});

// ─── GetAssessmentResourcesSchema ────────────────────────────────

describe("GetAssessmentResourcesSchema", () => {
  it("accepts empty input", () => {
    expect(GetAssessmentResourcesSchema.safeParse({}).success).toBe(true);
  });

  it("accepts all filter combinations", () => {
    expect(GetAssessmentResourcesSchema.safeParse({
      subject: "science",
      grade: 3,
      resource_type: "classroom-assessment",
    }).success).toBe(true);
  });

  it("rejects invalid resource_type", () => {
    expect(GetAssessmentResourcesSchema.safeParse({ resource_type: "quiz" }).success).toBe(false);
  });
});

// ─── GetFpplSchema ───────────────────────────────────────────────

describe("GetFpplSchema", () => {
  it("accepts empty input", () => {
    expect(GetFpplSchema.safeParse({}).success).toBe(true);
  });

  it("accepts optional subject filter", () => {
    expect(GetFpplSchema.safeParse({ subject: "science" }).success).toBe(true);
  });
});

// ─── ListCoursesSchema ───────────────────────────────────────────

describe("ListCoursesSchema", () => {
  it("accepts empty input (all courses)", () => {
    expect(ListCoursesSchema.safeParse({}).success).toBe(true);
  });

  it("accepts subject and/or grade", () => {
    expect(ListCoursesSchema.safeParse({ subject: "mathematics" }).success).toBe(true);
    expect(ListCoursesSchema.safeParse({ grade: 0 }).success).toBe(true);
    expect(ListCoursesSchema.safeParse({ subject: "adst", grade: 10 }).success).toBe(true);
  });
});

// ─── GetCrawlStatusSchema ────────────────────────────────────────

describe("GetCrawlStatusSchema", () => {
  it("accepts empty input", () => {
    expect(GetCrawlStatusSchema.safeParse({}).success).toBe(true);
  });

  it("accepts optional subject", () => {
    expect(GetCrawlStatusSchema.safeParse({ subject: "adst" }).success).toBe(true);
  });
});

// ─── SearchCrossCurricularSchema ─────────────────────────────────

describe("SearchCrossCurricularSchema", () => {
  it("accepts two subjects and a grade", () => {
    const result = SearchCrossCurricularSchema.safeParse({
      subjects: ["science", "mathematics"],
      grade: 5,
    });
    expect(result.success).toBe(true);
  });

  it("accepts all optional params", () => {
    const result = SearchCrossCurricularSchema.safeParse({
      subjects: ["science", "adst", "mathematics"],
      grade: 8,
      focus: "competencies",
      query: "design thinking",
      limit: 10,
    });
    expect(result.success).toBe(true);
  });

  it("rejects fewer than 2 subjects", () => {
    const result = SearchCrossCurricularSchema.safeParse({
      subjects: ["science"],
      grade: 5,
    });
    expect(result.success).toBe(false);
  });

  it("rejects limit above 50", () => {
    const result = SearchCrossCurricularSchema.safeParse({
      subjects: ["science", "mathematics"],
      grade: 5,
      limit: 100,
    });
    expect(result.success).toBe(false);
  });
});

// ─── GetCurriculumChangesSchema ──────────────────────────────────

describe("GetCurriculumChangesSchema", () => {
  it("accepts empty input (defaults to last 30 days)", () => {
    expect(GetCurriculumChangesSchema.safeParse({}).success).toBe(true);
  });

  it("accepts all filters", () => {
    const result = GetCurriculumChangesSchema.safeParse({
      since: "2026-01-01",
      subject: "science",
      grade: 5,
      change_type: "added",
      limit: 25,
    });
    expect(result.success).toBe(true);
  });

  it("rejects limit above 100", () => {
    const result = GetCurriculumChangesSchema.safeParse({ limit: 200 });
    expect(result.success).toBe(false);
  });
});

// ─── GetCourseHistorySchema ──────────────────────────────────────

describe("GetCourseHistorySchema", () => {
  it("accepts subject + grade", () => {
    const result = GetCourseHistorySchema.safeParse({ subject: "science", grade: 1 });
    expect(result.success).toBe(true);
  });

  it("accepts optional course slug", () => {
    const result = GetCourseHistorySchema.safeParse({
      subject: "adst",
      grade: 10,
      course: "computer-studies",
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing required fields", () => {
    expect(GetCourseHistorySchema.safeParse({ subject: "science" }).success).toBe(false);
  });
});
