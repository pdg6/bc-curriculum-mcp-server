#!/usr/bin/env node
/**
 * Quick database summary — run after a crawl to verify results.
 * Usage: node scripts/check-db.cjs
 */

const Database = require("better-sqlite3");
const path = require("path");

const dbPath = path.resolve(process.env.DB_PATH || "./bc-curriculum.sqlite");
const db = new Database(dbPath, { readonly: true });

console.log(`\nDatabase: ${dbPath}\n`);

// ── Overall counts ──
console.log("=== OVERALL COUNTS ===");
const tables = ["subjects", "courses", "big_ideas", "curricular_competencies", "content_items"];
for (const t of tables) {
  try {
    const { c } = db.prepare(`SELECT COUNT(*) as c FROM [${t}]`).get();
    console.log(`  ${t}: ${c}`);
  } catch {
    // table might not exist
  }
}

// ── Per-subject summary ──
console.log("\n=== PER-SUBJECT SUMMARY ===");
const subjects = db.prepare("SELECT DISTINCT subject_id FROM courses ORDER BY subject_id").all();
for (const { subject_id } of subjects) {
  const courseCount = db.prepare("SELECT COUNT(*) as c FROM courses WHERE subject_id = ?").get(subject_id).c;
  const biCount = db.prepare(`
    SELECT COUNT(*) as c FROM big_ideas
    WHERE course_id IN (SELECT id FROM courses WHERE subject_id = ?)
  `).get(subject_id).c;
  let compCount = 0;
  try {
    compCount = db.prepare(`
      SELECT COUNT(*) as c FROM curricular_competencies
      WHERE course_id IN (SELECT id FROM courses WHERE subject_id = ?)
    `).get(subject_id).c;
  } catch {
    // table might not exist
  }
  const contentCount = db.prepare(`
    SELECT COUNT(*) as c FROM content_items
    WHERE course_id IN (SELECT id FROM courses WHERE subject_id = ?)
  `).get(subject_id).c;

  console.log(`\n  ${subject_id}:`);
  console.log(`    Courses: ${courseCount} | Big Ideas: ${biCount} | Competencies: ${compCount} | Content: ${contentCount}`);

  // Show grades covered
  const grades = db.prepare("SELECT DISTINCT grade FROM courses WHERE subject_id = ? ORDER BY grade").all(subject_id);
  const gradeList = grades.map(g => g.grade === 0 ? "K" : g.grade).join(", ");
  console.log(`    Grades: ${gradeList}`);
}

// ── Courses with zero data ──
console.log("\n=== COURSES WITH ZERO CONTENT ===");

// Figure out which competencies table exists
let compTable = null;
try { db.prepare("SELECT 1 FROM curricular_competencies LIMIT 1").get(); compTable = "curricular_competencies"; } catch {}
if (!compTable) {
  try { db.prepare("SELECT 1 FROM competencies LIMIT 1").get(); compTable = "competencies"; } catch {}
}

const zeroQuery = compTable
  ? `SELECT c.id, c.name, c.grade, c.subject_id
     FROM courses c
     WHERE (SELECT COUNT(*) FROM big_ideas WHERE course_id = c.id) = 0
       AND (SELECT COUNT(*) FROM [${compTable}] WHERE course_id = c.id) = 0
       AND (SELECT COUNT(*) FROM content_items WHERE course_id = c.id) = 0
     ORDER BY c.subject_id, c.grade`
  : `SELECT c.id, c.name, c.grade, c.subject_id
     FROM courses c
     WHERE (SELECT COUNT(*) FROM big_ideas WHERE course_id = c.id) = 0
       AND (SELECT COUNT(*) FROM content_items WHERE course_id = c.id) = 0
     ORDER BY c.subject_id, c.grade`;

const zeroCourses = db.prepare(zeroQuery).all();

if (zeroCourses.length === 0) {
  console.log("  None! All courses have data.");
} else {
  console.log(`  ${zeroCourses.length} courses with no data:`);
  for (const c of zeroCourses) {
    const grade = c.grade === 0 ? "K" : c.grade;
    console.log(`    ${c.subject_id} G${grade}: ${c.name} (${c.id})`);
  }
}

// ── Sample data ──
console.log("\n=== SAMPLE DATA (first 3 courses with content) ===");
const sampleCourses = db.prepare(`
  SELECT c.id, c.name, c.subject_id, c.grade
  FROM courses c
  WHERE (SELECT COUNT(*) FROM big_ideas WHERE course_id = c.id) > 0
  LIMIT 3
`).all();

for (const c of sampleCourses) {
  const grade = c.grade === 0 ? "K" : c.grade;
  console.log(`\n  ${c.name} (${c.subject_id} G${grade}):`);

  const ideas = db.prepare("SELECT text, elaboration FROM big_ideas WHERE course_id = ? LIMIT 2").all(c.id);
  console.log("    Big Ideas:");
  for (const i of ideas) {
    console.log(`      - ${i.text.substring(0, 100)}`);
    if (i.elaboration) console.log(`        [elab: ${i.elaboration.substring(0, 80)}...]`);
  }

  if (compTable) {
    const comps = db.prepare(`SELECT domain, subdomain, text FROM [${compTable}] WHERE course_id = ? LIMIT 3`).all(c.id);
    console.log("    Competencies:");
    for (const co of comps) {
      console.log(`      - ${co.domain} > ${co.subdomain || "-"} > ${co.text.substring(0, 70)}`);
    }
  }

  const items = db.prepare("SELECT text, elaboration FROM content_items WHERE course_id = ? LIMIT 3").all(c.id);
  console.log("    Content:");
  for (const ci of items) {
    console.log(`      - ${ci.text.substring(0, 100)}`);
    if (ci.elaboration) console.log(`        [elab: ${ci.elaboration.substring(0, 80)}...]`);
  }
}

db.close();
console.log("\nDone.\n");
