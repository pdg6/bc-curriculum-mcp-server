/**
 * Core curriculum MCP tools: list_courses, get_course_curriculum
 */

import { getDb } from "../services/database.js";
import type {
  CourseRow,
  BigIdeaRow,
  CompetencyRow,
  ContentItemRow,
} from "../services/database.js";
import type {
  ListCoursesInput,
  GetCourseCurriculumInput,
} from "../schemas/tool-schemas.js";
import {
  formatCourseLine,
  formatCourseCurriculum,
  formatGrade,
  truncateIfNeeded,
} from "../services/formatters.js";

/** List all available courses, optionally filtered by subject and/or grade */
export function listCourses(params: ListCoursesInput): {
  content: Array<{ type: "text"; text: string }>;
  structuredContent: Record<string, unknown>;
} {
  const db = getDb();
  let sql = "SELECT * FROM courses WHERE 1=1";
  const bindings: unknown[] = [];

  if (params.subject) {
    sql += " AND subject_id = ?";
    bindings.push(params.subject);
  }
  if (params.grade !== undefined) {
    sql += " AND grade = ?";
    bindings.push(params.grade);
  }

  sql += " ORDER BY subject_id, grade, name";

  const courses = db.prepare(sql).all(...bindings) as CourseRow[];

  if (courses.length === 0) {
    const filters = [
      params.subject ? `subject=${params.subject}` : null,
      params.grade !== undefined ? `grade=${formatGrade(params.grade)}` : null,
    ]
      .filter(Boolean)
      .join(", ");
    return {
      content: [
        {
          type: "text",
          text: `No courses found${filters ? ` for ${filters}` : ""}. The database may not have been crawled yet. Use the crawler to populate data.`,
        },
      ],
      structuredContent: { total: 0, courses: [] },
    };
  }

  // Format as markdown
  const lines = [`# BC Curriculum Courses (${courses.length} found)`, ""];

  // Group by subject
  const bySubject: Record<string, CourseRow[]> = {};
  for (const course of courses) {
    if (!bySubject[course.subject_id]) bySubject[course.subject_id] = [];
    bySubject[course.subject_id].push(course);
  }

  for (const [subject, subjectCourses] of Object.entries(bySubject)) {
    lines.push(`## ${subject}`);
    for (const course of subjectCourses) {
      lines.push(formatCourseLine(course));
    }
    lines.push("");
  }

  const { text } = truncateIfNeeded(lines.join("\n"), courses.length);

  return {
    content: [{ type: "text", text }],
    structuredContent: {
      total: courses.length,
      courses: courses.map((c) => ({
        id: c.id,
        subject: c.subject_id,
        grade: c.grade,
        grade_label: formatGrade(c.grade),
        name: c.name,
        slug: c.slug,
        url: c.url,
      })),
    },
  };
}

/** Get the complete curriculum for a specific course or all courses at a subject+grade */
export function getCourseCurriculum(params: GetCourseCurriculumInput): {
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
    return {
      content: [
        {
          type: "text",
          text: `No courses found for ${params.subject} grade ${formatGrade(params.grade)}${params.course ? ` course "${params.course}"` : ""}. Use list_courses to see available courses.`,
        },
      ],
      structuredContent: { courses: [] },
    };
  }

  const allResults: string[] = [];
  const structuredCourses: unknown[] = [];

  for (const course of courses) {
    const bigIdeas = db
      .prepare("SELECT * FROM big_ideas WHERE course_id = ? ORDER BY sequence")
      .all(course.id) as BigIdeaRow[];

    const competencies = db
      .prepare(
        "SELECT * FROM curricular_competencies WHERE course_id = ? ORDER BY domain, sequence"
      )
      .all(course.id) as CompetencyRow[];

    const contentItems = db
      .prepare(
        "SELECT * FROM content_items WHERE course_id = ? ORDER BY sequence"
      )
      .all(course.id) as ContentItemRow[];

    allResults.push(
      formatCourseCurriculum(course, bigIdeas, competencies, contentItems)
    );

    structuredCourses.push({
      course: {
        id: course.id,
        subject: course.subject_id,
        grade: course.grade,
        grade_label: formatGrade(course.grade),
        name: course.name,
        url: course.url,
      },
      big_ideas: bigIdeas.map((bi) => ({
        text: bi.text,
        elaboration: bi.elaboration,
      })),
      curricular_competencies: competencies.map((cc) => ({
        domain: cc.domain,
        subdomain: cc.subdomain,
        text: cc.text,
        elaboration: cc.elaboration,
      })),
      content_items: contentItems.map((ci) => ({
        text: ci.text,
        elaboration: ci.elaboration,
        examples: ci.examples,
        source_course: ci.source_course,
      })),
    });
  }

  const fullText = allResults.join("\n\n---\n\n");
  const { text } = truncateIfNeeded(fullText, courses.length);

  return {
    content: [{ type: "text", text }],
    structuredContent: { courses: structuredCourses },
  };
}
