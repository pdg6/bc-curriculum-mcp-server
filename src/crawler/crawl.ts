/**
 * Playwright-based crawler for curriculum.gov.bc.ca
 *
 * Crawls the BC Ministry of Education curriculum site, extracts structured
 * curriculum data (Big Ideas, Curricular Competencies, Content/KDU), and
 * stores it in the SQLite database.
 *
 * Covers K-12:
 * - K-9: single "core" course per subject+grade at /curriculum/{subject}/{grade}/core
 * - 10-12: multiple courses per subject+grade, discovered dynamically
 * - Reference pages: Core Competencies, FPPL, Assessment, Instructional Samples
 *
 * The site is JavaScript-rendered, so we use Playwright with Chromium
 * to get the fully rendered DOM before extraction.
 */

import { chromium, type Browser, type Page } from "playwright";
import { createHash } from "node:crypto";
import {
  getDb,
  upsertSubject,
  upsertCourse,
  insertBigIdea,
  insertCompetency,
  insertContentItem,
  insertFtsEntry,
  insertCoreCompetency,
  insertFpplPrinciple,
  insertAssessmentResource,
  insertInstructionalSample,
  clearCourseData,
  clearReferenceData,
  logCrawl,
  snapshotCourseHashes,
  insertContentHash,
  clearContentHashes,
  insertSnapshot,
  insertChangelogEntry,
  type ContentHashRow,
} from "../services/database.js";
import {
  BC_CURRICULUM_BASE_URL,
  SUBJECT_SLUGS,
  ADST_COURSE_MAP,
  CAREER_EDUCATION_COURSES,
  LANGUAGES_GRADE_MIN,
  LANGUAGES_COURSES,
  CORE_ONLY_GRADES_MAX,
  CORE_COMPETENCY_PATHS,
  REFERENCE_PAGES,
  gradeToSlug,
} from "../constants.js";
import {
  extractCourseCurriculum,
  extractCourseLinks,
  extractIntroductionText,
  extractCoreCompetencies,
  extractFpplPrinciples,
  extractAssessmentResources,
  extractInstructionalSamples,
  type ParsedCoursePage,
} from "./parser.js";

// ─── Configuration ──────────────────────────────────────────────

/** Configuration for a crawl run */
export interface CrawlOptions {
  /** Which subjects to crawl. If empty, crawls all. */
  subjects: string[];
  /** Grade range. Defaults to K-12 (0-12). */
  gradeFrom: number;
  gradeTo: number;
  /** Whether to re-crawl pages that already exist in the database */
  force: boolean;
  /** Delay between page loads in ms (be polite to the server) */
  delayMs: number;
  /** Headless mode for the browser */
  headless: boolean;
  /** Whether to also crawl reference pages (core competencies, FPPL, etc.) */
  includeReferences: boolean;
}

const DEFAULT_OPTIONS: CrawlOptions = {
  subjects: [],
  gradeFrom: 0, // Kindergarten
  gradeTo: 12,
  force: false,
  delayMs: 1500,
  headless: true,
  includeReferences: true,
};

// ─── Helpers ────────────────────────────────────────────────────

/** Generate a content hash for change detection */
function contentHash(data: ParsedCoursePage): string {
  const serialized = JSON.stringify(data);
  return createHash("sha256").update(serialized).digest("hex").substring(0, 16);
}

/** Generate a hash for a single curriculum item's text (normalized) */
function itemHash(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim().toLowerCase();
  return createHash("sha256").update(normalized).digest("hex").substring(0, 16);
}

/** Truncate text to a preview length */
function textPreview(text: string, maxLen = 200): string {
  if (text.length <= maxLen) return text;
  return text.substring(0, maxLen) + "…";
}

/**
 * Diff old and new content hashes for a course, writing changelog entries.
 *
 * Strategy: build maps of hash -> text for old and new items (grouped by
 * source_type). Hashes present in new but not old = added. Present in old
 * but not new = removed. Same hash but different text = modified (rare but
 * possible if normalization changes).
 */
function diffAndWriteChangelog(
  db: ReturnType<typeof getDb>,
  courseId: string,
  oldHashes: ContentHashRow[],
  newHashes: Array<{ sourceType: string; textHash: string; text: string }>
): number {
  let changeCount = 0;

  // Group by source_type
  const types = new Set([
    ...oldHashes.map((h) => h.source_type),
    ...newHashes.map((h) => h.sourceType),
  ]);

  for (const sType of types) {
    const oldByHash = new Map<string, string>();
    for (const h of oldHashes.filter((h) => h.source_type === sType)) {
      oldByHash.set(h.text_hash, h.text_preview);
    }

    const newByHash = new Map<string, string>();
    for (const h of newHashes.filter((h) => h.sourceType === sType)) {
      newByHash.set(h.textHash, h.text);
    }

    // Added: in new but not in old
    for (const [hash, text] of newByHash) {
      if (!oldByHash.has(hash)) {
        insertChangelogEntry(db, courseId, sType, "added", null, text, null, hash);
        changeCount++;
      }
    }

    // Removed: in old but not in new
    for (const [hash, preview] of oldByHash) {
      if (!newByHash.has(hash)) {
        insertChangelogEntry(db, courseId, sType, "removed", preview, null, hash, null);
        changeCount++;
      }
    }
  }

  return changeCount;
}

/** Human-readable subject name from slug */
function subjectNameFromSlug(slug: string): string {
  const names: Record<string, string> = {
    adst: "Applied Design, Skills and Technologies",
    "arts-education": "Arts Education",
    "career-education": "Career Education",
    "english-language-arts": "English Language Arts",
    languages: "Languages",
    mathematics: "Mathematics",
    "physical-health-education": "Physical and Health Education",
    science: "Science",
    "social-studies": "Social Studies",
  };
  return names[slug] || slug;
}

/** Human-readable course name from slug */
function courseNameFromSlug(slug: string): string {
  return slug
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Human-readable grade label */
function gradeLabel(grade: number): string {
  return grade === 0 ? "K" : String(grade);
}

/** Wait a polite delay between requests */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Navigate to a URL with retry logic */
async function safeNavigate(
  page: Page,
  url: string,
  db: ReturnType<typeof getDb>,
  retries = 3
): Promise<boolean> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await page.goto(url, {
        waitUntil: "networkidle",
        timeout: 30_000,
      });
      // Wait for JS rendering
      await page.waitForTimeout(2000);
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(
        `  [attempt ${attempt}/${retries}] Failed to load ${url}: ${message}`
      );
      if (attempt === retries) {
        logCrawl(db, url, null, null, message);
        return false;
      }
      await delay(2000 * attempt);
    }
  }
  return false;
}

// ─── Course Page Crawling ───────────────────────────────────────

/**
 * Crawl a single course page and store results in the database.
 */
async function crawlCoursePage(
  page: Page,
  subjectId: string,
  grade: number,
  courseSlug: string,
  courseName: string,
  courseUrl: string,
  options: CrawlOptions
): Promise<void> {
  const courseId = `${subjectId}-${gradeLabel(grade).toLowerCase()}-${courseSlug}`;
  const db = getDb();

  // Check if already crawled (skip if not forcing)
  if (!options.force) {
    const existing = db
      .prepare("SELECT crawled_at FROM courses WHERE id = ?")
      .get(courseId) as { crawled_at: string | null } | undefined;
    if (existing?.crawled_at) {
      console.log(
        `  Skipping ${courseId} (already crawled at ${existing.crawled_at})`
      );
      return;
    }
  }

  console.log(`  Crawling: ${courseName} Grade ${gradeLabel(grade)} (${courseUrl})`);

  const success = await safeNavigate(page, courseUrl, db);
  if (!success) {
    console.error(`  FAILED: Could not load ${courseUrl}`);
    return;
  }

  // Extract curriculum data from the rendered page
  const data = await extractCourseCurriculum(page);
  const hash = contentHash(data);

  console.log(
    `    Found: ${data.bigIdeas.length} Big Ideas, ` +
      `${data.competencies.length} Competencies, ` +
      `${data.contentItems.length} Content Items`
  );

  // ── Change tracking: snapshot old hashes before clearing ──
  const oldHashes = snapshotCourseHashes(db, courseId);

  // Store in database (within a transaction for atomicity)
  const transaction = db.transaction(() => {
    // Upsert the course record
    upsertCourse(db, {
      id: courseId,
      subject_id: subjectId,
      grade,
      name: courseName,
      slug: courseSlug,
      url: courseUrl,
    });

    // Clear existing data for this course (idempotent re-crawl)
    clearCourseData(db, courseId);
    clearContentHashes(db, courseId);

    // Collect new hashes for diffing after insert
    const newHashes: Array<{ sourceType: string; textHash: string; text: string }> = [];

    // Insert Big Ideas
    for (const idea of data.bigIdeas) {
      const rowId = insertBigIdea(
        db,
        courseId,
        idea.text,
        idea.elaboration,
        idea.sequence
      );
      // Index both the main text and elaboration in FTS
      let ftsContent = idea.text;
      if (idea.elaboration) ftsContent += ` ${idea.elaboration}`;
      insertFtsEntry(db, ftsContent, "big_idea", rowId, courseId, subjectId, grade);

      // Track item hash
      const hash_ = itemHash(idea.text);
      insertContentHash(db, courseId, "big_idea", rowId, hash_, textPreview(idea.text));
      newHashes.push({ sourceType: "big_idea", textHash: hash_, text: idea.text });
    }

    // Insert Competencies
    for (const comp of data.competencies) {
      const rowId = insertCompetency(
        db,
        courseId,
        comp.domain,
        comp.subdomain,
        comp.text,
        comp.elaboration,
        comp.sequence
      );
      let ftsContent = comp.text;
      if (comp.elaboration) ftsContent += ` ${comp.elaboration}`;
      insertFtsEntry(
        db,
        ftsContent,
        "competency",
        rowId,
        courseId,
        subjectId,
        grade
      );

      // Track item hash
      const hash_ = itemHash(comp.text);
      insertContentHash(db, courseId, "competency", rowId, hash_, textPreview(comp.text));
      newHashes.push({ sourceType: "competency", textHash: hash_, text: comp.text });
    }

    // Insert Content Items
    for (const item of data.contentItems) {
      const rowId = insertContentItem(
        db,
        courseId,
        item.text,
        item.elaboration,
        item.examples,
        item.sourceCourse,
        item.sequence
      );
      let ftsContent = item.text;
      if (item.elaboration) ftsContent += ` ${item.elaboration}`;
      insertFtsEntry(
        db,
        ftsContent,
        "content_item",
        rowId,
        courseId,
        subjectId,
        grade
      );

      // Track item hash
      const hash_ = itemHash(item.text);
      insertContentHash(db, courseId, "content_item", rowId, hash_, textPreview(item.text));
      newHashes.push({ sourceType: "content_item", textHash: hash_, text: item.text });
    }

    // ── Change tracking: diff old vs new and write changelog ──
    if (oldHashes.length > 0) {
      const changeCount = diffAndWriteChangelog(db, courseId, oldHashes, newHashes);
      if (changeCount > 0) {
        console.log(`    Changes detected: ${changeCount} item(s) changed`);
      }
    }

    // Write course-level snapshot
    insertSnapshot(
      db,
      courseId,
      hash,
      data.bigIdeas.length,
      data.competencies.length,
      data.contentItems.length
    );

    // Log successful crawl
    logCrawl(db, courseUrl, 200, hash, null);
  });

  transaction();
}

// ─── Subject Crawling ───────────────────────────────────────────

/**
 * Crawl a subject's introduction and goals pages.
 */
async function crawlSubjectCore(
  page: Page,
  subjectSlug: string,
  options: CrawlOptions
): Promise<void> {
  const db = getDb();
  const subjectName = subjectNameFromSlug(subjectSlug);

  console.log(`\nCrawling subject: ${subjectName} (${subjectSlug})`);

  let introduction = "";
  let goalAndRationale = "";

  // Crawl introduction page
  const introUrl = `${BC_CURRICULUM_BASE_URL}/curriculum/${subjectSlug}/introduction`;
  if (await safeNavigate(page, introUrl, db)) {
    introduction = await extractIntroductionText(page);
    logCrawl(db, introUrl, 200, null, null);
    console.log(`  Introduction: ${introduction.length} chars`);
  }

  await delay(options.delayMs);

  // Crawl goal and rationale page
  const goalUrl = `${BC_CURRICULUM_BASE_URL}/curriculum/${subjectSlug}/goals-and-rationale`;
  if (await safeNavigate(page, goalUrl, db)) {
    goalAndRationale = await extractIntroductionText(page);
    logCrawl(db, goalUrl, 200, null, null);
    console.log(`  Goal/Rationale: ${goalAndRationale.length} chars`);
  } else {
    // Try alternate URL pattern
    const altGoalUrl = `${BC_CURRICULUM_BASE_URL}/curriculum/${subjectSlug}/core/goal-and-rationale`;
    if (await safeNavigate(page, altGoalUrl, db)) {
      goalAndRationale = await extractIntroductionText(page);
      logCrawl(db, altGoalUrl, 200, null, null);
      console.log(`  Goal/Rationale (alt): ${goalAndRationale.length} chars`);
    }
  }

  // Upsert subject
  upsertSubject(db, {
    id: subjectSlug,
    name: subjectName,
    slug: subjectSlug,
    introduction: introduction || null,
    goal_and_rationale: goalAndRationale || null,
  });
}

/**
 * Discover and crawl all courses for a subject across grades.
 *
 * K-9: Uses /curriculum/{subject}/{grade}/core (single course per grade)
 * 10-12: Discovers courses from the grade page, or uses known course maps
 */
async function crawlSubjectCourses(
  page: Page,
  subjectSlug: string,
  options: CrawlOptions
): Promise<void> {
  const db = getDb();

  for (let grade = options.gradeFrom; grade <= options.gradeTo; grade++) {
    console.log(`\n  Grade ${gradeLabel(grade)}:`);

    const gradeSlug = gradeToSlug(grade);

    // Languages starts at grade 5 — skip K-4
    if (subjectSlug === "languages" && grade < LANGUAGES_GRADE_MIN) {
      console.log(`    Skipping — Languages starts at grade ${LANGUAGES_GRADE_MIN}`);
      continue;
    }

    // Languages never uses /core — always discover from /courses page
    if (subjectSlug === "languages" && grade <= CORE_ONLY_GRADES_MAX) {
      const coursesUrl = `${BC_CURRICULUM_BASE_URL}/curriculum/${subjectSlug}/${gradeSlug}/courses`;
      if (await safeNavigate(page, coursesUrl, db)) {
        const courseLinks = await extractCourseLinks(page, BC_CURRICULUM_BASE_URL);
        if (courseLinks.length > 0) {
          console.log(`    Found ${courseLinks.length} language courses`);
          for (const link of courseLinks) {
            await crawlCoursePage(page, subjectSlug, grade, link.slug, link.name, link.url, options);
            await delay(options.delayMs);
          }
        } else {
          // Fallback: use known language slugs
          console.log(`    No links discovered — using known language list (${LANGUAGES_COURSES.length} languages)`);
          for (const langSlug of LANGUAGES_COURSES) {
            const courseUrl = `${BC_CURRICULUM_BASE_URL}/curriculum/${subjectSlug}/${gradeSlug}/${langSlug}`;
            const courseName = courseNameFromSlug(langSlug);
            await crawlCoursePage(page, subjectSlug, grade, langSlug, courseName, courseUrl, options);
            await delay(options.delayMs);
          }
        }
      }
    } else if (grade <= CORE_ONLY_GRADES_MAX) {
      // K-9: single core course (all subjects except Languages)
      const coreUrl = `${BC_CURRICULUM_BASE_URL}/curriculum/${subjectSlug}/${gradeSlug}/core`;
      const courseName = `${subjectNameFromSlug(subjectSlug)} ${gradeLabel(grade)}`;
      await crawlCoursePage(
        page,
        subjectSlug,
        grade,
        "core",
        courseName,
        coreUrl,
        options
      );
      await delay(options.delayMs);
    } else {
      // 10-12: multiple courses

      // Career Education 10-12 uses CLE and CLC with grade slug "all"
      // These span all senior grades, so we only crawl them once (at grade 10)
      if (subjectSlug === "career-education") {
        if (grade === 10) {
          console.log(`    Using known Career Education course map: CLE + CLC`);
          for (const [courseSlug, gradeSlugOverride] of Object.entries(CAREER_EDUCATION_COURSES)) {
            const courseUrl = `${BC_CURRICULUM_BASE_URL}/curriculum/${subjectSlug}/${gradeSlugOverride}/${courseSlug}`;
            const courseName = courseNameFromSlug(courseSlug);
            await crawlCoursePage(
              page,
              subjectSlug,
              grade,
              courseSlug,
              courseName,
              courseUrl,
              options
            );
            await delay(options.delayMs);
          }
        } else {
          console.log(`    Skipping — Career Education 10-12 courses crawled at grade 10`);
        }
      } else if (subjectSlug === "adst" && ADST_COURSE_MAP[grade]) {
        // For ADST, use the known course map (most comprehensive)
        const courses = ADST_COURSE_MAP[grade];
        console.log(`    Using known ADST course map: ${courses.length} courses`);
        for (const courseSlug of courses) {
          const courseUrl = `${BC_CURRICULUM_BASE_URL}/curriculum/${subjectSlug}/${gradeSlug}/${courseSlug}`;
          const courseName = courseNameFromSlug(courseSlug);
          await crawlCoursePage(
            page,
            subjectSlug,
            grade,
            courseSlug,
            courseName,
            courseUrl,
            options
          );
          await delay(options.delayMs);
        }
      } else {
        // For other subjects, discover courses from the grade's /courses page
        const gradeUrl = `${BC_CURRICULUM_BASE_URL}/curriculum/${subjectSlug}/${gradeSlug}/courses`;
        if (await safeNavigate(page, gradeUrl, db)) {
          const courseLinks = await extractCourseLinks(
            page,
            BC_CURRICULUM_BASE_URL
          );

          if (courseLinks.length === 0) {
            // Some subjects have a single "core" course even at 10-12
            console.log(
              `    No course links found — trying core page directly`
            );
            const coreUrl = `${BC_CURRICULUM_BASE_URL}/curriculum/${subjectSlug}/${gradeSlug}/core`;
            const courseName = `${subjectNameFromSlug(subjectSlug)} ${gradeLabel(grade)}`;
            await crawlCoursePage(
              page,
              subjectSlug,
              grade,
              "core",
              courseName,
              coreUrl,
              options
            );
          } else {
            console.log(`    Found ${courseLinks.length} courses`);
            for (const link of courseLinks) {
              await crawlCoursePage(
                page,
                subjectSlug,
                grade,
                link.slug,
                link.name,
                link.url,
                options
              );
              await delay(options.delayMs);
            }
          }
        } else {
          // If grade page fails, try core as fallback
          console.log(`    Grade page failed — trying core fallback`);
          const coreUrl = `${BC_CURRICULUM_BASE_URL}/curriculum/${subjectSlug}/${gradeSlug}/core`;
          const courseName = `${subjectNameFromSlug(subjectSlug)} ${gradeLabel(grade)}`;
          await crawlCoursePage(
            page,
            subjectSlug,
            grade,
            "core",
            courseName,
            coreUrl,
            options
          );
        }
      }
    }
  }
}

// ─── Reference Page Crawling ────────────────────────────────────

/**
 * Crawl the Core Competencies pages (Communication, Thinking, Personal/Social).
 */
async function crawlCoreCompetencies(
  page: Page,
  options: CrawlOptions
): Promise<void> {
  const db = getDb();
  console.log("\n=== Crawling Core Competencies ===");

  for (const [domain, path] of Object.entries(CORE_COMPETENCY_PATHS)) {
    const url = `${BC_CURRICULUM_BASE_URL}${path}`;
    console.log(`  ${domain}: ${url}`);

    if (await safeNavigate(page, url, db)) {
      const competencies = await extractCoreCompetencies(page, domain);
      console.log(`    Found ${competencies.length} sub-competencies`);

      for (const cc of competencies) {
        const id = `${domain.toLowerCase().replace(/\s+/g, "-")}-${cc.name.toLowerCase().replace(/\s+/g, "-")}`;
        insertCoreCompetency(
          db,
          id,
          cc.domain,
          cc.name,
          cc.description,
          cc.profiles.length > 0 ? JSON.stringify(cc.profiles) : null
        );
      }

      logCrawl(db, url, 200, null, null);
    }

    await delay(options.delayMs);
  }
}

/**
 * Crawl First Peoples Principles of Learning.
 */
async function crawlFppl(page: Page, options: CrawlOptions): Promise<void> {
  const db = getDb();
  console.log("\n=== Crawling First Peoples Principles of Learning ===");

  const url = `${BC_CURRICULUM_BASE_URL}${REFERENCE_PAGES.indigenousResources}`;
  console.log(`  URL: ${url}`);

  if (await safeNavigate(page, url, db)) {
    const principles = await extractFpplPrinciples(page);
    console.log(`  Found ${principles.length} principles`);

    for (const p of principles) {
      insertFpplPrinciple(db, p.principle, p.description, null);
    }

    logCrawl(db, url, 200, null, null);
  }
}

/**
 * Crawl classroom assessment resources.
 */
async function crawlAssessmentResources(
  page: Page,
  options: CrawlOptions
): Promise<void> {
  const db = getDb();
  console.log("\n=== Crawling Assessment Resources ===");

  const url = `${BC_CURRICULUM_BASE_URL}${REFERENCE_PAGES.classroomAssessment}`;
  console.log(`  URL: ${url}`);

  if (await safeNavigate(page, url, db)) {
    const resources = await extractAssessmentResources(page);
    console.log(`  Found ${resources.length} resources`);

    for (const r of resources) {
      insertAssessmentResource(
        db,
        null, // not subject-specific
        null, // not grade-specific
        r.title,
        r.content,
        r.resourceType,
        url
      );
    }

    logCrawl(db, url, 200, null, null);
  }
}

/**
 * Crawl instructional samples.
 */
async function crawlInstructionalSamples(
  page: Page,
  options: CrawlOptions
): Promise<void> {
  const db = getDb();
  console.log("\n=== Crawling Instructional Samples ===");

  const url = `${BC_CURRICULUM_BASE_URL}${REFERENCE_PAGES.instructionalSamples}`;
  console.log(`  URL: ${url}`);

  if (await safeNavigate(page, url, db)) {
    const samples = await extractInstructionalSamples(
      page,
      BC_CURRICULUM_BASE_URL
    );
    console.log(`  Found ${samples.length} samples`);

    for (const s of samples) {
      insertInstructionalSample(
        db,
        null, // course_id not known from listing page
        null, // subject_id not known from listing page
        null, // grade not known from listing page
        s.title,
        s.description,
        s.content,
        s.url
      );
    }

    logCrawl(db, url, 200, null, null);
  }
}

// ─── Main Entry Point ───────────────────────────────────────────

/**
 * Main crawl entry point.
 */
export async function runCrawl(
  partialOptions: Partial<CrawlOptions> = {}
): Promise<void> {
  const options: CrawlOptions = { ...DEFAULT_OPTIONS, ...partialOptions };
  const subjects =
    options.subjects.length > 0 ? options.subjects : [...SUBJECT_SLUGS];

  console.log("=== BC Curriculum Crawl ===");
  console.log(`Subjects: ${subjects.join(", ")}`);
  console.log(
    `Grades: ${gradeLabel(options.gradeFrom)}-${gradeLabel(options.gradeTo)}`
  );
  console.log(`Force re-crawl: ${options.force}`);
  console.log(`Include references: ${options.includeReferences}`);
  console.log(`Delay: ${options.delayMs}ms`);
  console.log("");

  // Ensure DB is initialized
  const db = getDb();

  // Clear reference data if force re-crawling
  if (options.force && options.includeReferences) {
    console.log("Clearing existing reference data...");
    clearReferenceData(db);
  }

  let browser: Browser | null = null;

  try {
    browser = await chromium.launch({
      headless: options.headless,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (compatible; BCCurriculumBot/1.0; +https://github.com/pdg6/bc-curriculum-mcp-server)",
    });
    const page = await context.newPage();

    // Phase 1: Crawl subject introductions and courses
    for (const subjectSlug of subjects) {
      await crawlSubjectCore(page, subjectSlug, options);
      await delay(options.delayMs);
      await crawlSubjectCourses(page, subjectSlug, options);
    }

    // Phase 2: Crawl reference pages
    if (options.includeReferences) {
      await crawlCoreCompetencies(page, options);
      await delay(options.delayMs);
      await crawlFppl(page, options);
      await delay(options.delayMs);
      await crawlAssessmentResources(page, options);
      await delay(options.delayMs);
      await crawlInstructionalSamples(page, options);
    }

    await context.close();
  } catch (err) {
    console.error("Crawl failed:", err);
    throw err;
  } finally {
    if (browser) await browser.close();
  }

  console.log("\n=== Crawl Complete ===");
}
