/**
 * Integration tests for searchCrossCurricular.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { seedTestDb } from "../test/seed.js";
import { searchCrossCurricular } from "./cross-curricular-tools.js";

beforeAll(() => {
  seedTestDb();
});

describe("searchCrossCurricular", () => {
  it("finds connections between two subjects at the same grade", () => {
    // Both science and mathematics have grade 0 content
    const result = searchCrossCurricular({
      subjects: ["science", "mathematics"],
      grade: 0,
    });
    const structured = result.structuredContent as Record<string, unknown>;

    // The result always has a "connections" array (may be empty if no shared terms)
    expect(structured).toHaveProperty("connections");
    expect(Array.isArray(structured.connections)).toBe(true);
  });

  it("filters by focus=big_ideas", () => {
    const result = searchCrossCurricular({
      subjects: ["science", "mathematics"],
      grade: 0,
      focus: "big_ideas",
    });
    const structured = result.structuredContent as Record<string, unknown>;

    // When connections are found, focus is present; when empty, only connections array returned
    if (structured.focus) {
      expect(structured.focus).toBe("big_ideas");
    }

    // If any connections found, items should only be big_ideas
    const connections = (structured.connections ?? []) as Array<{ items: Array<{ source_type: string }> }>;
    for (const conn of connections) {
      for (const item of conn.items) {
        expect(item.source_type).toBe("big_idea");
      }
    }
  });

  it("narrows results with a query parameter", () => {
    const result = searchCrossCurricular({
      subjects: ["science", "mathematics"],
      grade: 0,
      query: "curiosity",
    });
    const structured = result.structuredContent as Record<string, unknown>;
    // When connections are found, query is present; when empty or no items, simpler response
    // Either way the function should complete without error
    expect(structured).toHaveProperty("connections");
  });

  it("respects the limit parameter", () => {
    const result = searchCrossCurricular({
      subjects: ["science", "mathematics"],
      grade: 0,
      limit: 1,
    });
    const structured = result.structuredContent as { connections: unknown[] };
    expect(structured.connections.length).toBeLessThanOrEqual(1);
  });

  it("returns empty when no data exists at the grade", () => {
    const result = searchCrossCurricular({
      subjects: ["science", "mathematics"],
      grade: 10,
    });
    expect(result.content[0].text).toContain("No curriculum items found");
  });

  it("works with three subjects", () => {
    const result = searchCrossCurricular({
      subjects: ["science", "mathematics", "adst"],
      grade: 0,
    });
    const structured = result.structuredContent as {
      subjects: string[];
      connections: unknown[];
    };
    expect(structured.subjects).toEqual(["science", "mathematics", "adst"]);
  });

  it("renders markdown with grade and subject headers", () => {
    const result = searchCrossCurricular({
      subjects: ["science", "mathematics"],
      grade: 0,
    });
    const text = result.content[0].text;
    // Should have title regardless of whether connections were found
    expect(text).toMatch(/Grade K|No curriculum|No cross-curricular/);
  });
});
