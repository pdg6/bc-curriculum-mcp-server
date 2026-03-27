# BC Curriculum MCP Server

An MCP (Model Context Protocol) server that gives BC teachers structured access to the entire BC Ministry of Education K–12 curriculum through Claude. Connect with one line of config — no installs, no accounts, no technical setup.

**Author:** Paul de Groot — Vancouver, BC

## What It Does

This server crawls [curriculum.gov.bc.ca](https://curriculum.gov.bc.ca/curriculum) and makes the full BC K–12 curriculum queryable through 12 MCP tools. Teachers and curriculum designers can ask Claude natural-language questions about Big Ideas, Curricular Competencies, Content standards, grade progressions, cross-subject connections, and more — grounded in the actual published curriculum data.

### Data Coverage

- **Grades K–12** (Kindergarten through Grade 12)
- **9 English-stream subjects:** ADST, Arts Education, Career Education, English Language Arts, Languages, Mathematics, Physical & Health Education, Science, Social Studies
- **Big Ideas, Curricular Competencies, and Content** (the three-column KDU structure) with elaborations
- **Core Competencies** (Communication, Thinking, Personal & Social)
- **First Peoples Principles of Learning** (FPPL)
- **Assessment resources** and **Instructional samples**
- **Full-text search** across all curriculum content

## Quick Start

### Option 1: Remote server (no install needed)

Add this to your MCP config (Claude Desktop → Settings → MCP Servers → Add):

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

Or via Claude Code CLI:

```bash
claude mcp add bc-curriculum --transport http --url https://bc-curriculum-mcp.fly.dev/mcp
```

### Option 2: Run locally via npx

```bash
npx bc-curriculum-mcp-server
```

This runs the server in stdio mode — compatible with any MCP client. You'll need a local `bc-curriculum.sqlite` database (see [For Developers](#for-developers) below).

### Option 3: Install globally via npm

```bash
npm install -g bc-curriculum-mcp-server
bc-curriculum-mcp
```

Once connected, ask Claude things like:

- "What are the Big Ideas for ADST grade 10?"
- "Show me how science competencies build from grade 3 to 7"
- "Find curriculum connections between math and ADST for grade 9"
- "What are the First Peoples Principles of Learning?"
- "What are the curricular competencies for Kindergarten math?"

## Available Tools

| Tool | What it does |
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
| `bc_search_cross_curricular` | Find curriculum connections shared between two or more subjects at a grade |
| `bc_get_curriculum_changes` | Show what changed in curriculum since a given date |
| `bc_get_course_history` | View crawl history and change timeline for a course |

## Architecture

```
┌──────────────────────┐       ┌─────────────────────────┐
│  Your Machine        │       │  Fly.io (free tier)     │
│                      │       │                         │
│  Playwright crawler  │──────▶│  Express + SQLite       │
│  builds SQLite DB    │ SFTP  │  read-only MCP server   │
│                      │       │  256MB RAM              │
└──────────────────────┘       └─────────────────────────┘
                                        │
                                        ▼
                               Claude Desktop / Cowork
                               connects via MCP over HTTPS
```

The crawler runs locally using Playwright + headless Chromium to render the JavaScript-heavy curriculum.gov.bc.ca pages. It produces a SQLite database that gets uploaded to Fly.io. The deployed server is lightweight and read-only — no browser, no crawler, just serves pre-built data over MCP.

## For Developers

### Prerequisites

- Node.js 18+
- npm

### Setup

```bash
git clone <repo-url>
cd bc-curriculum-mcp-server
npm install
npx playwright install chromium
npm run build
```

### Crawl

```bash
# Quick test — just ADST
npm run crawl -- --subject adst

# Full K–12 crawl (~60-90 minutes)
npm run crawl:all

# Re-crawl everything (overwrites existing data)
npm run crawl:all -- --force
```

### Run Locally

```bash
# stdio transport (for local MCP clients)
npm start

# HTTP transport (for remote connections)
TRANSPORT=http npm start
```

### Deploy

See [DEPLOY.md](./DEPLOY.md) for full Fly.io deployment instructions.

## How It Works

The BC curriculum is organized in a three-column structure for every course:

1. **Big Ideas** — High-level conceptual understandings
2. **Curricular Competencies** — What students can *do* (grouped by domain)
3. **Content** — What students should *know* (the KDU items)

Each element can have **elaborations** — expandable details that clarify scope and provide examples. This server captures all three columns plus elaborations for every course across all 9 subjects and all grades K–12.

The **Core Competencies** (Communication, Thinking, Personal & Social) and **First Peoples Principles of Learning** are cross-cutting frameworks that apply across all subjects and are stored separately.

## Data Source

All curriculum data is sourced from [curriculum.gov.bc.ca](https://curriculum.gov.bc.ca/curriculum), the official BC Ministry of Education curriculum website. The crawler respects the site with 1.5-second delays between requests.

## License

MIT — see [LICENSE](./LICENSE).

The curriculum content itself is published by the [BC Ministry of Education](https://curriculum.gov.bc.ca). This project provides structured access to that publicly available data.
