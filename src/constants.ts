/**
 * Shared constants for the BC Curriculum MCP server.
 *
 * Covers K-12 BC curriculum: all English-stream subjects,
 * grade ranges, known course maps, and content type identifiers.
 */

/** Base URL for the BC curriculum site */
export const BC_CURRICULUM_BASE_URL = "https://curriculum.gov.bc.ca";

/** Maximum characters in a single MCP response */
export const CHARACTER_LIMIT = 25_000;

/** Default number of search results */
export const DEFAULT_SEARCH_LIMIT = 10;

/** Maximum search results per query */
export const MAX_SEARCH_LIMIT = 50;

/**
 * All BC curriculum subject slugs (English stream).
 *
 * Excludes francais-langue-premiere and fral (French immersion)
 * per project scope — English stream only.
 */
export const SUBJECT_SLUGS = [
  "adst",
  "arts-education",
  "career-education",
  "english-language-arts",
  "languages",
  "mathematics",
  "physical-health-education",
  "science",
  "social-studies",
] as const;

export type SubjectSlug = (typeof SUBJECT_SLUGS)[number];

/**
 * Grade range for the full K-12 curriculum.
 *
 * K = 0 internally (stored as grade 0 in the database).
 * K-9 courses use a /core endpoint (single unified curriculum).
 * 10-12 courses use individual course URLs.
 */
export const GRADE_MIN = 0; // Kindergarten
export const GRADE_MAX = 12;

/** Grade value representing Kindergarten */
export const GRADE_K = 0;

/**
 * Map grade number to URL slug.
 * Kindergarten is "k" in URLs, all others are numeric.
 */
export function gradeToSlug(grade: number): string {
  return grade === 0 ? "k" : String(grade);
}

/**
 * Subjects that use "core" as their only course at certain grades.
 * K-9: most subjects use /curriculum/{subject}/{grade}/core
 * 10-12: some subjects still use a single core course, others branch.
 *
 * EXCEPTION: Languages never uses /core — it has per-language courses
 * starting at grade 5, discoverable via the /courses page.
 */
export const CORE_ONLY_GRADES_MAX = 9;

/**
 * Languages starts at grade 5, not K.
 * Grades K-4 have no Languages curriculum.
 */
export const LANGUAGES_GRADE_MIN = 5;

/**
 * Languages course slugs — same 9 languages at grades 5-10.
 * At grades 11-12, each language also has an "-introductory" variant.
 * These are used as a fallback if dynamic course discovery fails.
 */
export const LANGUAGES_COURSES = [
  "american-sign-language",
  "core-french",
  "german",
  "italian",
  "japanese",
  "korean",
  "mandarin",
  "punjabi",
  "spanish",
];

/**
 * ADST course map — known courses by grade for grades 10-12.
 *
 * Grades 8-9 use /core. Grades 10-12 have individual courses.
 * This is the comprehensive list from curriculum.gov.bc.ca.
 */
export const ADST_COURSE_MAP: Record<number, string[]> = {
  10: [
    "computer-studies",
    "culinary-arts",
    "drafting",
    "electronics-and-robotics",
    "entrepreneurship-and-marketing",
    "family-and-society",
    "food-studies",
    "media-design",
    "metalwork",
    "power-technology",
    "technology-explorations",
    "textiles",
    "web-development",
    "woodwork",
  ],
  11: [
    "accounting",
    "computer-programming",
    "digital-communications",
    "drafting",
    "engineering",
    "food-studies",
    "media-design",
    "metalwork",
    "textiles",
    "tourism",
    "woodwork",
  ],
  12: [
    "accounting",
    "art-metal-and-jewellery",
    "automotive-technology",
    "business-computer-applications",
    "child-development-and-caregiving",
    "computer-information-systems",
    "computer-programming",
    "culinary-arts",
    "digital-media-development",
    "drafting",
    "e-commerce",
    "economics",
    "electronics",
    "engine-and-drivetrain",
    "engineering",
    "entrepreneurship",
    "fashion-industry",
    "food-studies",
    "furniture-and-cabinetry",
    "graphic-production",
    "housing-and-living-environments",
    "industrial-coding-and-design",
    "machining-and-welding",
    "mechatronics",
    "metalwork",
    "robotics",
    "remotely-operated-vehicles-and-drones",
    "specialized-studies-in-food",
    "textiles",
    "woodwork",
  ],
};

/**
 * Career Education has a non-standard grade structure.
 * Some courses span "all" grades or use special grade slugs.
 */
export const CAREER_EDUCATION_COURSES: Record<string, string> = {
  "career-life-education": "all",
  "career-life-connections": "all",
};

/** Content type identifiers used in FTS and tool responses */
export const CONTENT_TYPES = [
  "big_idea",
  "competency",
  "content_item",
  "elaboration",
  "assessment",
  "instructional_sample",
] as const;

export type ContentType = (typeof CONTENT_TYPES)[number];

/** Core competency domains */
export const CORE_COMPETENCY_DOMAINS = [
  "Communication",
  "Thinking",
  "Personal and Social",
] as const;

/** Core competency page paths */
export const CORE_COMPETENCY_PATHS: Record<string, string> = {
  Communication: "/competencies/communication",
  Thinking: "/competencies/thinking",
  "Personal and Social": "/competencies/personal-and-social",
};

/** Reference page URLs for crawling non-course content */
export const REFERENCE_PAGES = {
  indigenousResources: "/curriculum/indigenous-education-resources",
  classroomAssessment: "/classroom-assessment",
  instructionalSamples: "/instructional-samples",
  curriculumOverview: "/curriculum/overview",
  antiRacism: "/curriculum/anti-racism",
} as const;
