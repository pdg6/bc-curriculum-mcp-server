/**
 * Integration tests for reference tools:
 * getCoreCompetencies, getFppl, getAssessmentResources, getCrawlStatus
 */

import { describe, it, expect, beforeAll } from "vitest";
import { seedTestDb } from "../test/seed.js";
import {
  getCoreCompetencies,
  getFppl,
  getAssessmentResources,
  getCrawlStatus,
} from "./reference-tools.js";

beforeAll(() => {
  seedTestDb();
});

// ─── getCoreCompetencies ─────────────────────────────────────────

describe("getCoreCompetencies", () => {
  it("returns all core competencies when domain is 'all'", () => {
    const result = getCoreCompetencies({});
    const structured = result.structuredContent as {
      competencies: Array<{ domain: string; name: string; description: string | null }>;
    };
    expect(structured.competencies.length).toBe(4);
  });

  it("filters by communication domain", () => {
    const result = getCoreCompetencies({ domain: "communication" });
    const structured = result.structuredContent as {
      competencies: Array<{ domain: string; name: string }>;
    };
    expect(structured.competencies.length).toBe(1);
    expect(structured.competencies[0].name).toBe("Communicating");
  });

  it("filters by thinking domain", () => {
    const result = getCoreCompetencies({ domain: "thinking" });
    const structured = result.structuredContent as {
      competencies: Array<{ domain: string }>;
    };
    expect(structured.competencies.length).toBe(2);
    expect(structured.competencies.every((c) => c.domain === "Thinking")).toBe(true);
  });

  it("filters by personal_social domain", () => {
    const result = getCoreCompetencies({ domain: "personal_social" });
    const structured = result.structuredContent as {
      competencies: Array<{ domain: string }>;
    };
    expect(structured.competencies.length).toBe(1);
    expect(structured.competencies[0].domain).toBe("Personal and Social");
  });

  it("includes proficiency profiles when available", () => {
    const result = getCoreCompetencies({ domain: "communication" });
    const structured = result.structuredContent as {
      competencies: Array<{ profiles: string[] | null }>;
    };
    expect(structured.competencies[0].profiles).toBeInstanceOf(Array);
    expect(structured.competencies[0].profiles!.length).toBeGreaterThan(0);
  });

  it("returns null profiles when none exist", () => {
    const result = getCoreCompetencies({ domain: "thinking" });
    const structured = result.structuredContent as {
      competencies: Array<{ name: string; profiles: string[] | null }>;
    };
    const criticalThinking = structured.competencies.find((c) => c.name === "Critical and Reflective Thinking");
    expect(criticalThinking?.profiles).toBeNull();
  });

  it("renders markdown with domain headers", () => {
    const result = getCoreCompetencies({});
    const text = result.content[0].text;
    expect(text).toContain("# BC Core Competencies");
    expect(text).toContain("## Communication");
    expect(text).toContain("## Thinking");
    expect(text).toContain("## Personal and Social");
  });
});

// ─── getFppl ─────────────────────────────────────────────────────

describe("getFppl", () => {
  it("returns all FPPL principles", () => {
    const result = getFppl({});
    const structured = result.structuredContent as {
      principles: Array<{ principle: string; description: string | null }>;
    };
    expect(structured.principles.length).toBe(3);
  });

  it("includes principle descriptions", () => {
    const result = getFppl({});
    const structured = result.structuredContent as {
      principles: Array<{ principle: string; description: string | null }>;
    };
    expect(structured.principles[0].description).toContain("Holistic view");
  });

  it("includes connections data", () => {
    const result = getFppl({});
    const structured = result.structuredContent as {
      principles: Array<{ connections: Record<string, string> | null }>;
    };
    const first = structured.principles[0];
    expect(first.connections).toBeDefined();
    expect(first.connections).toHaveProperty("science");
  });

  it("filters connections by subject when specified", () => {
    const result = getFppl({ subject: "science" });
    const text = result.content[0].text;
    expect(text).toContain("Connections to science");
  });

  it("renders markdown with FPPL header", () => {
    const result = getFppl({});
    expect(result.content[0].text).toContain("# First Peoples Principles of Learning");
  });
});

// ─── getAssessmentResources ──────────────────────────────────────

describe("getAssessmentResources", () => {
  it("returns all assessment resources when no filters", () => {
    const result = getAssessmentResources({});
    const structured = result.structuredContent as {
      total: number;
      resources: Array<{ title: string }>;
    };
    expect(structured.total).toBe(3);
  });

  it("filters by subject", () => {
    const result = getAssessmentResources({ subject: "science" });
    const structured = result.structuredContent as {
      total: number;
      resources: Array<{ subject: string }>;
    };
    expect(structured.total).toBe(1);
    expect(structured.resources[0].subject).toBe("science");
  });

  it("filters by grade", () => {
    const result = getAssessmentResources({ grade: 1 });
    const structured = result.structuredContent as { total: number };
    expect(structured.total).toBe(1); // only science grade 1 assessment
  });

  it("filters by resource_type", () => {
    const result = getAssessmentResources({ resource_type: "reporting" });
    const structured = result.structuredContent as {
      total: number;
      resources: Array<{ title: string }>;
    };
    expect(structured.total).toBe(1);
    expect(structured.resources[0].title).toContain("Reporting");
  });

  it("returns empty when no resources match", () => {
    const result = getAssessmentResources({ subject: "adst" });
    const structured = result.structuredContent as { resources: unknown[] };
    expect(structured.resources.length).toBe(0);
    expect(result.content[0].text).toContain("No assessment resources");
  });
});

// ─── getCrawlStatus ──────────────────────────────────────────────

describe("getCrawlStatus", () => {
  it("returns overall database statistics", () => {
    const result = getCrawlStatus({});
    const structured = result.structuredContent as {
      totals: { courses: number; big_ideas: number; competencies: number; content_items: number };
      subjects: Array<{ id: string; courses: number }>;
      recent_errors: Array<{ error: string }>;
    };

    expect(structured.totals.courses).toBe(7);
    expect(structured.totals.big_ideas).toBe(8);
    expect(structured.totals.competencies).toBe(11);
    expect(structured.totals.content_items).toBe(11);
  });

  it("includes per-subject breakdowns", () => {
    const result = getCrawlStatus({});
    const structured = result.structuredContent as {
      subjects: Array<{ id: string; courses: number; big_ideas: number }>;
    };
    const science = structured.subjects.find((s) => s.id === "science");
    expect(science).toBeDefined();
    expect(science!.courses).toBe(3);
    expect(science!.big_ideas).toBe(4); // 2 at K, 1 at 1, 1 at 2
  });

  it("filters by subject", () => {
    const result = getCrawlStatus({ subject: "mathematics" });
    const structured = result.structuredContent as {
      subjects: Array<{ id: string }>;
    };
    expect(structured.subjects.length).toBe(1);
    expect(structured.subjects[0].id).toBe("mathematics");
  });

  it("includes recent crawl errors", () => {
    const result = getCrawlStatus({});
    const structured = result.structuredContent as {
      recent_errors: Array<{ url: string; error: string }>;
    };
    expect(structured.recent_errors.length).toBeGreaterThan(0);
    expect(structured.recent_errors[0].error).toContain("Page not found");
  });

  it("renders markdown with status header", () => {
    const result = getCrawlStatus({});
    const text = result.content[0].text;
    expect(text).toContain("# BC Curriculum Database Status");
    expect(text).toContain("**Total:**");
  });
});
