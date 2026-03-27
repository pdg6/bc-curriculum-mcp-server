/**
 * Grade progression and competency connection tools.
 */

import { getDb } from "../services/database.js";
import type {
  CourseRow,
  BigIdeaRow,
  CompetencyRow,
  ContentItemRow,
  GradeProgressionRow,
  FtsRow,
} from "../services/database.js";
import type {
  GetGradeProgressionInput,
  GetCompetencyConnectionsInput,
} from "../schemas/tool-schemas.js";
import { truncateIfNeeded, formatGrade } from "../services/formatters.js";

/**
 * Show how curriculum builds across grade levels for a subject.
 *
 * When `query` is provided, filters to only items matching that concept at
 * each grade — showing a focused vertical thread (e.g., how "evidence"
 * evolves from grade 4 through grade 12) rather than a full data dump.
 */
export function getGradeProgression(params: GetGradeProgressionInput): {
  content: Array<{ type: "text"; text: string }>;
  structuredContent: Record<string, unknown>;
} {
  const db = getDb();
  const focus = params.focus ?? "all";
  const query = params.query;

  // Get all courses in the grade range for this subject
  const courses = db
    .prepare(
      "SELECT * FROM courses WHERE subject_id = ? AND grade >= ? AND grade <= ? ORDER BY grade, name"
    )
    .all(params.subject, params.grade_from, params.grade_to) as CourseRow[];

  if (courses.length === 0) {
    return {
      content: [
        {
          type: "text",
          text: `No courses found for ${params.subject} grades ${params.grade_from}-${params.grade_to}.`,
        },
      ],
      structuredContent: { grades: [] },
    };
  }

  // If query is provided, build a set of matching course_ids + source_types
  // via FTS so we can filter items at each grade
  let matchingFts: FtsRow[] | null = null;
  if (query) {
    const ftsQuery = query.includes('"') || query.includes("OR")
      ? query
      : query.split(/\s+/).filter((w) => w.length > 2).join(" OR ");

    if (ftsQuery) {
      try {
        matchingFts = db
          .prepare(
            `SELECT content, source_type, source_id, course_id, subject_id, grade, rank
             FROM curriculum_fts
             WHERE curriculum_fts MATCH ?
               AND subject_id = ?
               AND CAST(grade AS INTEGER) >= ?
               AND CAST(grade AS INTEGER) <= ?
             ORDER BY rank
             LIMIT 500`
          )
          .all(ftsQuery, params.subject, params.grade_from, params.grade_to) as FtsRow[];
      } catch {
        // FTS syntax error — fall through to unfiltered
        matchingFts = null;
      }
    }
  }

  // Build a fast lookup: courseId+sourceType → set of matching source_ids
  const ftsMatchSet = new Map<string, Set<string>>();
  if (matchingFts) {
    for (const row of matchingFts) {
      const key = `${row.course_id}|${row.source_type}`;
      if (!ftsMatchSet.has(key)) ftsMatchSet.set(key, new Set());
      ftsMatchSet.get(key)!.add(row.source_id);
    }
  }

  /** Check if an item matches the query filter (or pass through if no query) */
  function matchesQuery(courseId: string, sourceType: string, sourceId: number): boolean {
    if (!matchingFts) return true; // no query = show everything
    const key = `${courseId}|${sourceType}`;
    const ids = ftsMatchSet.get(key);
    return ids ? ids.has(String(sourceId)) : false;
  }

  const titleSuffix = query ? ` — "${query}"` : "";
  const lines: string[] = [
    `# Grade Progression: ${params.subject} (Grades ${formatGrade(params.grade_from)}–${formatGrade(params.grade_to)})${titleSuffix}`,
    "",
  ];

  const structuredGrades: unknown[] = [];

  // Group courses by grade
  const byGrade: Record<number, CourseRow[]> = {};
  for (const course of courses) {
    if (!byGrade[course.grade]) byGrade[course.grade] = [];
    byGrade[course.grade].push(course);
  }

  let totalMatches = 0;

  for (let grade = params.grade_from; grade <= params.grade_to; grade++) {
    const gradeCourses = byGrade[grade] || [];
    if (gradeCourses.length === 0) continue;

    const gradeLines: string[] = [];
    const gradeData: Record<string, unknown>[] = [];
    let gradeHasMatches = false;

    for (const course of gradeCourses) {
      const courseLines: string[] = [];
      const courseData: Record<string, unknown> = {
        course_id: course.id,
        name: course.name,
        grade: course.grade,
      };
      let courseHasMatches = false;

      if (focus === "all" || focus === "big_ideas") {
        const bigIdeas = db
          .prepare("SELECT * FROM big_ideas WHERE course_id = ? ORDER BY sequence")
          .all(course.id) as BigIdeaRow[];
        const filtered = bigIdeas.filter((bi) => matchesQuery(course.id, "big_idea", bi.id));
        if (filtered.length > 0) {
          courseLines.push("\n**Big Ideas:**");
          for (const bi of filtered) {
            courseLines.push(`- ${bi.text}`);
          }
          courseHasMatches = true;
          totalMatches += filtered.length;
        }
        courseData.big_ideas = filtered.map((bi) => bi.text);
      }

      if (focus === "all" || focus === "competencies") {
        const competencies = db
          .prepare(
            "SELECT * FROM curricular_competencies WHERE course_id = ? ORDER BY domain, sequence"
          )
          .all(course.id) as CompetencyRow[];
        const filtered = competencies.filter((cc) => matchesQuery(course.id, "competency", cc.id));
        if (filtered.length > 0) {
          courseLines.push("\n**Competencies:**");
          const byDomain: Record<string, CompetencyRow[]> = {};
          for (const cc of filtered) {
            if (!byDomain[cc.domain]) byDomain[cc.domain] = [];
            byDomain[cc.domain].push(cc);
          }
          for (const [domain, comps] of Object.entries(byDomain)) {
            courseLines.push(`\n*${domain}:*`);
            for (const cc of comps) {
              courseLines.push(`- ${cc.text}`);
            }
          }
          courseHasMatches = true;
          totalMatches += filtered.length;
        }
        courseData.competencies = filtered.map((cc) => ({
          domain: cc.domain,
          text: cc.text,
        }));
      }

      if (focus === "all" || focus === "content") {
        const contentItems = db
          .prepare("SELECT * FROM content_items WHERE course_id = ? ORDER BY sequence")
          .all(course.id) as ContentItemRow[];
        const filtered = contentItems.filter((ci) => matchesQuery(course.id, "content_item", ci.id));
        if (filtered.length > 0) {
          courseLines.push("\n**Content (KDU):**");
          for (const ci of filtered) {
            courseLines.push(`- ${ci.text}`);
          }
          courseHasMatches = true;
          totalMatches += filtered.length;
        }
        courseData.content = filtered.map((ci) => ci.text);
      }

      if (courseHasMatches) {
        gradeLines.push(`\n### ${course.name}`);
        gradeLines.push(...courseLines);
        gradeLines.push("");
        gradeHasMatches = true;
      }

      gradeData.push(courseData);
    }

    if (gradeHasMatches) {
      lines.push(`## Grade ${formatGrade(grade)}`);
      lines.push(...gradeLines);
    }

    structuredGrades.push({ grade, courses: gradeData });
  }

  // If query was given but nothing matched, say so
  if (query && totalMatches === 0) {
    return {
      content: [
        {
          type: "text",
          text: `No curriculum items matching "${query}" found for ${params.subject} grades ${formatGrade(params.grade_from)}–${formatGrade(params.grade_to)}. Try broader terms.`,
        },
      ],
      structuredContent: { grades: [], query },
    };
  }

  const { text } = truncateIfNeeded(lines.join("\n"), totalMatches || courses.length);

  return {
    content: [{ type: "text", text }],
    structuredContent: {
      subject: params.subject,
      grade_from: params.grade_from,
      grade_to: params.grade_to,
      focus,
      query: query || null,
      total_matches: totalMatches,
      grades: structuredGrades,
    },
  };
}

/** Find competencies that appear across multiple subjects or courses */
export function getCompetencyConnections(params: GetCompetencyConnectionsInput): {
  content: Array<{ type: "text"; text: string }>;
  structuredContent: Record<string, unknown>;
} {
  const db = getDb();
  const scope = params.scope ?? "all";

  // Use FTS5 to find similar competencies across the database
  const searchTerms = params.competency_text
    .split(/\s+/)
    .filter((w) => w.length > 3)
    .slice(0, 8)
    .join(" OR ");

  if (!searchTerms) {
    return {
      content: [
        {
          type: "text",
          text: "Competency text is too short to search for connections. Provide a longer description.",
        },
      ],
      structuredContent: { connections: [] },
    };
  }

  let sql = `
    SELECT
      content,
      source_type,
      source_id,
      course_id,
      subject_id,
      grade,
      rank
    FROM curriculum_fts
    WHERE curriculum_fts MATCH ?
      AND source_type = 'competency'
  `;
  const bindings: unknown[] = [searchTerms];

  sql += " ORDER BY rank LIMIT 20";

  let results;
  try {
    results = db.prepare(sql).all(...bindings) as Array<{
      content: string;
      source_type: string;
      source_id: string;
      course_id: string;
      subject_id: string;
      grade: string;
      rank: number;
    }>;
  } catch {
    return {
      content: [
        {
          type: "text",
          text: `Could not search for competency connections. Try different wording.`,
        },
      ],
      structuredContent: { connections: [] },
    };
  }

  // Filter by scope
  if (scope === "same_subject") {
    // Get the subject of the input competency (find best match first)
    const firstResult = results[0];
    if (firstResult) {
      results = results.filter((r) => r.subject_id === firstResult.subject_id);
    }
  } else if (scope === "cross_subject") {
    const firstResult = results[0];
    if (firstResult) {
      results = results.filter((r) => r.subject_id !== firstResult.subject_id);
    }
  }

  if (results.length === 0) {
    return {
      content: [
        {
          type: "text",
          text: `No competency connections found for: "${params.competency_text}". Try broader terms.`,
        },
      ],
      structuredContent: { connections: [] },
    };
  }

  const lines: string[] = [
    `# Competency Connections`,
    `*Search: "${params.competency_text}"*`,
    `*Scope: ${scope} | Found: ${results.length} related competencies*`,
    "",
  ];

  const connections: unknown[] = [];

  for (const r of results) {
    lines.push(`- **${r.subject_id}** Grade ${r.grade} (\`${r.course_id}\`)`);
    lines.push(`  > ${r.content}`);
    lines.push("");

    connections.push({
      competency: r.content,
      course_id: r.course_id,
      subject_id: r.subject_id,
      grade: parseInt(r.grade),
    });
  }

  const { text } = truncateIfNeeded(lines.join("\n"), results.length);

  return {
    content: [{ type: "text", text }],
    structuredContent: {
      query: params.competency_text,
      scope,
      connections,
    },
  };
}
