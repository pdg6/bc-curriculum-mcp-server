/**
 * Integration tests for listCourses and getCourseCurriculum.
 *
 * Uses a seeded in-memory SQLite database.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { seedTestDb } from "../test/seed.js";
import { listCourses, getCourseCurriculum } from "./curriculum-tools.js";

beforeAll(() => {
  seedTestDb();
});

// ─── listCourses ─────────────────────────────────────────────────

describe("listCourses", () => {
  it("returns all seeded courses when no filters are applied", () => {
    const result = listCourses({});
    const structured = result.structuredContent as { total: number; courses: unknown[] };
    expect(structured.total).toBe(7); // 3 science + 3 math + 1 adst
    expect(structured.courses.length).toBe(7);
  });

  it("filters by subject", () => {
    const result = listCourses({ subject: "science" });
    const structured = result.structuredContent as { total: number; courses: Array<{ subject: string }> };
    expect(structured.total).toBe(3);
    expect(structured.courses.every((c) => c.subject === "science")).toBe(true);
  });

  it("filters by grade", () => {
    const result = listCourses({ grade: 0 });
    const structured = result.structuredContent as { total: number; courses: Array<{ grade: number; grade_label: string }> };
    // K courses: science-k, mathematics-k, adst-k
    expect(structured.total).toBe(3);
    expect(structured.courses.every((c) => c.grade === 0)).toBe(true);
    expect(structured.courses[0].grade_label).toBe("K");
  });

  it("filters by subject + grade", () => {
    const result = listCourses({ subject: "mathematics", grade: 2 });
    const structured = result.structuredContent as { total: number; courses: Array<{ name: string }> };
    expect(structured.total).toBe(1);
    expect(structured.courses[0].name).toBe("Mathematics 2");
  });

  it("returns empty with message when no courses match", () => {
    const result = listCourses({ subject: "science", grade: 12 });
    const structured = result.structuredContent as { total: number };
    expect(structured.total).toBe(0);
    expect(result.content[0].text).toContain("No courses found");
  });

  it("includes markdown header in text response", () => {
    const result = listCourses({});
    expect(result.content[0].text).toContain("# BC Curriculum Courses");
  });

  it("groups courses by subject in text output", () => {
    const result = listCourses({});
    const text = result.content[0].text;
    expect(text).toContain("## science");
    expect(text).toContain("## mathematics");
  });
});

// ─── getCourseCurriculum ─────────────────────────────────────────

describe("getCourseCurriculum", () => {
  it("returns full curriculum for a subject + grade", () => {
    const result = getCourseCurriculum({ subject: "science", grade: 0 });
    const structured = result.structuredContent as { courses: Array<{
      course: { name: string };
      big_ideas: Array<{ text: string }>;
      curricular_competencies: Array<{ domain: string; text: string }>;
      content_items: Array<{ text: string }>;
    }> };

    expect(structured.courses.length).toBe(1);
    const course = structured.courses[0];
    expect(course.course.name).toBe("Science K");
    expect(course.big_ideas.length).toBe(2);
    expect(course.curricular_competencies.length).toBe(3);
    expect(course.content_items.length).toBe(2);
  });

  it("includes elaborations in structured output", () => {
    const result = getCourseCurriculum({ subject: "science", grade: 0 });
    const structured = result.structuredContent as { courses: Array<{
      big_ideas: Array<{ text: string; elaboration: string | null }>;
    }> };

    const firstBigIdea = structured.courses[0].big_ideas[0];
    expect(firstBigIdea.elaboration).toContain("Students observe");
  });

  it("returns empty when course not found", () => {
    const result = getCourseCurriculum({ subject: "science", grade: 12 });
    const structured = result.structuredContent as { courses: unknown[] };
    expect(structured.courses.length).toBe(0);
    expect(result.content[0].text).toContain("No courses found");
  });

  it("filters by course slug", () => {
    // All seeded courses have slug "core"
    const result = getCourseCurriculum({ subject: "science", grade: 1, course: "core" });
    const structured = result.structuredContent as { courses: unknown[] };
    expect(structured.courses.length).toBe(1);

    // Non-existent slug
    const empty = getCourseCurriculum({ subject: "science", grade: 1, course: "nonexistent" });
    expect((empty.structuredContent as { courses: unknown[] }).courses.length).toBe(0);
  });

  it("renders markdown with Big Ideas, Competencies, and Content sections", () => {
    const result = getCourseCurriculum({ subject: "mathematics", grade: 0 });
    const text = result.content[0].text;
    expect(text).toContain("### Big Ideas");
    expect(text).toContain("Numbers represent quantity");
    expect(text).toContain("### Curricular Competencies");
    expect(text).toContain("### Content (Know/Do/Understand)");
    expect(text).toContain("number concepts to 10");
  });
});
