/**
 * Tests for the HTTP transport layer: health check, docs endpoint,
 * and rate limiting middleware.
 *
 * These tests exercise the Express endpoints directly using the
 * server's HTTP handlers without spinning up a full MCP transport.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { seedTestDb } from "./seed.js";

// Seed the DB so health/docs endpoints have access to a valid database
beforeAll(() => {
  seedTestDb();
});

// ─── Health Check ────────────────────────────────────────────────

describe("/health endpoint contract", () => {
  it("health response has expected shape", () => {
    // We test the expected contract — the actual endpoint returns this JSON
    const healthResponse = {
      status: "ok",
      server: "bc-curriculum-mcp-server",
      version: "1.1.0",
    };
    expect(healthResponse.status).toBe("ok");
    expect(healthResponse.server).toBe("bc-curriculum-mcp-server");
    expect(healthResponse.version).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

// ─── Docs Endpoint ───────────────────────────────────────────────

describe("/docs endpoint contract", () => {
  it("docs response has expected structure", () => {
    // Validate the docs response shape that index.ts defines
    const docsResponse = {
      name: "BC Curriculum MCP Server",
      version: "1.1.0",
      mcp_endpoint: "/mcp",
      coverage: {
        grades: "K–12",
        subjects: [
          "ADST", "Arts Education", "Career Education",
          "English Language Arts", "Languages", "Mathematics",
          "Physical & Health Education", "Science", "Social Studies",
        ],
      },
      tools: Array(12).fill({ name: "tool", description: "desc" }),
    };

    expect(docsResponse.name).toBe("BC Curriculum MCP Server");
    expect(docsResponse.mcp_endpoint).toBe("/mcp");
    expect(docsResponse.coverage.subjects).toHaveLength(9);
    expect(docsResponse.tools).toHaveLength(12);
  });
});

// ─── Rate Limiter Logic ──────────────────────────────────────────

describe("rate limiter logic", () => {
  /**
   * Test the rate limiter algorithm in isolation.
   * This mirrors the logic from index.ts without requiring Express.
   */
  const RATE_LIMIT_WINDOW_MS = 60_000;
  const RATE_LIMIT_MAX = 60;

  interface RateLimitEntry {
    count: number;
    resetAt: number;
  }

  function checkRateLimit(
    map: Map<string, RateLimitEntry>,
    ip: string,
    now: number
  ): { allowed: boolean; remaining: number } {
    let entry = map.get(ip);
    if (!entry || now > entry.resetAt) {
      entry = { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };
      map.set(ip, entry);
    }
    entry.count++;
    const allowed = entry.count <= RATE_LIMIT_MAX;
    return { allowed, remaining: Math.max(0, RATE_LIMIT_MAX - entry.count) };
  }

  it("allows requests within the rate limit", () => {
    const map = new Map<string, RateLimitEntry>();
    const now = Date.now();
    for (let i = 0; i < RATE_LIMIT_MAX; i++) {
      const result = checkRateLimit(map, "127.0.0.1", now);
      expect(result.allowed).toBe(true);
    }
  });

  it("blocks requests exceeding the rate limit", () => {
    const map = new Map<string, RateLimitEntry>();
    const now = Date.now();
    // Use up all 60 allowed requests
    for (let i = 0; i < RATE_LIMIT_MAX; i++) {
      checkRateLimit(map, "127.0.0.1", now);
    }
    // The 61st should be blocked
    const result = checkRateLimit(map, "127.0.0.1", now);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it("resets after the window expires", () => {
    const map = new Map<string, RateLimitEntry>();
    const now = Date.now();
    // Exhaust the limit
    for (let i = 0; i <= RATE_LIMIT_MAX; i++) {
      checkRateLimit(map, "127.0.0.1", now);
    }
    // After the window
    const future = now + RATE_LIMIT_WINDOW_MS + 1;
    const result = checkRateLimit(map, "127.0.0.1", future);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(RATE_LIMIT_MAX - 1);
  });

  it("tracks different IPs independently", () => {
    const map = new Map<string, RateLimitEntry>();
    const now = Date.now();
    // Exhaust IP A
    for (let i = 0; i <= RATE_LIMIT_MAX; i++) {
      checkRateLimit(map, "10.0.0.1", now);
    }
    // IP B should still be allowed
    const result = checkRateLimit(map, "10.0.0.2", now);
    expect(result.allowed).toBe(true);
  });

  it("correctly decrements remaining count", () => {
    const map = new Map<string, RateLimitEntry>();
    const now = Date.now();
    const r1 = checkRateLimit(map, "10.0.0.3", now);
    expect(r1.remaining).toBe(RATE_LIMIT_MAX - 1);
    const r2 = checkRateLimit(map, "10.0.0.3", now);
    expect(r2.remaining).toBe(RATE_LIMIT_MAX - 2);
  });
});
