/**
 * Reference data tools: core competencies, FPPL, assessment resources, crawl status.
 */

import { getDb } from "../services/database.js";
import type {
  CoreCompetencyRow,
  FpplRow,
  AssessmentRow,
  CrawlLogRow,
} from "../services/database.js";
import type {
  GetCoreCompetenciesInput,
  GetFpplInput,
  GetAssessmentResourcesInput,
  GetCrawlStatusInput,
} from "../schemas/tool-schemas.js";
import { truncateIfNeeded } from "../services/formatters.js";

// ─── Core Competencies ──────────────────────────────────────────

const DOMAIN_MAP: Record<string, string> = {
  communication: "Communication",
  thinking: "Thinking",
  personal_social: "Personal and Social",
};

export function getCoreCompetencies(params: GetCoreCompetenciesInput): {
  content: Array<{ type: "text"; text: string }>;
  structuredContent: Record<string, unknown>;
} {
  const db = getDb();
  const domain = params.domain ?? "all";

  let sql = "SELECT * FROM core_competencies";
  const bindings: unknown[] = [];

  if (domain !== "all") {
    const mappedDomain = DOMAIN_MAP[domain];
    if (mappedDomain) {
      sql += " WHERE domain = ?";
      bindings.push(mappedDomain);
    }
  }

  sql += " ORDER BY domain, name";

  const competencies = db.prepare(sql).all(...bindings) as CoreCompetencyRow[];

  if (competencies.length === 0) {
    return {
      content: [
        {
          type: "text",
          text: `No core competencies found${domain !== "all" ? ` for domain "${domain}"` : ""}. Core competencies may not have been crawled yet.`,
        },
      ],
      structuredContent: { competencies: [] },
    };
  }

  const lines: string[] = ["# BC Core Competencies", ""];

  let currentDomain = "";
  for (const cc of competencies) {
    if (cc.domain !== currentDomain) {
      currentDomain = cc.domain;
      lines.push(`## ${currentDomain}`);
      lines.push("");
    }

    lines.push(`### ${cc.name}`);
    if (cc.description) {
      lines.push(cc.description);
    }
    if (cc.profiles) {
      try {
        const profiles = JSON.parse(cc.profiles) as string[];
        lines.push("\n**Proficiency Profiles:**");
        for (const profile of profiles) {
          lines.push(`- ${profile}`);
        }
      } catch {
        // profiles field might not be valid JSON
      }
    }
    lines.push("");
  }

  const { text } = truncateIfNeeded(lines.join("\n"), competencies.length);

  return {
    content: [{ type: "text", text }],
    structuredContent: {
      competencies: competencies.map((cc) => ({
        id: cc.id,
        domain: cc.domain,
        name: cc.name,
        description: cc.description,
        profiles: cc.profiles ? JSON.parse(cc.profiles) : null,
      })),
    },
  };
}

// ─── First Peoples Principles of Learning ───────────────────────

export function getFppl(params: GetFpplInput): {
  content: Array<{ type: "text"; text: string }>;
  structuredContent: Record<string, unknown>;
} {
  const db = getDb();

  const principles = db
    .prepare("SELECT * FROM fppl_principles ORDER BY id")
    .all() as FpplRow[];

  if (principles.length === 0) {
    return {
      content: [
        {
          type: "text",
          text: "First Peoples Principles of Learning have not been crawled yet. Run the crawler to populate this data.",
        },
      ],
      structuredContent: { principles: [] },
    };
  }

  const lines: string[] = [
    "# First Peoples Principles of Learning (FPPL)",
    "",
    "*These principles must be authentically integrated into BC curriculum, not treated as add-ons.*",
    "",
  ];

  const structuredPrinciples: unknown[] = [];

  for (const p of principles) {
    lines.push(`### ${p.principle}`);
    if (p.description) {
      lines.push(p.description);
    }

    let connections: unknown = null;
    if (p.connections) {
      try {
        connections = JSON.parse(p.connections);
        if (params.subject && typeof connections === "object" && connections !== null) {
          // Filter connections to the requested subject
          const filtered = (connections as Record<string, unknown>)[params.subject];
          if (filtered) {
            lines.push(`\n*Connections to ${params.subject}:*`);
            lines.push(`${JSON.stringify(filtered, null, 2)}`);
          }
        }
      } catch {
        // connections field might not be valid JSON
      }
    }

    lines.push("");

    structuredPrinciples.push({
      id: p.id,
      principle: p.principle,
      description: p.description,
      connections,
    });
  }

  const { text } = truncateIfNeeded(lines.join("\n"), principles.length);

  return {
    content: [{ type: "text", text }],
    structuredContent: { principles: structuredPrinciples },
  };
}

// ─── Assessment Resources ───────────────────────────────────────

export function getAssessmentResources(params: GetAssessmentResourcesInput): {
  content: Array<{ type: "text"; text: string }>;
  structuredContent: Record<string, unknown>;
} {
  const db = getDb();
  const resourceType = params.resource_type ?? "all";

  let sql = "SELECT * FROM assessment_resources WHERE 1=1";
  const bindings: unknown[] = [];

  if (params.subject) {
    sql += " AND subject_id = ?";
    bindings.push(params.subject);
  }
  if (params.grade !== undefined) {
    sql += " AND grade = ?";
    bindings.push(params.grade);
  }
  if (resourceType !== "all") {
    sql += " AND resource_type = ?";
    bindings.push(resourceType);
  }

  sql += " ORDER BY subject_id, grade, title";

  const resources = db.prepare(sql).all(...bindings) as AssessmentRow[];

  if (resources.length === 0) {
    return {
      content: [
        {
          type: "text",
          text: `No assessment resources found. Assessment data may not have been crawled yet.`,
        },
      ],
      structuredContent: { resources: [] },
    };
  }

  const lines: string[] = [
    `# Assessment Resources (${resources.length} found)`,
    "",
  ];

  for (const r of resources) {
    lines.push(`## ${r.title}`);
    if (r.subject_id) lines.push(`*Subject: ${r.subject_id} | Grade: ${r.grade || "All"}*`);
    if (r.resource_type) lines.push(`*Type: ${r.resource_type}*`);
    lines.push("");
    lines.push(r.content);
    lines.push("");
  }

  const { text } = truncateIfNeeded(lines.join("\n"), resources.length);

  return {
    content: [{ type: "text", text }],
    structuredContent: {
      total: resources.length,
      resources: resources.map((r) => ({
        id: r.id,
        title: r.title,
        subject: r.subject_id,
        grade: r.grade,
        type: r.resource_type,
        content: r.content,
        url: r.url,
      })),
    },
  };
}

// ─── Crawl Status ───────────────────────────────────────────────

export function getCrawlStatus(params: GetCrawlStatusInput): {
  content: Array<{ type: "text"; text: string }>;
  structuredContent: Record<string, unknown>;
} {
  const db = getDb();

  // Get overall crawl stats
  const totalCourses = (
    db.prepare("SELECT COUNT(*) as count FROM courses").get() as { count: number }
  ).count;

  const totalBigIdeas = (
    db.prepare("SELECT COUNT(*) as count FROM big_ideas").get() as { count: number }
  ).count;

  const totalCompetencies = (
    db.prepare("SELECT COUNT(*) as count FROM curricular_competencies").get() as { count: number }
  ).count;

  const totalContent = (
    db.prepare("SELECT COUNT(*) as count FROM content_items").get() as { count: number }
  ).count;

  // Get per-subject stats
  let subjectSql = `
    SELECT
      s.id,
      s.name,
      s.crawled_at,
      COUNT(DISTINCT c.id) as course_count,
      (SELECT COUNT(*) FROM big_ideas bi JOIN courses cc ON bi.course_id = cc.id WHERE cc.subject_id = s.id) as big_idea_count,
      (SELECT COUNT(*) FROM curricular_competencies cc2 JOIN courses cc ON cc2.course_id = cc.id WHERE cc.subject_id = s.id) as competency_count,
      (SELECT COUNT(*) FROM content_items ci JOIN courses cc ON ci.course_id = cc.id WHERE cc.subject_id = s.id) as content_count
    FROM subjects s
    LEFT JOIN courses c ON s.id = c.subject_id
  `;
  const bindings: unknown[] = [];

  if (params.subject) {
    subjectSql += " WHERE s.id = ?";
    bindings.push(params.subject);
  }

  subjectSql += " GROUP BY s.id ORDER BY s.id";

  const subjects = db.prepare(subjectSql).all(...bindings) as Array<{
    id: string;
    name: string;
    crawled_at: string | null;
    course_count: number;
    big_idea_count: number;
    competency_count: number;
    content_count: number;
  }>;

  // Get recent crawl errors
  const errors = db
    .prepare(
      "SELECT url, error, crawled_at FROM crawl_log WHERE error IS NOT NULL ORDER BY crawled_at DESC LIMIT 10"
    )
    .all() as Array<{ url: string; error: string; crawled_at: string }>;

  // Format
  const lines: string[] = [
    "# BC Curriculum Database Status",
    "",
    `**Total:** ${totalCourses} courses, ${totalBigIdeas} Big Ideas, ${totalCompetencies} Competencies, ${totalContent} Content Items`,
    "",
    "## Subjects",
    "",
  ];

  for (const s of subjects) {
    lines.push(
      `- **${s.name}** (\`${s.id}\`) — ${s.course_count} courses, ` +
        `${s.big_idea_count} Big Ideas, ${s.competency_count} Competencies, ` +
        `${s.content_count} Content Items` +
        (s.crawled_at ? ` — Last crawled: ${s.crawled_at}` : " — *Not crawled*")
    );
  }

  if (errors.length > 0) {
    lines.push("");
    lines.push("## Recent Crawl Errors");
    lines.push("");
    for (const e of errors) {
      lines.push(`- ${e.url}: ${e.error} (${e.crawled_at})`);
    }
  }

  return {
    content: [{ type: "text", text: lines.join("\n") }],
    structuredContent: {
      totals: {
        courses: totalCourses,
        big_ideas: totalBigIdeas,
        competencies: totalCompetencies,
        content_items: totalContent,
      },
      subjects: subjects.map((s) => ({
        id: s.id,
        name: s.name,
        crawled_at: s.crawled_at,
        courses: s.course_count,
        big_ideas: s.big_idea_count,
        competencies: s.competency_count,
        content_items: s.content_count,
      })),
      recent_errors: errors,
    },
  };
}
