# BC Curriculum MCP Server — Deployment Guide

## What This Is

A public MCP server that gives any Claude user access to the entire BC Ministry of Education curriculum (K–12). Teachers connect with one line of config — no installs, no accounts, no technical setup.

**Data coverage:**
- **Grades K–12** (Kindergarten through Grade 12)
- **9 English-stream subjects**: ADST, Arts Education, Career Education, English Language Arts, Languages, Mathematics, Physical & Health Education, Science, Social Studies
- **50+ courses** at grades 10–12 (especially ADST with 55 courses)
- **Big Ideas, Curricular Competencies, and Content** (the three-column structure) with elaborations
- **Core Competencies** (Communication, Thinking, Personal & Social)
- **First Peoples Principles of Learning** (FPPL)
- **Assessment resources** and **Instructional samples**
- **Full-text search** across everything via SQLite FTS5

**Architecture:** The crawler runs locally on your machine (Playwright + Chromium), builds a SQLite database, and you upload it to Fly.io. The deployed server is read-only — no Playwright, no Chromium, minimal memory.

---

## Step 1: Crawl Locally

The crawler uses Playwright to render the JavaScript-heavy curriculum.gov.bc.ca site. This runs on your machine where you have plenty of RAM.

### First-time setup

```bash
cd bc-curriculum-mcp-server
npm install
npx playwright install chromium
npm run build
```

### Run the crawl

```bash
# Quick test: just ADST grades 8-10 (~5 minutes)
npm run crawl -- --subject adst --grade-from 8 --grade-to 10

# Full K-12 crawl (~60-90 minutes)
npm run crawl:all
```

The full crawl loads every curriculum page via headless Chromium, waiting 1.5 seconds between requests to be polite to BC Gov servers.

**Crawl options:**
```bash
# Crawl a specific subject
npm run crawl -- --subject adst
npm run crawl -- --subject science

# Specify grade range (K=kindergarten, or use 0)
npm run crawl -- --grade-from k --grade-to 7      # Elementary only
npm run crawl -- --grade-from 8 --grade-to 12     # Secondary only

# Re-crawl pages that already exist
npm run crawl -- --all --force

# Only crawl reference pages (Core Competencies, FPPL, Assessment)
npm run crawl -- --refs-only

# Skip reference pages
npm run crawl -- --no-refs

# Show all options
npm run crawl -- --help
```

After the crawl completes, the database file will be at `bc-curriculum.sqlite` in the project root (or wherever `DB_PATH` points).

---

## Step 2: Deploy to Fly.io (Free Tier)

The deployed server is lightweight — just Express + SQLite, no Playwright. Runs comfortably on 256MB RAM within the free tier.

### One-time setup (~10 minutes)

1. **Install Fly CLI:**
   ```bash
   # macOS/Linux
   curl -L https://fly.io/install.sh | sh

   # Windows (PowerShell)
   powershell -Command "iwr https://fly.io/install.ps1 -useb | iex"
   ```

2. **Create a Fly.io account:**
   ```bash
   fly auth signup
   ```
   No credit card required for free tier.

3. **Navigate to the project:**
   ```bash
   cd bc-curriculum-mcp-server
   ```

4. **Launch the app:**
   ```bash
   fly launch
   ```
   When prompted:
   - Accept the app name `bc-curriculum-mcp` (or choose your own)
   - Select region `yyz` (Toronto)
   - Say **yes** to deploy now

5. **Create persistent storage for the database:**
   ```bash
   fly volumes create bc_data --size 1 --region yyz
   ```

6. **Deploy** (to pick up the volume mount):
   ```bash
   fly deploy
   ```

7. **Upload your local database:**
   ```bash
   # Upload the crawled database to the Fly volume
   fly sftp shell
   ```
   Then inside the SFTP shell:
   ```
   put bc-curriculum.sqlite /data/bc-curriculum.sqlite
   exit
   ```

   Alternatively, as a one-liner using `fly ssh`:
   ```bash
   fly ssh sftp shell <<< "put bc-curriculum.sqlite /data/bc-curriculum.sqlite"
   ```

8. **Restart the server** to pick up the new database:
   ```bash
   fly apps restart bc-curriculum-mcp
   ```

9. **Verify it's working:**
   ```bash
   curl https://bc-curriculum-mcp.fly.dev/health
   ```
   Should return: `{"status":"ok","server":"bc-curriculum-mcp-server","version":"1.0.0"}`

### Your Server URL

After deployment, your MCP endpoint is:
```
https://bc-curriculum-mcp.fly.dev/mcp
```

---

## How Teachers Connect

### In Claude Desktop or Cowork

Teachers add this to their MCP config (Settings → MCP Servers → Add):

```json
{
  "mcpServers": {
    "bc-curriculum": {
      "type": "http",
      "url": "https://bc-curriculum-mcp.fly.dev/mcp"
    }
  }
}
```

That's it. No API keys, no installs. Once connected, they can ask Claude things like:

- "What are the Big Ideas for ADST grade 10?"
- "Show me how science competencies build from grade 3 to 7"
- "Find curriculum connections between math and ADST for grade 9"
- "What are the First Peoples Principles of Learning?"
- "What are the curricular competencies for Kindergarten math?"
- "Show me the Core Competencies for Thinking"
- "What assessment resources are available?"

### In Claude Code

```bash
# Add to project config
claude mcp add bc-curriculum --transport http --url https://bc-curriculum-mcp.fly.dev/mcp
```

---

## Available MCP Tools (9 total)

| Tool | Description |
|---|---|
| `bc_search_curriculum` | Full-text search across all curriculum data |
| `bc_get_course_curriculum` | Get Big Ideas, Competencies, and Content for a course |
| `bc_list_courses` | List all available courses (filter by subject/grade) |
| `bc_get_grade_progression` | Trace how curriculum builds across grade levels |
| `bc_get_competency_connections` | Find competencies shared across subjects |
| `bc_get_core_competencies` | Get Communication, Thinking, Personal/Social competencies |
| `bc_get_fppl` | Get First Peoples Principles of Learning |
| `bc_get_assessment_resources` | Get assessment practices and guidance |
| `bc_get_crawl_status` | Check data freshness and completeness |

---

## Re-Crawling (Semester Updates)

The BC Ministry typically updates curriculum in September and February. To refresh:

1. **Re-crawl locally:**
   ```bash
   npm run crawl:all -- --force
   ```

2. **Upload the updated database:**
   ```bash
   fly sftp shell
   put bc-curriculum.sqlite /data/bc-curriculum.sqlite
   exit
   ```

3. **Restart the server:**
   ```bash
   fly apps restart bc-curriculum-mcp
   ```

The `--force` flag re-crawls pages even if they already exist. Content hashes detect actual changes.

---

## Costs

**Fly.io free tier includes:**
- 3 shared-CPU VMs (we use 1)
- 256MB RAM per VM (sufficient — the server is just Express + SQLite, no Playwright)
- 3GB persistent storage (we use 1GB)
- Unlimited inbound bandwidth
- Outbound bandwidth included

This stays on the free tier. The crawler runs on your local machine, so the deployed server has minimal resource needs.

---

## Security Notes

- **No authentication** — the BC curriculum is public data, all tools are read-only
- **Rate limiting** — 60 requests per minute per IP to prevent abuse
- **CORS enabled** — allows connections from any origin (needed for browser-based MCP clients)
- **HTTPS enforced** — Fly.io handles TLS automatically
- **No user data stored** — the database only contains curriculum content from curriculum.gov.bc.ca

---

## Local Development

If you want to run it locally instead:

```bash
npm install
npx playwright install chromium
npm run build

# Crawl ADST to test
npm run crawl:adst

# Crawl everything K-12
npm run crawl:all

# Run the server
npm start                   # Runs via stdio (for local MCP clients)
TRANSPORT=http npm start    # Runs via HTTP on port 3000
```

---

## Database Schema

The SQLite database stores curriculum data in normalized tables:

- **subjects** — top-level subject info (introduction, goals/rationale)
- **courses** — individual courses per subject+grade (grade 0 = K)
- **big_ideas** — high-level conceptual understandings per course (with elaborations)
- **curricular_competencies** — what students can DO, grouped by domain (with elaborations)
- **content_items** — what students should KNOW (with elaborations, examples)
- **core_competencies** — cross-cutting Communication, Thinking, Personal/Social
- **fppl_principles** — First Peoples Principles of Learning
- **assessment_resources** — classroom assessment guidance
- **instructional_samples** — teaching examples and samples
- **curriculum_fts** — FTS5 full-text search index across all content
