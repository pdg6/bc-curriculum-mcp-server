/**
 * Cross-curricular search tool.
 *
 * Finds curriculum elements that overlap between two or more subjects
 * at the same grade level. Uses FTS to identify shared language, then
 * groups results by the concept that connects them.
 */

import { getDb } from "../services/database.js";
import type { FtsRow } from "../services/database.js";
import type { SearchCrossCurricularInput } from "../schemas/tool-schemas.js";
import { truncateIfNeeded, formatGrade } from "../services/formatters.js";

/** A single curriculum item with its source metadata */
interface CurriculumItem {
  text: string;
  source_type: string;
  course_id: string;
  subject_id: string;
  grade: number;
}

/** A connection between items from different subjects */
interface CrossCurricularConnection {
  shared_terms: string[];
  items: CurriculumItem[];
}

/**
 * Find cross-curricular connections between two or more subjects at a grade.
 *
 * Strategy:
 *   1. For each subject, load all curriculum items at the given grade.
 *   2. Extract significant terms (3+ chars, not stopwords) from each item.
 *   3. Build a term→items index across all subjects.
 *   4. Find terms that appear in items from 2+ different subjects.
 *   5. If a query is provided, pre-filter with FTS to only relevant items.
 */
export function searchCrossCurricular(params: SearchCrossCurricularInput): {
  content: Array<{ type: "text"; text: string }>;
  structuredContent: Record<string, unknown>;
} {
  const db = getDb();
  const focus = params.focus ?? "all";
  const limit = params.limit ?? 20;
  const gradeStr = String(params.grade);

  // Determine which source types to search
  const sourceTypes: string[] = [];
  if (focus === "all" || focus === "big_ideas") sourceTypes.push("big_idea");
  if (focus === "all" || focus === "competencies") sourceTypes.push("competency");
  if (focus === "all" || focus === "content") sourceTypes.push("content_item");

  // Load curriculum items for each subject at this grade
  const allItems: CurriculumItem[] = [];

  if (params.query) {
    // Query-filtered mode: use FTS to find relevant items
    const ftsQuery = params.query.includes('"') || params.query.includes("OR")
      ? params.query
      : params.query.split(/\s+/).filter((w) => w.length > 2).join(" OR ");

    if (!ftsQuery) {
      return {
        content: [{ type: "text", text: "Query too short. Provide longer search terms." }],
        structuredContent: { connections: [] },
      };
    }

    for (const subject of params.subjects) {
      for (const sType of sourceTypes) {
        try {
          const rows = db
            .prepare(
              `SELECT content, source_type, source_id, course_id, subject_id, grade, rank
               FROM curriculum_fts
               WHERE curriculum_fts MATCH ?
                 AND subject_id = ?
                 AND grade = ?
                 AND source_type = ?
               ORDER BY rank
               LIMIT 50`
            )
            .all(ftsQuery, subject, gradeStr, sType) as FtsRow[];

          for (const row of rows) {
            allItems.push({
              text: row.content,
              source_type: row.source_type,
              course_id: row.course_id,
              subject_id: row.subject_id,
              grade: parseInt(row.grade),
            });
          }
        } catch {
          // FTS query syntax error — skip this combination
        }
      }
    }
  } else {
    // Full-scan mode: load all items for these subjects at this grade
    for (const subject of params.subjects) {
      for (const sType of sourceTypes) {
        const rows = db
          .prepare(
            `SELECT content, source_type, course_id, subject_id, grade
             FROM curriculum_fts
             WHERE subject_id = ?
               AND grade = ?
               AND source_type = ?
             LIMIT 200`
          )
          .all(subject, gradeStr, sType) as Array<{
            content: string;
            source_type: string;
            course_id: string;
            subject_id: string;
            grade: string;
          }>;

        for (const row of rows) {
          allItems.push({
            text: row.content,
            source_type: row.source_type,
            course_id: row.course_id,
            subject_id: row.subject_id,
            grade: parseInt(row.grade),
          });
        }
      }
    }
  }

  if (allItems.length === 0) {
    return {
      content: [
        {
          type: "text",
          text: `No curriculum items found for ${params.subjects.join(", ")} at grade ${formatGrade(params.grade)}.`,
        },
      ],
      structuredContent: { connections: [] },
    };
  }

  // Build term→items index
  const termIndex = new Map<string, Set<number>>(); // term → set of item indices
  const itemSubjects = allItems.map((item) => item.subject_id);

  for (let i = 0; i < allItems.length; i++) {
    const terms = extractSignificantTerms(allItems[i].text);
    for (const term of terms) {
      if (!termIndex.has(term)) termIndex.set(term, new Set());
      termIndex.get(term)!.add(i);
    }
  }

  // Find terms shared across 2+ subjects
  const connections: CrossCurricularConnection[] = [];
  const usedItems = new Set<number>();

  // Score terms by how many distinct subjects they connect
  const termScores: Array<{ term: string; subjectCount: number; itemIndices: Set<number> }> = [];

  for (const [term, indices] of termIndex) {
    const subjects = new Set<string>();
    for (const idx of indices) {
      subjects.add(itemSubjects[idx]);
    }
    if (subjects.size >= 2) {
      termScores.push({ term, subjectCount: subjects.size, itemIndices: indices });
    }
  }

  // Sort by: more subjects connected first, then by number of items
  termScores.sort((a, b) => {
    if (b.subjectCount !== a.subjectCount) return b.subjectCount - a.subjectCount;
    return b.itemIndices.size - a.itemIndices.size;
  });

  // Build connections, deduplicating items
  for (const scored of termScores) {
    if (connections.length >= limit) break;

    const connectionItems: CurriculumItem[] = [];
    const connectionTerms: string[] = [scored.term];

    for (const idx of scored.itemIndices) {
      if (!usedItems.has(idx)) {
        connectionItems.push(allItems[idx]);
        usedItems.add(idx);
      }
    }

    // Only include if we have items from 2+ subjects
    const subjectsInConnection = new Set(connectionItems.map((i) => i.subject_id));
    if (subjectsInConnection.size >= 2 && connectionItems.length >= 2) {
      connections.push({
        shared_terms: connectionTerms,
        items: connectionItems,
      });
    }
  }

  if (connections.length === 0) {
    return {
      content: [
        {
          type: "text",
          text: `No cross-curricular connections found between ${params.subjects.join(" and ")} at grade ${formatGrade(params.grade)}. Try broadening your search or using a different focus.`,
        },
      ],
      structuredContent: { connections: [] },
    };
  }

  // Format response
  const lines: string[] = [
    `# Cross-Curricular Connections: Grade ${formatGrade(params.grade)}`,
    `*Subjects: ${params.subjects.join(", ")}*`,
    params.query ? `*Filter: "${params.query}"*` : "",
    `*Found ${connections.length} connection(s)*`,
    "",
  ].filter(Boolean);

  const structuredConnections: unknown[] = [];

  for (let i = 0; i < connections.length; i++) {
    const conn = connections[i];
    lines.push(`## Connection ${i + 1}: "${conn.shared_terms.join(", ")}"`);
    lines.push("");

    const bySubject: Record<string, CurriculumItem[]> = {};
    for (const item of conn.items) {
      if (!bySubject[item.subject_id]) bySubject[item.subject_id] = [];
      bySubject[item.subject_id].push(item);
    }

    for (const [subject, items] of Object.entries(bySubject)) {
      lines.push(`**${subject}:**`);
      for (const item of items) {
        const typeLabel = item.source_type === "big_idea" ? "Big Idea" :
          item.source_type === "competency" ? "Competency" : "Content";
        lines.push(`- [${typeLabel}] ${item.text}`);
        lines.push(`  *Course: \`${item.course_id}\`*`);
      }
      lines.push("");
    }

    structuredConnections.push({
      shared_terms: conn.shared_terms,
      subjects: Object.keys(bySubject),
      items: conn.items.map((item) => ({
        text: item.text,
        source_type: item.source_type,
        course_id: item.course_id,
        subject_id: item.subject_id,
        grade: item.grade,
      })),
    });
  }

  const { text } = truncateIfNeeded(lines.join("\n"), connections.length);

  return {
    content: [{ type: "text", text }],
    structuredContent: {
      subjects: params.subjects,
      grade: params.grade,
      focus,
      query: params.query || null,
      total_connections: connections.length,
      connections: structuredConnections,
    },
  };
}

// ─── Helpers ────────────────────────────────────────────────────

/** Common English stopwords to exclude from term matching */
const STOPWORDS = new Set([
  "the", "and", "for", "are", "but", "not", "you", "all", "can", "had",
  "her", "was", "one", "our", "out", "has", "his", "how", "its", "may",
  "new", "now", "old", "see", "way", "who", "did", "get", "let", "say",
  "she", "too", "use", "that", "this", "with", "have", "from", "they",
  "been", "will", "each", "make", "like", "than", "them", "then", "what",
  "when", "some", "into", "over", "such", "also", "more", "most", "much",
  "very", "about", "after", "being", "between", "both", "could", "does",
  "during", "other", "their", "there", "these", "those", "through",
  "under", "where", "which", "while", "would", "including", "within",
  "without", "using", "related", "based",
]);

/**
 * Extract significant terms from a text for cross-curricular matching.
 * Returns normalized lowercase terms that are 4+ chars and not stopwords.
 */
function extractSignificantTerms(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !STOPWORDS.has(w))
    .filter((w, i, arr) => arr.indexOf(w) === i); // deduplicate
}
