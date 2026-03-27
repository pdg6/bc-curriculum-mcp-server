/**
 * Integration tests for getCurriculumChanges and getCourseHistory.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { seedTestDb } from "../test/seed.js";
import { getCurriculumChanges, getCourseHistory } from "./changelog-tools.js";

beforeAll(() => {
  seedTestDb();
});

// ─── getCurriculumChanges ────────────────────────────────────────

describe("getCurriculumChanges", () => {
  it("returns changelog entries since a date far in the past", () => {
    const result = getCurriculumChanges({ since: "2000-01-01" });
    const structured = result.structuredContent as {
      total: number;
      changes: Array<{ change_type: string; course_id: string }>;
    };
    expect(structured.total).toBe(3); // 1 modified, 1 added, 1 removed
  });

  it("groups changes by course in the summary", () => {
    const result = getCurriculumChanges({ since: "2000-01-01" });
    const structured = result.structuredContent as { courses_affected: number };
    expect(structured.courses_affected).toBeGreaterThanOrEqual(2); // science-1, science-2, mathematics-1
  });

  it("filters by subject", () => {
    const result = getCurriculumChanges({ since: "2000-01-01", subject: "science" });
    const structured = result.structuredContent as {
      total: number;
      changes: Array<{ subject_id: string }>;
    };
    expect(structured.total).toBe(2); // science-1 modified + science-2 added
    expect(structured.changes.every((c) => c.subject_id === "science")).toBe(true);
  });

  it("filters by change_type", () => {
    const result = getCurriculumChanges({ since: "2000-01-01", change_type: "added" });
    const structured = result.structuredContent as {
      total: number;
      changes: Array<{ change_type: string }>;
    };
    expect(structured.total).toBe(1);
    expect(structured.changes[0].change_type).toBe("added");
  });

  it("filters by grade", () => {
    const result = getCurriculumChanges({ since: "2000-01-01", grade: 1 });
    const structured = result.structuredContent as {
      total: number;
      changes: Array<{ grade: number }>;
    };
    // science-1 (grade 1) and mathematics-1 (grade 1) have changes
    expect(structured.changes.every((c) => c.grade === 1)).toBe(true);
  });

  it("respects the limit parameter", () => {
    const result = getCurriculumChanges({ since: "2000-01-01", limit: 1 });
    const structured = result.structuredContent as { total: number; changes: unknown[] };
    expect(structured.changes.length).toBeLessThanOrEqual(1);
  });

  it("returns empty with message when no changes found", () => {
    const result = getCurriculumChanges({ since: "2099-01-01" });
    const structured = result.structuredContent as { total: number };
    expect(structured.total).toBe(0);
    expect(result.content[0].text).toContain("No curriculum changes");
  });

  it("includes old_text and new_text for modifications", () => {
    const result = getCurriculumChanges({ since: "2000-01-01", change_type: "modified" });
    const structured = result.structuredContent as {
      changes: Array<{ old_text: string | null; new_text: string | null }>;
    };
    const mod = structured.changes[0];
    expect(mod.old_text).toBeDefined();
    expect(mod.new_text).toBeDefined();
    expect(mod.old_text).not.toEqual(mod.new_text);
  });

  it("renders summary and details sections in markdown", () => {
    const result = getCurriculumChanges({ since: "2000-01-01" });
    const text = result.content[0].text;
    expect(text).toContain("## Summary");
    expect(text).toContain("## Details");
  });
});

// ─── getCourseHistory ────────────────────────────────────────────

describe("getCourseHistory", () => {
  it("returns snapshot history for a course", () => {
    const result = getCourseHistory({ subject: "science", grade: 1 });
    const structured = result.structuredContent as {
      courses: Array<{
        course_id: string;
        snapshots: Array<{ content_hash: string; big_idea_count: number }>;
        changes: Array<{ change_type: string }>;
      }>;
    };
    expect(structured.courses.length).toBe(1);
    expect(structured.courses[0].snapshots.length).toBeGreaterThan(0);
    expect(structured.courses[0].snapshots[0].content_hash).toBe("snapshot-hash-v1");
  });

  it("includes change history for a course", () => {
    const result = getCourseHistory({ subject: "science", grade: 1 });
    const structured = result.structuredContent as {
      courses: Array<{ changes: Array<{ change_type: string }> }>;
    };
    expect(structured.courses[0].changes.length).toBeGreaterThan(0);
    expect(structured.courses[0].changes[0].change_type).toBe("modified");
  });

  it("returns empty when course not found", () => {
    const result = getCourseHistory({ subject: "science", grade: 12 });
    const structured = result.structuredContent as { courses: unknown[] };
    expect(structured.courses.length).toBe(0);
    expect(result.content[0].text).toContain("No courses found");
  });

  it("filters by course slug", () => {
    const result = getCourseHistory({ subject: "science", grade: 1, course: "core" });
    const structured = result.structuredContent as { courses: Array<{ course_id: string }> };
    expect(structured.courses.length).toBe(1);
  });

  it("shows 'no snapshots' message for courses without crawl history", () => {
    // adst-k has no snapshots seeded
    const result = getCourseHistory({ subject: "adst", grade: 0 });
    const text = result.content[0].text;
    expect(text).toContain("No crawl history");
  });

  it("renders markdown with course name and URL", () => {
    const result = getCourseHistory({ subject: "science", grade: 1 });
    const text = result.content[0].text;
    expect(text).toContain("Science 1");
    expect(text).toContain("curriculum.gov.bc.ca");
  });
});
