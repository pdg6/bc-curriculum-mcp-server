/**
 * Curriculum change tracking tools.
 *
 * Surfaces what changed between crawl runs — at both course-level (rollup)
 * and item-level (detail). Useful for teachers updating lesson plans and
 * for the orchestrator pipeline to know when to regenerate content.
 */

import { getDb } from "../services/database.js";
import type {
  ChangelogRow,
  CurriculumSnapshotRow,
  CourseRow,
} from "../services/database.js";
import type {
  GetCurriculumChangesInput,
  GetCourseHistoryInput,
} from "../schemas/tool-schemas.js";
import { truncateIfNeeded, formatGrade } from "../services/formatters.js";

/**
 * Get curriculum changes detected across crawl runs.
 *
 * Returns a course-level summary (which courses changed) with item-level
 * detail (which specific items were added, removed, or modified).
 */
export function getCurriculumChanges(params: GetCurriculumChangesInput): {
  content: Array<{ type: "text"; text: string }>;
  structuredContent: Record<string, unknown>;
} {
  const db = getDb();
  const limit = params.limit ?? 50;
  const changeType = params.change_type ?? "all";

  // Default "since" to 30 days ago
  const since = params.since || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().substring(0, 10);

  // Build query with optional filters
  let sql = `
    SELECT cl.*, c.name AS course_name, c.subject_id, c.grade
    FROM curriculum_changelog cl
    JOIN courses c ON cl.course_id = c.id
    WHERE cl.detected_at >= ?
  `;
  const bindings: unknown[] = [since];

  if (params.subject) {
    sql += " AND c.subject_id = ?";
    bindings.push(params.subject);
  }
  if (params.grade !== undefined) {
    sql += " AND c.grade = ?";
    bindings.push(params.grade);
  }
  if (changeType !== "all") {
    sql += " AND cl.change_type = ?";
    bindings.push(changeType);
  }

  sql += " ORDER BY cl.detected_at DESC LIMIT ?";
  bindings.push(limit);

  const rows = db.prepare(sql).all(...bindings) as Array<
    ChangelogRow & { course_name: string; subject_id: string; grade: number }
  >;

  if (rows.length === 0) {
    return {
      content: [
        {
          type: "text",
          text: `No curriculum changes detected since ${since}. This could mean the curriculum hasn't been updated, or that only one crawl has been run (changes require at least two crawl runs to detect).`,
        },
      ],
      structuredContent: { since, total: 0, changes: [] },
    };
  }

  // Group by course for the summary
  const byCourse: Record<string, typeof rows> = {};
  for (const row of rows) {
    if (!byCourse[row.course_id]) byCourse[row.course_id] = [];
    byCourse[row.course_id].push(row);
  }

  const lines: string[] = [
    `# Curriculum Changes Since ${since}`,
    `*${rows.length} change(s) across ${Object.keys(byCourse).length} course(s)*`,
    "",
  ];

  // Course-level rollup
  lines.push("## Summary");
  for (const [courseId, changes] of Object.entries(byCourse)) {
    const first = changes[0];
    const added = changes.filter((c) => c.change_type === "added").length;
    const removed = changes.filter((c) => c.change_type === "removed").length;
    const modified = changes.filter((c) => c.change_type === "modified").length;

    const parts: string[] = [];
    if (added > 0) parts.push(`${added} added`);
    if (removed > 0) parts.push(`${removed} removed`);
    if (modified > 0) parts.push(`${modified} modified`);

    lines.push(`- **${first.course_name}** (Grade ${formatGrade(first.grade)}, ${first.subject_id}): ${parts.join(", ")}`);
  }
  lines.push("");

  // Item-level detail
  lines.push("## Details");
  for (const [courseId, changes] of Object.entries(byCourse)) {
    const first = changes[0];
    lines.push(`\n### ${first.course_name} (Grade ${formatGrade(first.grade)})`);

    for (const change of changes) {
      const typeLabel = change.source_type === "big_idea" ? "Big Idea"
        : change.source_type === "competency" ? "Competency" : "Content";
      const icon = change.change_type === "added" ? "+" : change.change_type === "removed" ? "−" : "~";

      if (change.change_type === "added") {
        lines.push(`- **${icon} Added** [${typeLabel}]: ${change.new_text}`);
      } else if (change.change_type === "removed") {
        lines.push(`- **${icon} Removed** [${typeLabel}]: ${change.old_text}`);
      } else {
        lines.push(`- **${icon} Modified** [${typeLabel}]:`);
        lines.push(`  - Was: ${change.old_text}`);
        lines.push(`  - Now: ${change.new_text}`);
      }
    }
  }

  const structuredChanges = rows.map((row) => ({
    course_id: row.course_id,
    course_name: row.course_name,
    subject_id: row.subject_id,
    grade: row.grade,
    source_type: row.source_type,
    change_type: row.change_type,
    old_text: row.old_text,
    new_text: row.new_text,
    detected_at: row.detected_at,
  }));

  const { text } = truncateIfNeeded(lines.join("\n"), rows.length);

  return {
    content: [{ type: "text", text }],
    structuredContent: {
      since,
      total: rows.length,
      courses_affected: Object.keys(byCourse).length,
      changes: structuredChanges,
    },
  };
}

/**
 * Get the crawl history and change timeline for a specific course.
 *
 * Shows each snapshot (crawl run) with item counts, and any changes
 * detected at each run.
 */
export function getCourseHistory(params: GetCourseHistoryInput): {
  content: Array<{ type: "text"; text: string }>;
  structuredContent: Record<string, unknown>;
} {
  const db = getDb();

  // Find matching courses
  let courseSql = "SELECT * FROM courses WHERE subject_id = ? AND grade = ?";
  const courseBindings: unknown[] = [params.subject, params.grade];

  if (params.course) {
    courseSql += " AND slug = ?";
    courseBindings.push(params.course);
  }
  courseSql += " ORDER BY name";

  const courses = db.prepare(courseSql).all(...courseBindings) as CourseRow[];

  if (courses.length === 0) {
    const courseHint = params.course ? ` with slug '${params.course}'` : "";
    return {
      content: [
        {
          type: "text",
          text: `No courses found for ${params.subject} grade ${formatGrade(params.grade)}${courseHint}. Use list_courses to see available courses.`,
        },
      ],
      structuredContent: { courses: [] },
    };
  }

  const lines: string[] = [
    `# Course History: ${params.subject} Grade ${formatGrade(params.grade)}`,
    "",
  ];

  const structuredCourses: unknown[] = [];

  for (const course of courses) {
    lines.push(`## ${course.name} (\`${course.id}\`)`);
    lines.push(`*URL: ${course.url}*`);
    lines.push("");

    // Get snapshots (crawl runs) for this course
    const snapshots = db
      .prepare(
        "SELECT * FROM curriculum_snapshots WHERE course_id = ? ORDER BY crawled_at DESC LIMIT 20"
      )
      .all(course.id) as CurriculumSnapshotRow[];

    if (snapshots.length === 0) {
      lines.push("*No crawl history available. Run a crawl with `--force` to populate.*");
      lines.push("");
      structuredCourses.push({
        course_id: course.id,
        name: course.name,
        snapshots: [],
        changes: [],
      });
      continue;
    }

    lines.push("### Crawl History");
    for (const snap of snapshots) {
      const total = snap.big_idea_count + snap.competency_count + snap.content_item_count;
      lines.push(
        `- **${snap.crawled_at}** — ${total} items (${snap.big_idea_count} Big Ideas, ${snap.competency_count} Competencies, ${snap.content_item_count} Content) — hash: \`${snap.content_hash}\``
      );
    }
    lines.push("");

    // Get changelog entries for this course
    const changes = db
      .prepare(
        "SELECT * FROM curriculum_changelog WHERE course_id = ? ORDER BY detected_at DESC LIMIT 50"
      )
      .all(course.id) as ChangelogRow[];

    if (changes.length > 0) {
      lines.push("### Changes Detected");
      for (const change of changes) {
        const typeLabel = change.source_type === "big_idea" ? "Big Idea"
          : change.source_type === "competency" ? "Competency" : "Content";

        if (change.change_type === "added") {
          lines.push(`- **${change.detected_at}** [Added ${typeLabel}]: ${change.new_text}`);
        } else if (change.change_type === "removed") {
          lines.push(`- **${change.detected_at}** [Removed ${typeLabel}]: ${change.old_text}`);
        } else {
          lines.push(`- **${change.detected_at}** [Modified ${typeLabel}]:`);
          lines.push(`  - Was: ${change.old_text}`);
          lines.push(`  - Now: ${change.new_text}`);
        }
      }
    } else {
      lines.push("*No changes detected between crawl runs.*");
    }
    lines.push("");

    structuredCourses.push({
      course_id: course.id,
      name: course.name,
      snapshots: snapshots.map((s) => ({
        crawled_at: s.crawled_at,
        content_hash: s.content_hash,
        big_idea_count: s.big_idea_count,
        competency_count: s.competency_count,
        content_item_count: s.content_item_count,
      })),
      changes: changes.map((c) => ({
        detected_at: c.detected_at,
        source_type: c.source_type,
        change_type: c.change_type,
        old_text: c.old_text,
        new_text: c.new_text,
      })),
    });
  }

  const { text } = truncateIfNeeded(lines.join("\n"), courses.length);

  return {
    content: [{ type: "text", text }],
    structuredContent: {
      subject: params.subject,
      grade: params.grade,
      courses: structuredCourses,
    },
  };
}
