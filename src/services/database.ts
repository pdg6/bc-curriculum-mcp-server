/**
 * SQLite database service for BC Curriculum data.
 *
 * Uses better-sqlite3 for synchronous, high-performance SQLite access.
 * All schema creation, migrations, and query helpers live here.
 *
 * Covers K-12: grade 0 = Kindergarten.
 */

import Database from "better-sqlite3";
import path from "node:path";
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";

let db: Database.Database | null = null;

/**
 * Get or create the database connection.
 *
 * DB path resolution order:
 *   1. DB_PATH env var (explicit override)
 *   2. ./bc-curriculum.sqlite in cwd (backward compatibility)
 *   3. ~/.bc-curriculum/bc-curriculum.sqlite (stable default)
 */
export function getDb(): Database.Database {
  if (db) return db;

  let dbPath = process.env.DB_PATH;
  if (!dbPath) {
    const cwdPath = path.join(process.cwd(), "bc-curriculum.sqlite");
    if (existsSync(cwdPath)) {
      dbPath = cwdPath;
    } else {
      const dataDir = path.join(homedir(), ".bc-curriculum");
      if (!existsSync(dataDir)) {
        mkdirSync(dataDir, { recursive: true });
      }
      dbPath = path.join(dataDir, "bc-curriculum.sqlite");
    }
  }

  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  initializeSchema(db);
  return db;
}

/** Close the database connection cleanly */
export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

/** Create all tables, views, and FTS indexes */
function initializeSchema(database: Database.Database): void {
  database.exec(`
    -- Subjects (top-level: ADST, Science, Math, etc.)
    CREATE TABLE IF NOT EXISTS subjects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      introduction TEXT,
      goal_and_rationale TEXT,
      crawled_at TEXT
    );

    -- Courses (specific courses within a subject+grade)
    -- For K-9, there's typically one "core" course per subject+grade.
    -- For 10-12, there are multiple courses per subject+grade.
    -- grade 0 = Kindergarten.
    CREATE TABLE IF NOT EXISTS courses (
      id TEXT PRIMARY KEY,
      subject_id TEXT NOT NULL REFERENCES subjects(id),
      grade INTEGER NOT NULL,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      url TEXT NOT NULL,
      crawled_at TEXT
    );

    -- Big Ideas (high-level conceptual understandings)
    CREATE TABLE IF NOT EXISTS big_ideas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      course_id TEXT NOT NULL REFERENCES courses(id),
      text TEXT NOT NULL,
      elaboration TEXT,
      sequence INTEGER
    );

    -- Curricular Competencies (what students can DO)
    CREATE TABLE IF NOT EXISTS curricular_competencies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      course_id TEXT NOT NULL REFERENCES courses(id),
      domain TEXT NOT NULL,
      subdomain TEXT,
      text TEXT NOT NULL,
      elaboration TEXT,
      sequence INTEGER
    );

    -- Content / KDU items (what students should KNOW)
    CREATE TABLE IF NOT EXISTS content_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      course_id TEXT NOT NULL REFERENCES courses(id),
      text TEXT NOT NULL,
      elaboration TEXT,
      examples TEXT,
      source_course TEXT,
      sequence INTEGER
    );

    -- Core Competencies (cross-cutting: Communication, Thinking, Personal/Social)
    CREATE TABLE IF NOT EXISTS core_competencies (
      id TEXT PRIMARY KEY,
      domain TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      profiles TEXT
    );

    -- Course <-> Core Competency mapping
    CREATE TABLE IF NOT EXISTS course_core_competency_links (
      course_id TEXT NOT NULL REFERENCES courses(id),
      core_competency_id TEXT NOT NULL REFERENCES core_competencies(id),
      PRIMARY KEY (course_id, core_competency_id)
    );

    -- Assessment resources and practices
    CREATE TABLE IF NOT EXISTS assessment_resources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subject_id TEXT REFERENCES subjects(id),
      grade INTEGER,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      resource_type TEXT,
      url TEXT,
      crawled_at TEXT
    );

    -- First Peoples Principles of Learning
    CREATE TABLE IF NOT EXISTS fppl_principles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      principle TEXT NOT NULL,
      description TEXT,
      connections TEXT
    );

    -- Instructional samples
    CREATE TABLE IF NOT EXISTS instructional_samples (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      course_id TEXT REFERENCES courses(id),
      subject_id TEXT REFERENCES subjects(id),
      grade INTEGER,
      title TEXT NOT NULL,
      description TEXT,
      content TEXT,
      url TEXT,
      crawled_at TEXT
    );

    -- Crawl metadata
    CREATE TABLE IF NOT EXISTS crawl_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT NOT NULL,
      status INTEGER,
      content_hash TEXT,
      crawled_at TEXT,
      error TEXT
    );

    -- ─── Change Tracking Tables ──────────────────────────────────

    -- Per-item text hashes — used for both progression tracking and diffing.
    -- One row per curriculum element per crawl. When a re-crawl happens,
    -- old rows for that course are replaced; the changelog captures what changed.
    CREATE TABLE IF NOT EXISTS content_hashes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      course_id TEXT NOT NULL REFERENCES courses(id),
      source_type TEXT NOT NULL,       -- 'big_idea', 'competency', 'content_item'
      source_id INTEGER NOT NULL,      -- PK in the source table
      text_hash TEXT NOT NULL,          -- SHA-256 of normalized text
      text_preview TEXT NOT NULL,       -- first 200 chars for quick display
      crawled_at TEXT NOT NULL
    );

    -- Course-level snapshots (rollup view of each crawl)
    CREATE TABLE IF NOT EXISTS curriculum_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      course_id TEXT NOT NULL REFERENCES courses(id),
      content_hash TEXT NOT NULL,       -- hash of entire course content
      big_idea_count INTEGER NOT NULL DEFAULT 0,
      competency_count INTEGER NOT NULL DEFAULT 0,
      content_item_count INTEGER NOT NULL DEFAULT 0,
      crawled_at TEXT NOT NULL
    );

    -- Section-level changelog (individual item diffs between crawls)
    CREATE TABLE IF NOT EXISTS curriculum_changelog (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      course_id TEXT NOT NULL REFERENCES courses(id),
      source_type TEXT NOT NULL,       -- 'big_idea', 'competency', 'content_item'
      change_type TEXT NOT NULL,       -- 'added', 'removed', 'modified'
      old_text TEXT,                    -- NULL for 'added'
      new_text TEXT,                    -- NULL for 'removed'
      old_hash TEXT,
      new_hash TEXT,
      detected_at TEXT NOT NULL
    );

    -- Indexes for common queries
    CREATE INDEX IF NOT EXISTS idx_courses_subject ON courses(subject_id);
    CREATE INDEX IF NOT EXISTS idx_courses_grade ON courses(grade);
    CREATE INDEX IF NOT EXISTS idx_courses_subject_grade ON courses(subject_id, grade);
    CREATE INDEX IF NOT EXISTS idx_big_ideas_course ON big_ideas(course_id);
    CREATE INDEX IF NOT EXISTS idx_competencies_course ON curricular_competencies(course_id);
    CREATE INDEX IF NOT EXISTS idx_competencies_domain ON curricular_competencies(domain);
    CREATE INDEX IF NOT EXISTS idx_content_items_course ON content_items(course_id);
    CREATE INDEX IF NOT EXISTS idx_assessment_subject ON assessment_resources(subject_id);
    CREATE INDEX IF NOT EXISTS idx_instructional_samples_subject ON instructional_samples(subject_id);
    CREATE INDEX IF NOT EXISTS idx_instructional_samples_course ON instructional_samples(course_id);
    CREATE INDEX IF NOT EXISTS idx_crawl_log_url ON crawl_log(url);

    -- Change tracking indexes
    CREATE INDEX IF NOT EXISTS idx_content_hashes_course ON content_hashes(course_id);
    CREATE INDEX IF NOT EXISTS idx_content_hashes_type ON content_hashes(source_type);
    CREATE INDEX IF NOT EXISTS idx_snapshots_course ON curriculum_snapshots(course_id);
    CREATE INDEX IF NOT EXISTS idx_snapshots_date ON curriculum_snapshots(crawled_at);
    CREATE INDEX IF NOT EXISTS idx_changelog_course ON curriculum_changelog(course_id);
    CREATE INDEX IF NOT EXISTS idx_changelog_date ON curriculum_changelog(detected_at);
    CREATE INDEX IF NOT EXISTS idx_changelog_type ON curriculum_changelog(change_type);
  `);

  // FTS5 virtual table — created separately because IF NOT EXISTS works differently
  const ftsExists = database
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='curriculum_fts'"
    )
    .get();

  if (!ftsExists) {
    database.exec(`
      CREATE VIRTUAL TABLE curriculum_fts USING fts5(
        content,
        source_type,
        source_id UNINDEXED,
        course_id UNINDEXED,
        subject_id UNINDEXED,
        grade UNINDEXED
      );
    `);
  }

  // Grade progression view
  database.exec(`
    CREATE VIEW IF NOT EXISTS grade_progressions AS
    SELECT
      c1.id AS current_course,
      c1.grade AS current_grade,
      c1.name AS current_name,
      c1.subject_id AS subject_id,
      c2.id AS previous_course,
      c2.grade AS previous_grade,
      c2.name AS previous_name,
      c3.id AS next_course,
      c3.grade AS next_grade,
      c3.name AS next_name
    FROM courses c1
    LEFT JOIN courses c2 ON c1.subject_id = c2.subject_id AND c2.grade = c1.grade - 1 AND c2.slug = c1.slug
    LEFT JOIN courses c3 ON c1.subject_id = c3.subject_id AND c3.grade = c1.grade + 1 AND c3.slug = c1.slug;
  `);
}

// ─── Row Types ─────────────────────────────────────────────────

export interface SubjectRow {
  id: string;
  name: string;
  slug: string;
  introduction: string | null;
  goal_and_rationale: string | null;
  crawled_at: string | null;
}

export interface CourseRow {
  id: string;
  subject_id: string;
  grade: number;
  name: string;
  slug: string;
  url: string;
  crawled_at: string | null;
}

export interface BigIdeaRow {
  id: number;
  course_id: string;
  text: string;
  elaboration: string | null;
  sequence: number | null;
}

export interface CompetencyRow {
  id: number;
  course_id: string;
  domain: string;
  subdomain: string | null;
  text: string;
  elaboration: string | null;
  sequence: number | null;
}

export interface ContentItemRow {
  id: number;
  course_id: string;
  text: string;
  elaboration: string | null;
  examples: string | null;
  source_course: string | null;
  sequence: number | null;
}

export interface CoreCompetencyRow {
  id: string;
  domain: string;
  name: string;
  description: string | null;
  profiles: string | null;
}

export interface AssessmentRow {
  id: number;
  subject_id: string | null;
  grade: number | null;
  title: string;
  content: string;
  resource_type: string | null;
  url: string | null;
  crawled_at: string | null;
}

export interface FpplRow {
  id: number;
  principle: string;
  description: string | null;
  connections: string | null;
}

export interface InstructionalSampleRow {
  id: number;
  course_id: string | null;
  subject_id: string | null;
  grade: number | null;
  title: string;
  description: string | null;
  content: string | null;
  url: string | null;
  crawled_at: string | null;
}

export interface FtsRow {
  content: string;
  source_type: string;
  source_id: string;
  course_id: string;
  subject_id: string;
  grade: string;
  rank: number;
}

export interface CrawlLogRow {
  id: number;
  url: string;
  status: number | null;
  content_hash: string | null;
  crawled_at: string | null;
  error: string | null;
}

export interface ContentHashRow {
  id: number;
  course_id: string;
  source_type: string;
  source_id: number;
  text_hash: string;
  text_preview: string;
  crawled_at: string;
}

export interface CurriculumSnapshotRow {
  id: number;
  course_id: string;
  content_hash: string;
  big_idea_count: number;
  competency_count: number;
  content_item_count: number;
  crawled_at: string;
}

export interface ChangelogRow {
  id: number;
  course_id: string;
  source_type: string;
  change_type: string;
  old_text: string | null;
  new_text: string | null;
  old_hash: string | null;
  new_hash: string | null;
  detected_at: string;
}

export interface GradeProgressionRow {
  current_course: string;
  current_grade: number;
  current_name: string;
  subject_id: string;
  previous_course: string | null;
  previous_grade: number | null;
  previous_name: string | null;
  next_course: string | null;
  next_grade: number | null;
  next_name: string | null;
}

// ─── Insert Helpers ───────────────────────────────────────────────

export function upsertSubject(
  database: Database.Database,
  subject: Omit<SubjectRow, "crawled_at">
): void {
  database
    .prepare(
      `INSERT INTO subjects (id, name, slug, introduction, goal_and_rationale, crawled_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         introduction = excluded.introduction,
         goal_and_rationale = excluded.goal_and_rationale,
         crawled_at = excluded.crawled_at`
    )
    .run(
      subject.id,
      subject.name,
      subject.slug,
      subject.introduction,
      subject.goal_and_rationale
    );
}

export function upsertCourse(
  database: Database.Database,
  course: Omit<CourseRow, "crawled_at">
): void {
  database
    .prepare(
      `INSERT INTO courses (id, subject_id, grade, name, slug, url, crawled_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         url = excluded.url,
         crawled_at = excluded.crawled_at`
    )
    .run(
      course.id,
      course.subject_id,
      course.grade,
      course.name,
      course.slug,
      course.url
    );
}

export function insertBigIdea(
  database: Database.Database,
  courseId: string,
  text: string,
  elaboration: string | null,
  sequence: number
): number {
  const result = database
    .prepare(
      "INSERT INTO big_ideas (course_id, text, elaboration, sequence) VALUES (?, ?, ?, ?)"
    )
    .run(courseId, text, elaboration, sequence);
  return Number(result.lastInsertRowid);
}

export function insertCompetency(
  database: Database.Database,
  courseId: string,
  domain: string,
  subdomain: string | null,
  text: string,
  elaboration: string | null,
  sequence: number
): number {
  const result = database
    .prepare(
      "INSERT INTO curricular_competencies (course_id, domain, subdomain, text, elaboration, sequence) VALUES (?, ?, ?, ?, ?, ?)"
    )
    .run(courseId, domain, subdomain, text, elaboration, sequence);
  return Number(result.lastInsertRowid);
}

export function insertContentItem(
  database: Database.Database,
  courseId: string,
  text: string,
  elaboration: string | null,
  examples: string | null,
  sourceCourse: string | null,
  sequence: number
): number {
  const result = database
    .prepare(
      "INSERT INTO content_items (course_id, text, elaboration, examples, source_course, sequence) VALUES (?, ?, ?, ?, ?, ?)"
    )
    .run(courseId, text, elaboration, examples, sourceCourse, sequence);
  return Number(result.lastInsertRowid);
}

export function insertFtsEntry(
  database: Database.Database,
  content: string,
  sourceType: string,
  sourceId: number | string,
  courseId: string,
  subjectId: string,
  grade: number
): void {
  database
    .prepare(
      "INSERT INTO curriculum_fts (content, source_type, source_id, course_id, subject_id, grade) VALUES (?, ?, ?, ?, ?, ?)"
    )
    .run(content, sourceType, String(sourceId), courseId, subjectId, String(grade));
}

export function insertCoreCompetency(
  database: Database.Database,
  id: string,
  domain: string,
  name: string,
  description: string | null,
  profiles: string | null
): void {
  database
    .prepare(
      `INSERT INTO core_competencies (id, domain, name, description, profiles)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         description = excluded.description,
         profiles = excluded.profiles`
    )
    .run(id, domain, name, description, profiles);
}

export function insertFpplPrinciple(
  database: Database.Database,
  principle: string,
  description: string | null,
  connections: string | null
): number {
  const result = database
    .prepare(
      "INSERT INTO fppl_principles (principle, description, connections) VALUES (?, ?, ?)"
    )
    .run(principle, description, connections);
  return Number(result.lastInsertRowid);
}

export function insertAssessmentResource(
  database: Database.Database,
  subjectId: string | null,
  grade: number | null,
  title: string,
  content: string,
  resourceType: string | null,
  url: string | null
): number {
  const result = database
    .prepare(
      `INSERT INTO assessment_resources (subject_id, grade, title, content, resource_type, url, crawled_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`
    )
    .run(subjectId, grade, title, content, resourceType, url);
  return Number(result.lastInsertRowid);
}

export function insertInstructionalSample(
  database: Database.Database,
  courseId: string | null,
  subjectId: string | null,
  grade: number | null,
  title: string,
  description: string | null,
  content: string | null,
  url: string | null
): number {
  const result = database
    .prepare(
      `INSERT INTO instructional_samples (course_id, subject_id, grade, title, description, content, url, crawled_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`
    )
    .run(courseId, subjectId, grade, title, description, content, url);
  return Number(result.lastInsertRowid);
}

// ─── Change Tracking Helpers ─────────────────────────────────────

/**
 * Snapshot all current content hashes for a course BEFORE clearing its data.
 * Returns the old hashes so the caller can diff against the new crawl.
 */
export function snapshotCourseHashes(
  database: Database.Database,
  courseId: string
): ContentHashRow[] {
  return database
    .prepare("SELECT * FROM content_hashes WHERE course_id = ?")
    .all(courseId) as ContentHashRow[];
}

/**
 * Insert a content hash row for a newly crawled item.
 */
export function insertContentHash(
  database: Database.Database,
  courseId: string,
  sourceType: string,
  sourceId: number,
  textHash: string,
  textPreview: string
): void {
  database
    .prepare(
      `INSERT INTO content_hashes (course_id, source_type, source_id, text_hash, text_preview, crawled_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))`
    )
    .run(courseId, sourceType, sourceId, textHash, textPreview);
}

/**
 * Clear content hashes for a course (called during re-crawl, after snapshotting).
 */
export function clearContentHashes(
  database: Database.Database,
  courseId: string
): void {
  database
    .prepare("DELETE FROM content_hashes WHERE course_id = ?")
    .run(courseId);
}

/**
 * Insert a course-level snapshot after a crawl.
 */
export function insertSnapshot(
  database: Database.Database,
  courseId: string,
  contentHash: string,
  bigIdeaCount: number,
  competencyCount: number,
  contentItemCount: number
): void {
  database
    .prepare(
      `INSERT INTO curriculum_snapshots (course_id, content_hash, big_idea_count, competency_count, content_item_count, crawled_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))`
    )
    .run(courseId, contentHash, bigIdeaCount, competencyCount, contentItemCount);
}

/**
 * Insert a changelog entry for a detected change.
 */
export function insertChangelogEntry(
  database: Database.Database,
  courseId: string,
  sourceType: string,
  changeType: string,
  oldText: string | null,
  newText: string | null,
  oldHash: string | null,
  newHash: string | null
): void {
  database
    .prepare(
      `INSERT INTO curriculum_changelog (course_id, source_type, change_type, old_text, new_text, old_hash, new_hash, detected_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`
    )
    .run(courseId, sourceType, changeType, oldText, newText, oldHash, newHash);
}

/**
 * Clear all curriculum data for a course.
 *
 * Wrapped in a transaction for atomicity — safe to call standalone or
 * within an outer transaction (better-sqlite3 uses SAVEPOINTs for nesting).
 */
export function clearCourseData(
  database: Database.Database,
  courseId: string
): void {
  const clear = database.transaction(() => {
    database.prepare("DELETE FROM big_ideas WHERE course_id = ?").run(courseId);
    database
      .prepare("DELETE FROM curricular_competencies WHERE course_id = ?")
      .run(courseId);
    database
      .prepare("DELETE FROM content_items WHERE course_id = ?")
      .run(courseId);
    database
      .prepare("DELETE FROM curriculum_fts WHERE course_id = ?")
      .run(courseId);
  });
  clear();
}

export function clearReferenceData(database: Database.Database): void {
  database.prepare("DELETE FROM core_competencies").run();
  database.prepare("DELETE FROM fppl_principles").run();
  database.prepare("DELETE FROM assessment_resources").run();
  database.prepare("DELETE FROM instructional_samples").run();
}

export function logCrawl(
  database: Database.Database,
  url: string,
  status: number | null,
  contentHash: string | null,
  error: string | null
): void {
  database
    .prepare(
      "INSERT INTO crawl_log (url, status, content_hash, crawled_at, error) VALUES (?, ?, ?, datetime('now'), ?)"
    )
    .run(url, status, contentHash, error);
}
