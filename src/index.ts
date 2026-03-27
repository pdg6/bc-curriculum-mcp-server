#!/usr/bin/env node
/**
 * BC Curriculum MCP Server
 *
 * Provides structured access to BC Ministry of Education curriculum data
 * (curriculum.gov.bc.ca) via 12 MCP tools. Data is pre-crawled locally
 * and stored in a SQLite database for fast, reliable access.
 *
 * Supports both stdio (local) and streamable HTTP (remote) transports.
 *
 * The crawler runs locally on your machine (not on the server).
 * See DEPLOY.md for instructions on crawling and uploading data.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Request, Response, NextFunction } from "express";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Tool implementations
import { listCourses, getCourseCurriculum } from "./tools/curriculum-tools.js";
import { searchCurriculum } from "./tools/search-tools.js";
import { getGradeProgression, getCompetencyConnections } from "./tools/progression-tools.js";
import {
  getCoreCompetencies,
  getFppl,
  getAssessmentResources,
  getCrawlStatus,
} from "./tools/reference-tools.js";
import { searchCrossCurricular } from "./tools/cross-curricular-tools.js";
import { getCurriculumChanges, getCourseHistory } from "./tools/changelog-tools.js";

// Schemas
import {
  SearchCurriculumSchema,
  GetCourseCurriculumSchema,
  GetGradeProgressionSchema,
  GetCompetencyConnectionsSchema,
  GetCoreCompetenciesSchema,
  GetAssessmentResourcesSchema,
  GetFpplSchema,
  ListCoursesSchema,
  GetCrawlStatusSchema,
  SearchCrossCurricularSchema,
  GetCurriculumChangesSchema,
  GetCourseHistorySchema,
} from "./schemas/tool-schemas.js";

import { closeDb } from "./services/database.js";

// ─── Version (single source of truth: package.json) ────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const VERSION = JSON.parse(
  readFileSync(join(__dirname, "..", "package.json"), "utf-8")
).version as string;

// ─── Server Setup ───────────────────────────────────────────────

const server = new McpServer({
  name: "bc-curriculum-mcp-server",
  version: VERSION,
});

// ─── Tool 1: search_curriculum ──────────────────────────────────

server.registerTool(
  "search_curriculum",
  {
    title: "Search BC Curriculum",
    description: `Search BC curriculum (K-12) for standards, competencies, content items, and assessment resources using full-text search. Returns structured results with source metadata.

Args:
  - query (string): Natural language search query (e.g., 'empathetic design thinking', 'coding and computational thinking')
  - subject (string, optional): Filter by subject slug (e.g., 'adst', 'science')
  - grade (integer, optional): Filter by grade level (0=K, 1-12)
  - content_type (string, optional): Filter by content type ('big_idea', 'competency', 'content_item', 'elaboration', 'assessment', 'all')
  - limit (integer, optional): Max results (default 10, max 50)

Returns: Matching curriculum elements with source type, course, subject, and grade metadata.`,
    inputSchema: SearchCurriculumSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async (params) => searchCurriculum(params)
);

// ─── Tool 2: get_course_curriculum ──────────────────────────────

server.registerTool(
  "get_course_curriculum",
  {
    title: "Get Course Curriculum",
    description: `Get the complete BC curriculum for a specific course: Big Ideas, Curricular Competencies (grouped by domain), and Content/KDU items with elaborations. Returns the full three-column structure used by BC Ministry of Education.

Args:
  - subject (string): Subject slug (e.g., 'adst', 'science')
  - grade (integer): Grade level (0=K, 1-12)
  - course (string, optional): Course slug (e.g., 'technology-explorations'). If omitted, returns all courses for that subject+grade.

Returns: Complete three-column curriculum structure per course, including elaborations.`,
    inputSchema: GetCourseCurriculumSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async (params) => getCourseCurriculum(params)
);

// ─── Tool 3: get_grade_progression ──────────────────────────────

server.registerTool(
  "get_grade_progression",
  {
    title: "Get Grade Progression",
    description: `Show how Big Ideas, Competencies, and Content progress across grade levels for a BC subject. Useful for understanding scaffolding, prerequisites, and learning trajectories. When a query is provided, filters to only matching items at each grade — showing a focused vertical thread rather than a full data dump.

Args:
  - subject (string): Subject slug
  - grade_from (integer): Starting grade (0=K, 1-12)
  - grade_to (integer): Ending grade (0=K, 1-12)
  - focus (string, optional): Which element to trace ('big_ideas', 'competencies', 'content', 'all'). Default 'all'.
  - query (string, optional): Focus on a specific concept (e.g., 'evidence', 'multiplication'). Only matching items shown at each grade.

Returns: Grade-by-grade breakdown of curriculum elements showing progression, optionally filtered to a concept thread.`,
    inputSchema: GetGradeProgressionSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async (params) => getGradeProgression(params)
);

// ─── Tool 4: get_competency_connections ─────────────────────────

server.registerTool(
  "get_competency_connections",
  {
    title: "Get Competency Connections",
    description: `Find curricular competencies that appear across multiple subjects or courses. Useful for interdisciplinary curriculum design and identifying transferable skills.

Args:
  - competency_text (string): A competency description to find connections for
  - scope (string, optional): Where to search ('same_subject', 'cross_subject', 'all'). Default 'all'.

Returns: Related competencies from other courses/subjects with similarity ranking.`,
    inputSchema: GetCompetencyConnectionsSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async (params) => getCompetencyConnections(params)
);

// ─── Tool 5: get_core_competencies ──────────────────────────────

server.registerTool(
  "get_core_competencies",
  {
    title: "Get Core Competencies",
    description: `Get BC Core Competencies (Communication, Thinking, Personal/Social) with proficiency profiles. These cross-cutting competencies are assessed across all subjects.

Args:
  - domain (string, optional): Filter by domain ('communication', 'thinking', 'personal_social', 'all'). Default 'all'.

Returns: Core competencies with descriptions and proficiency profile levels.`,
    inputSchema: GetCoreCompetenciesSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async (params) => getCoreCompetencies(params)
);

// ─── Tool 6: get_assessment_resources ───────────────────────────

server.registerTool(
  "get_assessment_resources",
  {
    title: "Get Assessment Resources",
    description: `Get BC assessment practices, classroom assessment resources, and reporting guidance.

Args:
  - subject (string, optional): Filter by subject slug
  - grade (integer, optional): Filter by grade level
  - resource_type (string, optional): Filter by type ('classroom-assessment', 'reporting', 'standards-based', 'all'). Default 'all'.

Returns: Assessment resources with content and type metadata.`,
    inputSchema: GetAssessmentResourcesSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async (params) => getAssessmentResources(params)
);

// ─── Tool 7: get_fppl ──────────────────────────────────────────

server.registerTool(
  "get_fppl",
  {
    title: "Get First Peoples Principles of Learning",
    description: `Get the First Peoples Principles of Learning (FPPL) with descriptions and connections to curriculum areas. BC curriculum requires authentic integration of these principles.

Args:
  - subject (string, optional): Filter connections to a specific subject

Returns: FPPL principles with descriptions and subject-specific connections.`,
    inputSchema: GetFpplSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async (params) => getFppl(params)
);

// ─── Tool 8: list_courses ──────────────────────────────────────

server.registerTool(
  "list_courses",
  {
    title: "List BC Courses",
    description: `List all available courses in the BC curriculum database (K-12). Use this to discover what courses are available before querying specific curriculum data.

Args:
  - subject (string, optional): Filter by subject slug
  - grade (integer, optional): Filter by grade level (0=K, 1-12)

Returns: List of courses with subject, grade, name, and URL.`,
    inputSchema: ListCoursesSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async (params) => listCourses(params)
);

// ─── Tool 9: get_crawl_status ──────────────────────────────────

server.registerTool(
  "get_crawl_status",
  {
    title: "Get Crawl Status",
    description: `Check when BC curriculum data was last crawled, data completeness, and any crawl errors. Use to verify data freshness before relying on results.

Args:
  - subject (string, optional): Check specific subject only

Returns: Crawl timestamps, record counts per subject, and recent errors.`,
    inputSchema: GetCrawlStatusSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async (params) => getCrawlStatus(params)
);

// ─── Tool 10: search_cross_curricular ────────────────────────────

server.registerTool(
  "search_cross_curricular",
  {
    title: "Search Cross-Curricular Connections",
    description: `Find curriculum elements shared between two or more subjects at the same grade level. Identifies overlapping competencies, big ideas, and content across subjects. Essential for interdisciplinary planning.

Args:
  - subjects (string[]): Two or more subject slugs to compare (e.g., ['science', 'adst'])
  - grade (integer): Grade level (0=K, 1-12)
  - focus (string, optional): Which element to compare ('big_ideas', 'competencies', 'content', 'all'). Default 'all'.
  - query (string, optional): Narrow to a specific concept (e.g., 'evidence', 'design thinking')
  - limit (integer, optional): Max connections to return (default 20, max 50)

Returns: Groups of curriculum items connected by shared language across subjects.`,
    inputSchema: SearchCrossCurricularSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async (params) => searchCrossCurricular(params)
);

// ─── Tool 11: get_curriculum_changes ─────────────────────────────

server.registerTool(
  "get_curriculum_changes",
  {
    title: "Get Curriculum Changes",
    description: `Show what changed in BC curriculum since a given date. Detects added, removed, and modified Big Ideas, Competencies, and Content items across crawl runs. Requires at least two crawls to have change data.

Args:
  - since (string, optional): ISO date (e.g., '2026-01-15'). Default: last 30 days.
  - subject (string, optional): Filter by subject slug
  - grade (integer, optional): Filter by grade level
  - change_type (string, optional): Filter by change type ('added', 'removed', 'modified', 'all'). Default 'all'.
  - limit (integer, optional): Max entries to return (default 50, max 100)

Returns: Course-level summary of which courses changed, plus item-level detail of what specifically was added/removed/modified.`,
    inputSchema: GetCurriculumChangesSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async (params) => getCurriculumChanges(params)
);

// ─── Tool 12: get_course_history ─────────────────────────────────

server.registerTool(
  "get_course_history",
  {
    title: "Get Course History",
    description: `Show the crawl history and change timeline for a specific course. Includes each crawl snapshot (date, item counts, content hash) and a changelog of all detected modifications.

Args:
  - subject (string): Subject slug (e.g., 'science')
  - grade (integer): Grade level (0=K, 1-12)
  - course (string, optional): Course slug (e.g., 'chemistry'). If omitted, shows history for all courses at subject+grade.

Returns: Timeline of crawl snapshots and detected changes per course.`,
    inputSchema: GetCourseHistorySchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async (params) => getCourseHistory(params)
);

// ─── Transport Setup ────────────────────────────────────────────

async function runStdio(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("BC Curriculum MCP server running via stdio");
}

async function runHTTP(): Promise<void> {
  // Dynamic imports — express and StreamableHTTPServerTransport are only
  // loaded when HTTP mode is used, avoiding ~2MB overhead for stdio users.
  const [{ default: express }, { StreamableHTTPServerTransport }] =
    await Promise.all([
      import("express"),
      import("@modelcontextprotocol/sdk/server/streamableHttp.js"),
    ]);

  const app = express();
  app.use(express.json());

  // ─── Rate Limiter ─────────────────────────────────────────
  // NOTE: This is an in-memory, per-process rate limiter. If you scale
  // to multiple instances, each has its own map — a client could get
  // RATE_LIMIT_MAX * N requests/min. Use Redis-based limiting for
  // multi-instance deployments.
  const RATE_LIMIT_WINDOW_MS = 60_000;
  const RATE_LIMIT_MAX = 60;

  interface RateLimitEntry {
    count: number;
    resetAt: number;
  }

  const rateLimitMap = new Map<string, RateLimitEntry>();

  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of rateLimitMap) {
      if (now > entry.resetAt) {
        rateLimitMap.delete(key);
      }
    }
  }, 5 * 60_000);

  function rateLimitMiddleware(
    req: Request,
    res: Response,
    next: NextFunction
  ): void {
    const ip = req.ip || req.socket.remoteAddress || "unknown";
    const now = Date.now();

    let entry = rateLimitMap.get(ip);
    if (!entry || now > entry.resetAt) {
      entry = { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };
      rateLimitMap.set(ip, entry);
    }

    entry.count++;

    res.setHeader("X-RateLimit-Limit", String(RATE_LIMIT_MAX));
    res.setHeader(
      "X-RateLimit-Remaining",
      String(Math.max(0, RATE_LIMIT_MAX - entry.count))
    );
    res.setHeader(
      "X-RateLimit-Reset",
      String(Math.ceil(entry.resetAt / 1000))
    );

    if (entry.count > RATE_LIMIT_MAX) {
      res.status(429).json({
        error: "Rate limit exceeded. Please wait before making more requests.",
        retry_after_seconds: Math.ceil((entry.resetAt - now) / 1000),
      });
      return;
    }

    next();
  }

  // ─── CORS ─────────────────────────────────────────────────
  const allowedOrigin = process.env.CORS_ORIGIN || "*";
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
    res.setHeader("Access-Control-Allow-Methods", "POST, GET, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    next();
  });
  app.options("*", (_req: Request, res: Response) => res.sendStatus(204));

  // ─── Accept header normalization ────────────────────────
  // The MCP SDK strictly requires Accept: application/json, text/event-stream
  // on every POST, even for simple request/response methods like initialize
  // and tools/list. Some clients (including Claude Code) don't send
  // text/event-stream, causing a 406 rejection before any tools load.
  // This middleware normalizes the header so the SDK check passes.
  app.use("/mcp", (req: Request, _res: Response, next: NextFunction) => {
    if (req.method === "POST") {
      const accept = req.headers.accept || "";
      if (!accept.includes("text/event-stream")) {
        req.headers.accept = accept
          ? `${accept}, text/event-stream`
          : "application/json, text/event-stream";
      }
      if (!accept.includes("application/json")) {
        req.headers.accept = `application/json, ${req.headers.accept}`;
      }
    }
    next();
  });

  // ─── MCP endpoint ─────────────────────────────────────────
  // In stateless mode (sessionIdGenerator: undefined), a new transport
  // is created per request. server.connect() is called each time — this
  // is the documented MCP SDK pattern for stateless HTTP.
  app.post("/mcp", rateLimitMiddleware, async (req: Request, res: Response) => {
    try {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      res.on("close", () => transport.close());
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error("MCP request error:", err);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  });

  // Some MCP clients probe with GET (for SSE long-polling) or send
  // DELETE (for session cleanup). Handle both gracefully.
  app.get("/mcp", (_req: Request, res: Response) => {
    res.status(405).json({
      error: "Method Not Allowed",
      hint: "Use POST for MCP Streamable HTTP requests",
      server: "bc-curriculum-mcp-server",
      version: VERSION,
    });
  });

  app.delete("/mcp", (_req: Request, res: Response) => {
    // Stateless mode — no sessions to clean up
    res.sendStatus(200);
  });

  // ─── Health check ─────────────────────────────────────────
  app.get("/health", (_req: Request, res: Response) => {
    res.json({
      status: "ok",
      server: "bc-curriculum-mcp-server",
      version: VERSION,
    });
  });

  // ─── Documentation endpoint ───────────────────────────────
  app.get("/docs", (_req: Request, res: Response) => {
    res.json({
      name: "BC Curriculum MCP Server",
      version: VERSION,
      author: "Paul de Groot — Vancouver, BC",
      description:
        "Provides structured access to the entire BC Ministry of Education K–12 curriculum via MCP. " +
        "Teachers connect with one line of config — no installs, no accounts, no technical setup.",
      data_source: "https://curriculum.gov.bc.ca/curriculum",
      mcp_endpoint: "/mcp",
      coverage: {
        grades: "K–12",
        subjects: [
          "ADST",
          "Arts Education",
          "Career Education",
          "English Language Arts",
          "Languages",
          "Mathematics",
          "Physical & Health Education",
          "Science",
          "Social Studies",
        ],
        content_types: [
          "Big Ideas",
          "Curricular Competencies (with domains)",
          "Content / KDU items",
          "Elaborations",
          "Core Competencies",
          "First Peoples Principles of Learning",
          "Assessment Resources",
          "Instructional Samples",
        ],
      },
      tools: [
        {
          name: "search_curriculum",
          description: "Full-text search across all curriculum data",
        },
        {
          name: "get_course_curriculum",
          description:
            "Get Big Ideas, Competencies, and Content for a specific course",
        },
        {
          name: "list_courses",
          description: "List all available courses (filter by subject/grade)",
        },
        {
          name: "get_grade_progression",
          description:
            "Trace how curriculum builds across grade levels, optionally focused on a specific concept",
        },
        {
          name: "get_competency_connections",
          description: "Find competencies shared across subjects",
        },
        {
          name: "get_core_competencies",
          description:
            "Get Communication, Thinking, Personal/Social competencies",
        },
        {
          name: "get_fppl",
          description: "Get First Peoples Principles of Learning",
        },
        {
          name: "get_assessment_resources",
          description: "Get assessment practices and guidance",
        },
        {
          name: "get_crawl_status",
          description: "Check data freshness and completeness",
        },
        {
          name: "search_cross_curricular",
          description:
            "Find curriculum connections shared between two or more subjects at a grade",
        },
        {
          name: "get_curriculum_changes",
          description: "Show what changed in curriculum since a given date",
        },
        {
          name: "get_course_history",
          description: "View crawl history and change timeline for a course",
        },
      ],
      connection: {
        claude_desktop: {
          mcpServers: {
            "bc-curriculum": {
              type: "http",
              url: "https://bc-curriculum-mcp.fly.dev/mcp",
            },
          },
        },
        claude_code:
          "claude mcp add bc-curriculum --transport http --url https://bc-curriculum-mcp.fly.dev/mcp",
      },
      example_queries: [
        "What are the Big Ideas for ADST grade 10?",
        "Show me how science competencies build from grade 3 to 7",
        "Find curriculum connections between math and ADST for grade 9",
        "What are the First Peoples Principles of Learning?",
        "What are the curricular competencies for Kindergarten math?",
      ],
    });
  });

  const port = parseInt(process.env.PORT || "3000");
  const host = process.env.HOST || "0.0.0.0";
  app.listen(port, host, () => {
    console.error(
      `BC Curriculum MCP server running on http://${host}:${port}/mcp`
    );
  });
}

// ─── Entry Point ────────────────────────────────────────────────

const transportMode = process.env.TRANSPORT || "stdio";

process.on("SIGINT", () => {
  closeDb();
  process.exit(0);
});

process.on("SIGTERM", () => {
  closeDb();
  process.exit(0);
});

if (transportMode === "http") {
  runHTTP().catch((error) => {
    console.error("Server error:", error);
    process.exit(1);
  });
} else {
  runStdio().catch((error) => {
    console.error("Server error:", error);
    process.exit(1);
  });
}
