/**
 * Global test setup — runs before each test file.
 *
 * Points DB_PATH at an in-memory database so tests never touch
 * the production SQLite file. Each test file gets a fresh DB
 * via the `seedTestDb()` helper.
 */

import { afterAll } from "vitest";
import { closeDb } from "../services/database.js";

// Force in-memory database for all tests
process.env.DB_PATH = ":memory:";

afterAll(() => {
  closeDb();
});
