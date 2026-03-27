/**
 * Unit tests for formatting utilities.
 */

import { describe, it, expect } from "vitest";
import {
  formatGrade,
  truncateIfNeeded,
  formatCourseLine,
  formatCourseCurriculum,
} from "./formatters.js";
import type { CourseRow, BigIdeaRow, CompetencyRow, ContentItemRow } from "./database.js";

// ─── formatGrade ─────────────────────────────────────────────────

describe("formatGrade", () => {
  it("returns 'K' for grade 0 (Kindergarten)", () => {
    expect(formatGrade(0)).toBe("K");
  });

  it("returns the numeric string for grades 1-12", () => {
    expect(formatGrade(1)).toBe("1");
    expect(formatGrade(7)).toBe("7");
    expect(formatGrade(12)).toBe("12");
  });
});

// ─── truncateIfNeeded ────────────────────────────────────────────

describe("truncateIfNeeded", () => {
  it("returns text unchanged when under the character limit", () => {
    const short = "Hello world";
    const result = truncateIfNeeded(short, 1);
    expect(result.text).toBe(short);
    expect(result.truncated).toBe(false);
  });

  it("truncates text exceeding the 25,000 character limit", () => {
    // Build a string that exceeds 25,000 chars
    const longText = "Line of text here\n".repeat(2000); // ~36,000 chars
    const result = truncateIfNeeded(longText, 100);
    expect(result.truncated).toBe(true);
    expect(result.text.length).toBeLessThanOrEqual(26_000); // some slack for the truncation message
    expect(result.text).toContain("Response truncated");
    expect(result.text).toContain("100 total items");
  });

  it("truncates at a newline boundary for clean output", () => {
    // Create text that's just over the limit with known newline positions
    const lines = [];
    for (let i = 0; i < 2000; i++) {
      lines.push(`Line ${i}: ${"x".repeat(10)}`);
    }
    const text = lines.join("\n");
    const result = truncateIfNeeded(text, 50);
    if (result.truncated) {
      // The truncated text (before the message) should end at a line boundary
      const beforeMessage = result.text.split("\n\n---\n")[0];
      // Should not end mid-line
      expect(beforeMessage.endsWith("\n") || beforeMessage.match(/Line \d+: x+$/) !== null).toBe(true);
    }
  });
});

// ─── formatCourseLine ────────────────────────────────────────────

describe("formatCourseLine", () => {
  const course: CourseRow = {
    id: "science-1",
    subject_id: "science",
    grade: 1,
    name: "Science 1",
    slug: "core",
    url: "https://curriculum.gov.bc.ca/curriculum/science/1/core",
    crawled_at: null,
  };

  it("formats a course as a markdown list item", () => {
    const line = formatCourseLine(course);
    expect(line).toContain("**Science 1**");
    expect(line).toContain("Grade 1");
    expect(line).toContain("`science-1`");
  });

  it("shows K for kindergarten courses", () => {
    const kCourse: CourseRow = { ...course, id: "science-k", grade: 0, name: "Science K" };
    const line = formatCourseLine(kCourse);
    expect(line).toContain("Grade K");
  });
});

// ─── formatCourseCurriculum ──────────────────────────────────────

describe("formatCourseCurriculum", () => {
  const course: CourseRow = {
    id: "science-1",
    subject_id: "science",
    grade: 1,
    name: "Science 1",
    slug: "core",
    url: "https://curriculum.gov.bc.ca/curriculum/science/1/core",
    crawled_at: null,
  };

  const bigIdeas: BigIdeaRow[] = [
    { id: 1, course_id: "science-1", text: "Living things survive.", elaboration: "Adaptation intro.", sequence: 1 },
  ];

  const competencies: CompetencyRow[] = [
    { id: 1, course_id: "science-1", domain: "Questioning", subdomain: null, text: "Ask questions about nature", elaboration: null, sequence: 1 },
    { id: 2, course_id: "science-1", domain: "Communicating", subdomain: null, text: "Share findings orally", elaboration: "Use simple language.", sequence: 2 },
  ];

  const contentItems: ContentItemRow[] = [
    { id: 1, course_id: "science-1", text: "living vs non-living", elaboration: null, examples: null, source_course: null, sequence: 1 },
    { id: 2, course_id: "science-1", text: "plants need sunlight", elaboration: "Photosynthesis intro.", examples: null, source_course: "shared-content", sequence: 2 },
  ];

  it("produces markdown with all three columns", () => {
    const output = formatCourseCurriculum(course, bigIdeas, competencies, contentItems);
    expect(output).toContain("## Science 1");
    expect(output).toContain("### Big Ideas");
    expect(output).toContain("Living things survive.");
    expect(output).toContain("*Elaboration: Adaptation intro.*");
    expect(output).toContain("### Curricular Competencies");
    expect(output).toContain("#### Questioning");
    expect(output).toContain("#### Communicating");
    expect(output).toContain("### Content (Know/Do/Understand)");
    expect(output).toContain("living vs non-living");
    expect(output).toContain("*(shared-content)*");
  });

  it("handles empty arrays gracefully", () => {
    const output = formatCourseCurriculum(course, [], [], []);
    expect(output).toContain("*No Big Ideas found");
    expect(output).toContain("*No Curricular Competencies found");
    expect(output).toContain("*No Content items found");
  });
});
