/**
 * Integration tests for getGradeProgression and getCompetencyConnections.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { seedTestDb } from "../test/seed.js";
import { getGradeProgression, getCompetencyConnections } from "./progression-tools.js";

beforeAll(() => {
  seedTestDb();
});

// ─── getGradeProgression ─────────────────────────────────────────

describe("getGradeProgression", () => {
  it("returns curriculum across a grade range for a subject", () => {
    const result = getGradeProgression({
      subject: "science",
      grade_from: 0,
      grade_to: 2,
    });
    const structured = result.structuredContent as {
      subject: string;
      grade_from: number;
      grade_to: number;
      grades: Array<{ grade: number; courses: unknown[] }>;
    };

    expect(structured.subject).toBe("science");
    expect(structured.grades.length).toBe(3); // K, 1, 2
  });

  it("filters by focus=big_ideas", () => {
    const result = getGradeProgression({
      subject: "science",
      grade_from: 0,
      grade_to: 2,
      focus: "big_ideas",
    });
    const text = result.content[0].text;
    expect(text).toContain("Big Ideas");
    // Should NOT contain competency sections since focus is big_ideas
    expect(text).not.toContain("**Competencies:**");
    expect(text).not.toContain("**Content (KDU):**");
  });

  it("filters by focus=competencies", () => {
    const result = getGradeProgression({
      subject: "science",
      grade_from: 0,
      grade_to: 1,
      focus: "competencies",
    });
    const text = result.content[0].text;
    expect(text).toContain("Competencies");
  });

  it("filters results by concept query", () => {
    const result = getGradeProgression({
      subject: "science",
      grade_from: 0,
      grade_to: 2,
      query: "curiosity",
    });
    const structured = result.structuredContent as { total_matches: number; query: string };
    expect(structured.query).toBe("curiosity");
    // Should find the "curiosity" competencies at K and 2
    expect(structured.total_matches).toBeGreaterThan(0);
  });

  it("returns empty when no courses in range", () => {
    const result = getGradeProgression({
      subject: "science",
      grade_from: 10,
      grade_to: 12,
    });
    expect(result.content[0].text).toContain("No courses found");
  });

  it("returns empty when query matches nothing", () => {
    const result = getGradeProgression({
      subject: "science",
      grade_from: 0,
      grade_to: 2,
      query: "quantum physics",
    });
    const structured = result.structuredContent as { grades: unknown[] };
    expect(result.content[0].text).toContain("No curriculum items matching");
  });

  it("includes grade headers in markdown output", () => {
    const result = getGradeProgression({
      subject: "mathematics",
      grade_from: 0,
      grade_to: 2,
    });
    const text = result.content[0].text;
    expect(text).toContain("## Grade K");
    expect(text).toContain("## Grade 1");
    expect(text).toContain("## Grade 2");
  });
});

// ─── getCompetencyConnections ────────────────────────────────────

describe("getCompetencyConnections", () => {
  it("finds connections for a competency that appears across subjects", () => {
    // "reasoning" appears in math competencies, "curiosity" in science
    const result = getCompetencyConnections({
      competency_text: "Use reasoning to explore and make connections",
    });
    const structured = result.structuredContent as { connections: Array<{ competency: string; subject_id: string }> };
    expect(structured.connections.length).toBeGreaterThan(0);
  });

  it("returns empty for very specific text that has no matches", () => {
    const result = getCompetencyConnections({
      competency_text: "extremely specific non-existent competency about underwater basket weaving",
    });
    const structured = result.structuredContent as { connections: unknown[] };
    expect(structured.connections.length).toBe(0);
  });

  it("rejects very short input", () => {
    const result = getCompetencyConnections({
      competency_text: "ab cd ef",
    });
    // Words must be >3 chars to be used as search terms
    // "ab cd ef" has no words > 3 chars
    expect(result.content[0].text).toContain("too short");
  });

  it("includes scope information in output", () => {
    const result = getCompetencyConnections({
      competency_text: "curiosity and wonder about the world",
      scope: "all",
    });
    const structured = result.structuredContent as { scope: string };
    expect(structured.scope).toBe("all");
  });
});
