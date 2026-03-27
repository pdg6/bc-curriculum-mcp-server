/**
 * Integration tests for searchCurriculum (FTS5 search).
 */

import { describe, it, expect, beforeAll } from "vitest";
import { seedTestDb } from "../test/seed.js";
import { searchCurriculum } from "./search-tools.js";

beforeAll(() => {
  seedTestDb();
});

describe("searchCurriculum", () => {
  it("finds results matching a simple keyword", () => {
    const result = searchCurriculum({ query: "living things" });
    const structured = result.structuredContent as { total: number; results: Array<{ content: string }> };
    expect(structured.total).toBeGreaterThan(0);
    // At least one result should mention "living"
    expect(structured.results.some((r) => r.content.toLowerCase().includes("living"))).toBe(true);
  });

  it("filters by subject", () => {
    const result = searchCurriculum({ query: "number concepts", subject: "mathematics" });
    const structured = result.structuredContent as { total: number; results: Array<{ subject_id: string }> };
    expect(structured.total).toBeGreaterThan(0);
    expect(structured.results.every((r) => r.subject_id === "mathematics")).toBe(true);
  });

  it("filters by grade", () => {
    const result = searchCurriculum({ query: "living things", grade: 0 });
    const structured = result.structuredContent as { total: number; results: Array<{ grade: number }> };
    expect(structured.total).toBeGreaterThan(0);
    expect(structured.results.every((r) => r.grade === 0)).toBe(true);
  });

  it("filters by content_type", () => {
    const result = searchCurriculum({ query: "curiosity", content_type: "competency" });
    const structured = result.structuredContent as { total: number; results: Array<{ source_type: string }> };
    expect(structured.total).toBeGreaterThan(0);
    expect(structured.results.every((r) => r.source_type === "competency")).toBe(true);
  });

  it("respects the limit parameter", () => {
    const result = searchCurriculum({ query: "living", limit: 2 });
    const structured = result.structuredContent as { total: number; results: unknown[] };
    expect(structured.results.length).toBeLessThanOrEqual(2);
  });

  it("returns empty results with a helpful message when nothing matches", () => {
    const result = searchCurriculum({ query: "quantum entanglement" });
    const structured = result.structuredContent as { total: number };
    expect(structured.total).toBe(0);
    expect(result.content[0].text).toContain("No results found");
  });

  it("handles advanced boolean queries with OR", () => {
    const result = searchCurriculum({ query: "patterns OR counting" });
    const structured = result.structuredContent as { total: number };
    expect(structured.total).toBeGreaterThan(0);
  });

  it("includes structured metadata in results", () => {
    const result = searchCurriculum({ query: "plants" });
    const structured = result.structuredContent as {
      total: number;
      query: string;
      results: Array<{
        content: string;
        source_type: string;
        course_id: string;
        subject_id: string;
        grade: number;
        relevance_rank: number;
      }>;
    };

    if (structured.total > 0) {
      const first = structured.results[0];
      expect(first.content).toBeDefined();
      expect(first.source_type).toBeDefined();
      expect(first.course_id).toBeDefined();
      expect(first.subject_id).toBeDefined();
      expect(typeof first.grade).toBe("number");
      expect(typeof first.relevance_rank).toBe("number");
    }
  });

  it("renders markdown headers in text output", () => {
    const result = searchCurriculum({ query: "number concepts" });
    expect(result.content[0].text).toContain("# Search Results");
  });
});
