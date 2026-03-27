/**
 * Test data seeder — populates an in-memory SQLite database with
 * realistic BC curriculum data for integration testing.
 *
 * Covers two subjects (science, mathematics) across grades 0-2
 * with Big Ideas, Competencies, Content Items, FTS entries,
 * Core Competencies, FPPL, Assessment Resources, and Changelog data.
 */

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
  insertChangelogEntry,
  insertSnapshot,
  insertContentHash,
} from "../services/database.js";
import type Database from "better-sqlite3";

/** Seed the in-memory test database with known fixture data. */
export function seedTestDb(): Database.Database {
  const db = getDb(); // triggers schema initialization on first call

  // ─── Subjects ──────────────────────────────────────────────────
  upsertSubject(db, {
    id: "science",
    name: "Science",
    slug: "science",
    introduction: "Science K-12 curriculum",
    goal_and_rationale: "Scientific literacy for all students",
  });

  upsertSubject(db, {
    id: "mathematics",
    name: "Mathematics",
    slug: "mathematics",
    introduction: "Mathematics K-12 curriculum",
    goal_and_rationale: "Numeracy for all students",
  });

  upsertSubject(db, {
    id: "adst",
    name: "Applied Design, Skills, and Technologies",
    slug: "adst",
    introduction: "ADST K-12 curriculum",
    goal_and_rationale: "Applied skills for all students",
  });

  // ─── Courses ───────────────────────────────────────────────────
  const courses = [
    { id: "science-k", subject_id: "science", grade: 0, name: "Science K", slug: "core", url: "https://curriculum.gov.bc.ca/curriculum/science/k/core" },
    { id: "science-1", subject_id: "science", grade: 1, name: "Science 1", slug: "core", url: "https://curriculum.gov.bc.ca/curriculum/science/1/core" },
    { id: "science-2", subject_id: "science", grade: 2, name: "Science 2", slug: "core", url: "https://curriculum.gov.bc.ca/curriculum/science/2/core" },
    { id: "mathematics-k", subject_id: "mathematics", grade: 0, name: "Mathematics K", slug: "core", url: "https://curriculum.gov.bc.ca/curriculum/mathematics/k/core" },
    { id: "mathematics-1", subject_id: "mathematics", grade: 1, name: "Mathematics 1", slug: "core", url: "https://curriculum.gov.bc.ca/curriculum/mathematics/1/core" },
    { id: "mathematics-2", subject_id: "mathematics", grade: 2, name: "Mathematics 2", slug: "core", url: "https://curriculum.gov.bc.ca/curriculum/mathematics/2/core" },
    { id: "adst-k", subject_id: "adst", grade: 0, name: "ADST K", slug: "core", url: "https://curriculum.gov.bc.ca/curriculum/adst/k/core" },
  ];

  for (const c of courses) {
    upsertCourse(db, c);
  }

  // ─── Big Ideas ─────────────────────────────────────────────────
  const bigIdeasData = [
    { courseId: "science-k", text: "Plants and animals have observable features.", elaboration: "Students observe living things in their environment.", seq: 1 },
    { courseId: "science-k", text: "Daily and seasonal changes affect all living things.", elaboration: null, seq: 2 },
    { courseId: "science-1", text: "Living things have features and behaviours that help them survive.", elaboration: "Adaptation concepts at introductory level.", seq: 1 },
    { courseId: "science-2", text: "Living things have life cycles similar to and different from each other.", elaboration: "Life cycle comparison across species.", seq: 1 },
    { courseId: "mathematics-k", text: "Numbers represent quantity.", elaboration: "Counting and cardinality fundamentals.", seq: 1 },
    { courseId: "mathematics-1", text: "Numbers to 20 represent quantity.", elaboration: null, seq: 1 },
    { courseId: "mathematics-2", text: "Numbers to 100 represent quantity.", elaboration: "Place value concepts.", seq: 1 },
    { courseId: "adst-k", text: "Designs grow out of natural curiosity.", elaboration: "Curiosity-driven design process.", seq: 1 },
  ];

  const bigIdeaIds: Record<string, number[]> = {};
  for (const bi of bigIdeasData) {
    const id = insertBigIdea(db, bi.courseId, bi.text, bi.elaboration, bi.seq);
    if (!bigIdeaIds[bi.courseId]) bigIdeaIds[bi.courseId] = [];
    bigIdeaIds[bi.courseId].push(id);
  }

  // ─── Curricular Competencies ───────────────────────────────────
  const competenciesData = [
    { courseId: "science-k", domain: "Questioning and predicting", subdomain: null, text: "Demonstrate curiosity and a sense of wonder about the world", elaboration: null, seq: 1 },
    { courseId: "science-k", domain: "Questioning and predicting", subdomain: null, text: "Observe objects and events in familiar contexts", elaboration: "Observation skills development.", seq: 2 },
    { courseId: "science-k", domain: "Processing and analyzing", subdomain: null, text: "Experience and interpret the local environment", elaboration: null, seq: 3 },
    { courseId: "science-1", domain: "Questioning and predicting", subdomain: null, text: "Demonstrate curiosity about the natural world", elaboration: null, seq: 1 },
    { courseId: "science-1", domain: "Planning and conducting", subdomain: null, text: "Make simple predictions about familiar objects and events", elaboration: null, seq: 2 },
    { courseId: "science-2", domain: "Questioning and predicting", subdomain: null, text: "Demonstrate curiosity and a sense of wonder about the world", elaboration: null, seq: 1 },
    { courseId: "science-2", domain: "Communicating", subdomain: null, text: "Communicate observations and ideas using oral or written language", elaboration: "Evidence-based communication.", seq: 2 },
    { courseId: "mathematics-k", domain: "Reasoning and analyzing", subdomain: null, text: "Use reasoning to explore and make connections", elaboration: null, seq: 1 },
    { courseId: "mathematics-1", domain: "Reasoning and analyzing", subdomain: null, text: "Use reasoning to explore and make connections", elaboration: null, seq: 1 },
    { courseId: "mathematics-2", domain: "Reasoning and analyzing", subdomain: null, text: "Use reasoning to explore and make connections", elaboration: null, seq: 1 },
    { courseId: "adst-k", domain: "Applied Design", subdomain: null, text: "Generate ideas from their experiences and interests", elaboration: null, seq: 1 },
  ];

  const compIds: Record<string, number[]> = {};
  for (const cc of competenciesData) {
    const id = insertCompetency(db, cc.courseId, cc.domain, cc.subdomain, cc.text, cc.elaboration, cc.seq);
    if (!compIds[cc.courseId]) compIds[cc.courseId] = [];
    compIds[cc.courseId].push(id);
  }

  // ─── Content Items ─────────────────────────────────────────────
  const contentData = [
    { courseId: "science-k", text: "living and non-living things", elaboration: "Classification of things in the natural world.", examples: null, source: null, seq: 1 },
    { courseId: "science-k", text: "names of local plants and animals", elaboration: null, examples: "Douglas fir, black bear", source: null, seq: 2 },
    { courseId: "science-1", text: "classification of living and non-living things", elaboration: "Building on K-level classification.", examples: null, source: null, seq: 1 },
    { courseId: "science-1", text: "structural features of living things", elaboration: null, examples: null, source: null, seq: 2 },
    { courseId: "science-2", text: "life cycles of different organisms", elaboration: "Metamorphosis, growth stages.", examples: "butterfly, frog", source: null, seq: 1 },
    { courseId: "mathematics-k", text: "number concepts to 10", elaboration: "Counting, subitizing, one-to-one correspondence.", examples: null, source: null, seq: 1 },
    { courseId: "mathematics-k", text: "repeating patterns with two or three elements", elaboration: null, examples: "AB, ABB, ABC", source: null, seq: 2 },
    { courseId: "mathematics-1", text: "number concepts to 20", elaboration: "Counting forward and backward.", examples: null, source: null, seq: 1 },
    { courseId: "mathematics-2", text: "number concepts to 100", elaboration: "Skip counting, place value.", examples: null, source: null, seq: 1 },
    { courseId: "mathematics-2", text: "addition and subtraction facts to 20", elaboration: "Mental math strategies.", examples: null, source: null, seq: 2 },
    { courseId: "adst-k", text: "skills exploration through play", elaboration: null, examples: null, source: null, seq: 1 },
  ];

  const contentIds: Record<string, number[]> = {};
  for (const ci of contentData) {
    const id = insertContentItem(db, ci.courseId, ci.text, ci.elaboration, ci.examples, ci.source, ci.seq);
    if (!contentIds[ci.courseId]) contentIds[ci.courseId] = [];
    contentIds[ci.courseId].push(id);
  }

  // ─── FTS Entries ───────────────────────────────────────────────
  // Index all big ideas
  for (const bi of bigIdeasData) {
    const course = courses.find((c) => c.id === bi.courseId)!;
    const ids = bigIdeaIds[bi.courseId];
    insertFtsEntry(db, bi.text, "big_idea", ids[bi.seq - 1], bi.courseId, course.subject_id, course.grade);
    if (bi.elaboration) {
      insertFtsEntry(db, bi.elaboration, "elaboration", ids[bi.seq - 1], bi.courseId, course.subject_id, course.grade);
    }
  }

  // Index all competencies
  for (const cc of competenciesData) {
    const course = courses.find((c) => c.id === cc.courseId)!;
    const ids = compIds[cc.courseId];
    const idx = competenciesData.filter((x) => x.courseId === cc.courseId).indexOf(cc);
    insertFtsEntry(db, cc.text, "competency", ids[idx], cc.courseId, course.subject_id, course.grade);
  }

  // Index all content items
  for (const ci of contentData) {
    const course = courses.find((c) => c.id === ci.courseId)!;
    const ids = contentIds[ci.courseId];
    const idx = contentData.filter((x) => x.courseId === ci.courseId).indexOf(ci);
    insertFtsEntry(db, ci.text, "content_item", ids[idx], ci.courseId, course.subject_id, course.grade);
    if (ci.elaboration) {
      insertFtsEntry(db, ci.elaboration, "elaboration", ids[idx], ci.courseId, course.subject_id, course.grade);
    }
  }

  // ─── Core Competencies ─────────────────────────────────────────
  insertCoreCompetency(db, "cc-communicating", "Communication", "Communicating",
    "Communicating encompasses the set of abilities that people use to impart and exchange information, experiences, and ideas.",
    JSON.stringify(["I can communicate with purpose.", "I can communicate to share and develop ideas."])
  );
  insertCoreCompetency(db, "cc-creative-thinking", "Thinking", "Creative Thinking",
    "Creative Thinking involves the generation of new ideas and concepts.",
    JSON.stringify(["I can get ideas.", "I can think of new ideas or build on others' ideas."])
  );
  insertCoreCompetency(db, "cc-critical-thinking", "Thinking", "Critical and Reflective Thinking",
    "Critical and Reflective Thinking encompasses a set of abilities that students use to examine their own thinking.",
    null
  );
  insertCoreCompetency(db, "cc-personal-awareness", "Personal and Social", "Personal Awareness and Responsibility",
    "Personal Awareness and Responsibility encompasses the abilities students use to understand themselves.",
    JSON.stringify(["I can show a sense of accomplishment and joy.", "I can take responsibility for my actions."])
  );

  // ─── FPPL Principles ──────────────────────────────────────────
  insertFpplPrinciple(db,
    "Learning ultimately supports the well-being of the self, the family, the community, the land, the spirits, and the ancestors.",
    "Holistic view of learning that connects individual growth to community and land.",
    JSON.stringify({ science: "Land-based learning in science", mathematics: "Ethnomathematics connections" })
  );
  insertFpplPrinciple(db,
    "Learning is holistic, reflexive, reflective, experiential, and relational.",
    "Learning involves the whole person — body, mind, heart, spirit.",
    null
  );
  insertFpplPrinciple(db,
    "Learning involves recognizing the consequences of one's actions.",
    "Responsibility and interconnection in learning.",
    null
  );

  // ─── Assessment Resources ──────────────────────────────────────
  insertAssessmentResource(db, "science", 1,
    "Science Formative Assessment",
    "Use observation checklists and science journals to track student understanding of living things.",
    "classroom-assessment", "https://curriculum.gov.bc.ca/classroom-assessment/science"
  );
  insertAssessmentResource(db, "mathematics", null,
    "Math Assessment Practices",
    "Use number talks and math conferences to assess student understanding of number concepts.",
    "classroom-assessment", "https://curriculum.gov.bc.ca/classroom-assessment/math"
  );
  insertAssessmentResource(db, null, null,
    "BC Reporting Guidelines",
    "Standards-based reporting for K-12 communicates student progress relative to learning standards.",
    "reporting", "https://curriculum.gov.bc.ca/reporting"
  );

  // ─── Crawl Log ─────────────────────────────────────────────────
  db.prepare(
    "INSERT INTO crawl_log (url, status, content_hash, crawled_at, error) VALUES (?, ?, ?, datetime('now'), ?)"
  ).run("https://curriculum.gov.bc.ca/curriculum/science/k/core", 200, "abc123", null);

  db.prepare(
    "INSERT INTO crawl_log (url, status, content_hash, crawled_at, error) VALUES (?, ?, ?, datetime('now'), ?)"
  ).run("https://curriculum.gov.bc.ca/curriculum/science/99/core", null, null, "Page not found");

  // ─── Changelog Data ────────────────────────────────────────────
  insertChangelogEntry(db, "science-1", "big_idea", "modified",
    "Living things have features that help them survive.",
    "Living things have features and behaviours that help them survive.",
    "oldhash1", "newhash1"
  );
  insertChangelogEntry(db, "science-2", "content_item", "added",
    null,
    "metamorphosis as a type of life cycle",
    null, "newhash2"
  );
  insertChangelogEntry(db, "mathematics-1", "competency", "removed",
    "Estimate quantities to 20",
    null,
    "oldhash3", null
  );

  // ─── Snapshots ─────────────────────────────────────────────────
  insertSnapshot(db, "science-1", "snapshot-hash-v1", 1, 2, 2);
  insertSnapshot(db, "science-2", "snapshot-hash-v1", 1, 2, 1);

  // ─── Content Hashes ────────────────────────────────────────────
  insertContentHash(db, "science-1", "big_idea", bigIdeaIds["science-1"][0], "hash-bi-1", "Living things have features and behaviours");

  return db;
}
