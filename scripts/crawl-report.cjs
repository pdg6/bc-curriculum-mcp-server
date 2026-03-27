#!/usr/bin/env node
/**
 * Post-crawl change report generator.
 *
 * Queries the curriculum_changelog and curriculum_snapshots tables to produce
 * a human-readable summary of what changed since the last crawl. Designed to
 * run immediately after a crawl completes.
 *
 * Usage:
 *   node scripts/crawl-report.cjs [--since YYYY-MM-DD] [--db path/to/db]
 *
 * Defaults:
 *   --since  today (shows changes detected in the current crawl run)
 *   --db     ./bc-curriculum.sqlite
 */

const Database = require("better-sqlite3");
const path = require("node:path");

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    since: new Date().toISOString().substring(0, 10), // today
    db: process.env.DB_PATH || path.join(process.cwd(), "bc-curriculum.sqlite"),
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--since" && args[i + 1]) {
      opts.since = args[++i];
    } else if (args[i] === "--db" && args[i + 1]) {
      opts.db = args[++i];
    }
  }
  return opts;
}

function formatGrade(g) {
  return g === 0 ? "K" : String(g);
}

function main() {
  const opts = parseArgs();
  let db;

  try {
    db = new Database(opts.db, { readonly: true });
  } catch (err) {
    console.error(`❌ Cannot open database at ${opts.db}: ${err.message}`);
    process.exit(1);
  }

  // --- Crawl metadata ---
  const crawlLog = db
    .prepare(
      `SELECT COUNT(*) as pages,
              SUM(CASE WHEN status_code = 200 THEN 1 ELSE 0 END) as ok,
              SUM(CASE WHEN status_code != 200 OR status_code IS NULL THEN 1 ELSE 0 END) as failed,
              MIN(crawled_at) as started,
              MAX(crawled_at) as finished
       FROM crawl_log WHERE crawled_at >= ?`
    )
    .get(opts.since);

  const courseCount = db
    .prepare("SELECT COUNT(*) as n FROM courses")
    .get();

  const subjectCount = db
    .prepare("SELECT COUNT(*) as n FROM subjects")
    .get();

  console.log("═══════════════════════════════════════════════════════");
  console.log("  BC CURRICULUM MCP — CRAWL REPORT");
  console.log("═══════════════════════════════════════════════════════");
  console.log();

  if (crawlLog && crawlLog.pages > 0) {
    console.log(`📅 Crawl date:    ${opts.since}`);
    console.log(`📄 Pages visited: ${crawlLog.pages} (${crawlLog.ok} OK, ${crawlLog.failed} failed)`);
    console.log(`📚 Subjects:      ${subjectCount.n}`);
    console.log(`📖 Courses:       ${courseCount.n}`);
    console.log(`⏱️  Started:       ${crawlLog.started || "N/A"}`);
    console.log(`⏱️  Finished:      ${crawlLog.finished || "N/A"}`);
  } else {
    console.log(`📅 Report date: ${opts.since}`);
    console.log(`📚 Subjects: ${subjectCount.n} | 📖 Courses: ${courseCount.n}`);
    console.log("⚠️  No crawl_log entries found for today (the table may not exist in older DBs).");
  }
  console.log();

  // --- Changelog ---
  const changes = db
    .prepare(
      `SELECT cl.*, c.name AS course_name, c.subject_id, c.grade
       FROM curriculum_changelog cl
       JOIN courses c ON cl.course_id = c.id
       WHERE cl.detected_at >= ?
       ORDER BY cl.detected_at DESC`
    )
    .all(opts.since);

  if (changes.length === 0) {
    console.log("✅ No curriculum changes detected.");
    console.log("   (This is expected on first crawl or if BC has not updated the curriculum.)");
    console.log();
    db.close();
    return;
  }

  // Group by course
  const byCourse = {};
  for (const row of changes) {
    if (!byCourse[row.course_id]) byCourse[row.course_id] = [];
    byCourse[row.course_id].push(row);
  }

  const added = changes.filter((c) => c.change_type === "added").length;
  const removed = changes.filter((c) => c.change_type === "removed").length;
  const modified = changes.filter((c) => c.change_type === "modified").length;

  console.log("───────────────────────────────────────────────────────");
  console.log("  CHANGES DETECTED");
  console.log("───────────────────────────────────────────────────────");
  console.log();
  console.log(`Total: ${changes.length} change(s) across ${Object.keys(byCourse).length} course(s)`);
  console.log(`  + ${added} added | ~ ${modified} modified | − ${removed} removed`);
  console.log();

  // Course-level summary
  console.log("By course:");
  for (const [courseId, courseChanges] of Object.entries(byCourse)) {
    const first = courseChanges[0];
    const a = courseChanges.filter((c) => c.change_type === "added").length;
    const r = courseChanges.filter((c) => c.change_type === "removed").length;
    const m = courseChanges.filter((c) => c.change_type === "modified").length;

    const parts = [];
    if (a > 0) parts.push(`+${a}`);
    if (m > 0) parts.push(`~${m}`);
    if (r > 0) parts.push(`-${r}`);

    console.log(
      `  • ${first.course_name} (Gr ${formatGrade(first.grade)}, ${first.subject_id}): ${parts.join(", ")}`
    );
  }
  console.log();

  // Detailed changes (capped at 50 for readability)
  const detailCap = 50;
  const showChanges = changes.slice(0, detailCap);

  console.log("Details (most recent first):");
  for (const change of showChanges) {
    const typeLabel =
      change.source_type === "big_idea"
        ? "Big Idea"
        : change.source_type === "competency"
        ? "Competency"
        : "Content";

    if (change.change_type === "added") {
      console.log(`  [+] ${change.course_name} Gr ${formatGrade(change.grade)} — Added ${typeLabel}:`);
      console.log(`      "${change.new_text}"`);
    } else if (change.change_type === "removed") {
      console.log(`  [−] ${change.course_name} Gr ${formatGrade(change.grade)} — Removed ${typeLabel}:`);
      console.log(`      "${change.old_text}"`);
    } else {
      console.log(`  [~] ${change.course_name} Gr ${formatGrade(change.grade)} — Modified ${typeLabel}:`);
      console.log(`      Was: "${change.old_text}"`);
      console.log(`      Now: "${change.new_text}"`);
    }
    console.log();
  }

  if (changes.length > detailCap) {
    console.log(`  ... and ${changes.length - detailCap} more changes (use bc_get_curriculum_changes tool for full list)`);
  }

  console.log("═══════════════════════════════════════════════════════");
  console.log("  END OF REPORT");
  console.log("═══════════════════════════════════════════════════════");

  db.close();
}

main();
