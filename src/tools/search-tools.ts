/**
 * Full-text search tool using SQLite FTS5.
 */

import { getDb } from "../services/database.js";
import type { FtsRow } from "../services/database.js";
import type { SearchCurriculumInput } from "../schemas/tool-schemas.js";
import { truncateIfNeeded, formatGrade } from "../services/formatters.js";

/** Search BC curriculum using FTS5 full-text search */
export function searchCurriculum(params: SearchCurriculumInput): {
  content: Array<{ type: "text"; text: string }>;
  structuredContent: Record<string, unknown>;
} {
  const db = getDb();

  // Build the FTS5 query
  // FTS5 supports simple quoted phrases and boolean operators
  // We wrap the query in quotes for phrase matching, or pass through for advanced queries
  const ftsQuery = params.query.includes('"') || params.query.includes("OR") || params.query.includes("AND")
    ? params.query
    : `"${params.query}"`;

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
  `;
  const bindings: unknown[] = [ftsQuery];

  // Apply filters
  if (params.subject) {
    sql += " AND subject_id = ?";
    bindings.push(params.subject);
  }
  if (params.grade !== undefined) {
    sql += " AND grade = ?";
    bindings.push(String(params.grade));
  }
  if (params.content_type && params.content_type !== "all") {
    sql += " AND source_type = ?";
    bindings.push(params.content_type);
  }

  sql += " ORDER BY rank LIMIT ?";
  bindings.push(params.limit ?? 10);

  let results: FtsRow[];
  try {
    results = db.prepare(sql).all(...bindings) as FtsRow[];
  } catch {
    // If the quoted query fails, try without quotes (individual terms)
    const fallbackSql = sql.replace("MATCH ?", "MATCH ?");
    const fallbackBindings = [...bindings];
    fallbackBindings[0] = params.query
      .split(/\s+/)
      .filter((w) => w.length > 1)
      .join(" OR ");

    if (!fallbackBindings[0]) {
      return {
        content: [
          {
            type: "text",
            text: `No results found for "${params.query}". Try different search terms.`,
          },
        ],
        structuredContent: { total: 0, results: [] },
      };
    }

    try {
      results = db.prepare(fallbackSql).all(...fallbackBindings) as FtsRow[];
    } catch {
      return {
        content: [
          {
            type: "text",
            text: `Search error for "${params.query}". Try simpler search terms without special characters.`,
          },
        ],
        structuredContent: { total: 0, results: [] },
      };
    }
  }

  if (results.length === 0) {
    // Try a looser search with individual terms
    const terms = params.query
      .split(/\s+/)
      .filter((w) => w.length > 2)
      .join(" OR ");

    if (terms) {
      const looseSql = sql;
      const looseBindings = [...bindings];
      looseBindings[0] = terms;

      try {
        results = db.prepare(looseSql).all(...looseBindings) as FtsRow[];
      } catch {
        // Give up
      }
    }

    if (results.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: `No results found for "${params.query}". Try broader search terms or check that data has been crawled.`,
          },
        ],
        structuredContent: { total: 0, results: [] },
      };
    }
  }

  // Format results
  const lines: string[] = [
    `# Search Results for "${params.query}" (${results.length} found)`,
    "",
  ];

  const structuredResults: unknown[] = [];

  for (const row of results) {
    const typeLabel = formatSourceType(row.source_type);
    lines.push(`### ${typeLabel} — Grade ${formatGrade(parseInt(row.grade))}, ${row.subject_id}`);
    lines.push(`> ${row.content}`);
    lines.push(`*Course: \`${row.course_id}\` | Type: ${row.source_type}*`);
    lines.push("");

    structuredResults.push({
      content: row.content,
      source_type: row.source_type,
      source_id: row.source_id,
      course_id: row.course_id,
      subject_id: row.subject_id,
      grade: parseInt(row.grade),
      relevance_rank: row.rank,
    });
  }

  const { text } = truncateIfNeeded(lines.join("\n"), results.length);

  return {
    content: [{ type: "text", text }],
    structuredContent: {
      total: results.length,
      query: params.query,
      results: structuredResults,
    },
  };
}

function formatSourceType(type: string): string {
  switch (type) {
    case "big_idea":
      return "Big Idea";
    case "competency":
      return "Curricular Competency";
    case "content_item":
      return "Content (KDU)";
    case "assessment":
      return "Assessment Resource";
    default:
      return type;
  }
}
