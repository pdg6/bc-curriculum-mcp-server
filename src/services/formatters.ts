/**
 * Shared formatting utilities for tool responses.
 *
 * All tools return markdown-formatted text for human readability,
 * plus structuredContent for programmatic access.
 */

import type {
  BigIdeaRow,
  CompetencyRow,
  ContentItemRow,
  CourseRow,
} from "./database.js";
import { CHARACTER_LIMIT } from "../constants.js";

/** Format grade number for display (0 = K) */
export function formatGrade(grade: number): string {
  return grade === 0 ? "K" : String(grade);
}

/** Truncate a response if it exceeds the character limit */
export function truncateIfNeeded(
  text: string,
  itemCount: number
): { text: string; truncated: boolean } {
  if (text.length <= CHARACTER_LIMIT) {
    return { text, truncated: false };
  }

  const truncated = text.substring(0, CHARACTER_LIMIT);
  const lastNewline = truncated.lastIndexOf("\n");
  const cleanTruncated =
    lastNewline > CHARACTER_LIMIT * 0.8
      ? truncated.substring(0, lastNewline)
      : truncated;

  return {
    text:
      cleanTruncated +
      `\n\n---\n*Response truncated (${itemCount} total items). Use filters to narrow results.*`,
    truncated: true,
  };
}

/** Format a course row as a compact summary line */
export function formatCourseLine(course: CourseRow): string {
  return `- **${course.name}** (Grade ${formatGrade(course.grade)}) — \`${course.id}\``;
}

/** Format the full three-column curriculum for a course, including elaborations */
export function formatCourseCurriculum(
  course: CourseRow,
  bigIdeas: BigIdeaRow[],
  competencies: CompetencyRow[],
  contentItems: ContentItemRow[]
): string {
  const lines: string[] = [];

  lines.push(`## ${course.name} — Grade ${formatGrade(course.grade)}`);
  lines.push(
    `*Subject: ${course.subject_id} | Course ID: \`${course.id}\`*`
  );
  lines.push(`*Source: ${course.url}*`);
  lines.push("");

  // Big Ideas
  lines.push("### Big Ideas");
  if (bigIdeas.length === 0) {
    lines.push("*No Big Ideas found for this course.*");
  } else {
    for (const idea of bigIdeas) {
      lines.push(`- ${idea.text}`);
      if (idea.elaboration) {
        lines.push(`  *Elaboration: ${idea.elaboration}*`);
      }
    }
  }
  lines.push("");

  // Curricular Competencies grouped by domain
  lines.push("### Curricular Competencies");
  if (competencies.length === 0) {
    lines.push("*No Curricular Competencies found for this course.*");
  } else {
    const byDomain = groupBy(competencies, (c) => c.domain);
    for (const [domain, comps] of Object.entries(byDomain)) {
      lines.push(`\n#### ${domain}`);
      for (const comp of comps) {
        lines.push(`- ${comp.text}`);
        if (comp.elaboration) {
          lines.push(`  *Elaboration: ${comp.elaboration}*`);
        }
      }
    }
  }
  lines.push("");

  // Content (KDU)
  lines.push("### Content (Know/Do/Understand)");
  if (contentItems.length === 0) {
    lines.push("*No Content items found for this course.*");
  } else {
    for (const item of contentItems) {
      let line = `- ${item.text}`;
      if (item.source_course) {
        line += ` *(${item.source_course})*`;
      }
      lines.push(line);
      if (item.elaboration) {
        lines.push(`  *Elaboration: ${item.elaboration}*`);
      }
    }
  }

  return lines.join("\n");
}

/** Group an array by a key function */
function groupBy<T>(
  arr: T[],
  keyFn: (item: T) => string
): Record<string, T[]> {
  const result: Record<string, T[]> = {};
  for (const item of arr) {
    const key = keyFn(item);
    if (!result[key]) result[key] = [];
    result[key].push(item);
  }
  return result;
}
