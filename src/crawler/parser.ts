/**
 * DOM parsing functions for BC curriculum pages.
 *
 * These functions run inside Playwright's page.evaluate() context,
 * extracting structured data from the rendered curriculum.gov.bc.ca pages.
 *
 * The BC curriculum site is JavaScript-heavy — content is rendered client-side.
 * We use Playwright to render the page, then extract from the live DOM.
 *
 * Page structure (observed):
 * - Course pages have sections for Big Ideas, Curricular Competencies, and Content
 * - Each section contains list items with the actual curriculum text
 * - Competencies are grouped by domain (e.g., Applied Design, Applied Skills, Applied Technologies for ADST)
 * - Content items may have course tags in parentheses, e.g., "(Drafting 10)"
 * - Elaborations appear as:
 *   - Tooltip/popover elements triggered by underlined/linked text
 *   - Nested lists beneath a competency or content item
 *   - Separate expandable sections on the page
 *   - Text after a semicolon or colon within a list item
 *
 * K-7 vs 10-12:
 * - K-9 pages use a single "core" curriculum (same three-column structure)
 * - 10-12 pages have individual courses with the same structure
 * - The DOM layout is identical; only the URL pattern differs
 */

import type { Page } from "playwright";

// ─── Parsed Data Types ──────────────────────────────────────────

export interface ParsedBigIdea {
  text: string;
  elaboration: string | null;
  sequence: number;
}

export interface ParsedCompetency {
  domain: string;
  subdomain: string | null;
  text: string;
  elaboration: string | null;
  sequence: number;
}

export interface ParsedContentItem {
  text: string;
  elaboration: string | null;
  examples: string | null;
  sourceCourse: string | null;
  sequence: number;
}

export interface ParsedCoursePage {
  bigIdeas: ParsedBigIdea[];
  competencies: ParsedCompetency[];
  contentItems: ParsedContentItem[];
}

export interface ParsedCourseLink {
  name: string;
  slug: string;
  url: string;
}

export interface ParsedCoreCompetency {
  domain: string;
  name: string;
  description: string;
  profiles: string[];
}

export interface ParsedFpplPrinciple {
  principle: string;
  description: string;
}

export interface ParsedAssessmentResource {
  title: string;
  content: string;
  resourceType: string | null;
}

export interface ParsedInstructionalSample {
  title: string;
  description: string;
  content: string;
  url: string | null;
}

// ─── Course Curriculum Extraction ───────────────────────────────

/**
 * Extract the three-column curriculum structure from a rendered course page.
 *
 * Works for both K-9 core pages and 10-12 individual course pages.
 * The DOM structure is identical across all grades — a Drupal Views layout:
 *
 * Actual DOM structure (verified against live site March 2026):
 *
 *   div.curriculum_big_ideas
 *     └─ .curriculum-content > .views-row (one per Big Idea)
 *          └─ div > div (plain text content of the idea)
 *
 *   div.curriculum_competencies
 *     └─ h4.ccg  (domain heading: "Applied Design", "Applied Skills", etc.)
 *     └─ .curriculum-content > .views-row (one per subdomain group)
 *          └─ div > .views-field-nothing > span.field-content
 *               ├─ subdomain label text (e.g., "Understanding context")
 *               └─ <ul> > <li> (competency items)
 *                    ├─ text nodes (the competency statement)
 *                    ├─ <a href="#;"> (elaboration trigger — underlined term)
 *                    └─ div.elaboration (display:none — the elaboration text)
 *
 *   div.curriculum_content
 *     └─ .curriculum-content > .views-row (one per content item)
 *          └─ div > .views-field-nothing > span.field-content
 *               ├─ text nodes (the content statement)
 *               ├─ <a href="#;"> or <a href="#"> (elaboration trigger)
 *               ├─ div.elaboration (display:none)
 *               └─ optional <ul> (sub-items like pre-production, production, etc.)
 */
export async function extractCourseCurriculum(
  page: Page
): Promise<ParsedCoursePage> {
  return page.evaluate(() => {
    var result: {
      bigIdeas: Array<{
        text: string;
        elaboration: string | null;
        sequence: number;
      }>;
      competencies: Array<{
        domain: string;
        subdomain: string | null;
        text: string;
        elaboration: string | null;
        sequence: number;
      }>;
      contentItems: Array<{
        text: string;
        elaboration: string | null;
        examples: string | null;
        sourceCourse: string | null;
        sequence: number;
      }>;
    } = {
      bigIdeas: [],
      competencies: [],
      contentItems: [],
    };

    // ─── Helpers ─────────────────────────────────────────────────

    /**
     * Get visible text from an element, excluding hidden elaboration divs.
     * This gives us the "main" curriculum statement without elaboration noise.
     */
    var getVisibleText = function (el: Element): string {
      var text = "";
      Array.from(el.childNodes).forEach(function (node) {
        if (node.nodeType === 3) {
          // Text node
          text += node.textContent || "";
        } else if (node.nodeType === 1) {
          var child = node as Element;
          // Skip hidden elaboration divs
          if (child.classList.contains("elaboration")) return;
          // Skip nested lists (they're sub-items, not main text)
          if (child.tagName === "UL" || child.tagName === "OL") return;
          // Include link text (these are the underlined terms)
          if (child.tagName === "A") {
            text += child.textContent || "";
          } else if (child.tagName === "SPAN" || child.tagName === "EM" || child.tagName === "STRONG" || child.tagName === "B" || child.tagName === "I") {
            text += child.textContent || "";
          } else {
            // For other elements, recurse but still skip elaborations
            text += getVisibleText(child);
          }
        }
      });
      return text.replace(/\s+/g, " ").trim();
    };

    /**
     * Collect all elaboration text from an element.
     * Elaborations are div.elaboration elements (display:none) that contain
     * expanded definitions/examples for underlined terms.
     */
    var collectElaborations = function (el: Element): string | null {
      var elabs = Array.from(el.querySelectorAll(".elaboration"));
      if (elabs.length === 0) return null;

      var texts = elabs.map(function (e) {
        return (e.textContent || "").replace(/\s+/g, " ").trim();
      }).filter(function (t) { return t.length > 3; });

      return texts.length > 0 ? texts.join(" | ") : null;
    };

    /**
     * Collect sub-items from nested lists (e.g., pre-production, production, post-production).
     * Returns them as a semicolon-separated string.
     */
    var collectSubItems = function (el: Element): string | null {
      var lists = Array.from(el.querySelectorAll(":scope > ul, :scope > ol"));
      if (lists.length === 0) return null;

      var items: string[] = [];
      lists.forEach(function (list) {
        Array.from(list.querySelectorAll(":scope > li")).forEach(function (li) {
          var t = getVisibleText(li);
          if (t.length > 2) items.push(t);
        });
      });

      return items.length > 0 ? items.join("; ") : null;
    };

    var extractCourseTag = function (text: string): string | null {
      var match = text.match(/\(([A-Z][a-zA-Z\s]+ \d{1,2})\)$/);
      return match ? match[1] : null;
    };

    var extractExamples = function (text: string): string | null {
      var match = text.match(/,?\s*(?:for example|e\.g\.)[,:]?\s*(.+)$/i);
      return match ? match[1].trim() : null;
    };

    // ─── Extract Big Ideas ──────────────────────────────────────
    // Big Ideas are in .curriculum_big_ideas .views-row divs.
    // Each views-row contains one Big Idea as plain text.
    var bigIdeasSection = document.querySelector(".curriculum_big_ideas");
    if (bigIdeasSection) {
      var biRows = Array.from(bigIdeasSection.querySelectorAll(".views-row"));
      biRows.forEach(function (row, i) {
        var text = getVisibleText(row);
        if (text.length > 5) {
          result.bigIdeas.push({
            text: text,
            elaboration: collectElaborations(row),
            sequence: i,
          });
        }
      });
    }

    // ─── Extract Curricular Competencies ────────────────────────
    // Structure: .curriculum_competencies contains:
    //   h4.ccg = domain heading ("Applied Design", "Applied Skills", etc.)
    //   Each h4 is followed by a sibling div containing .curriculum-content
    //   Inside that: .views-row divs, each with a subdomain label + <ul><li> items
    var compSection = document.querySelector(".curriculum_competencies");
    if (compSection) {
      var globalSeq = 0;

      // Find all h4.ccg domain headings
      var domainHeadings = Array.from(compSection.querySelectorAll("h4.ccg"));

      if (domainHeadings.length > 0) {
        domainHeadings.forEach(function (h4) {
          var domainName = (h4.textContent || "").replace(/\s+/g, " ").trim();
          // The domain's content is in the next sibling div (contains .curriculum-content)
          var domainParent = h4.parentElement;
          if (!domainParent) return;

          // Each views-row within this domain = one subdomain group
          var viewsRows = Array.from(domainParent.querySelectorAll(".views-row"));
          viewsRows.forEach(function (vr) {
            // The field-content span contains subdomain label + list items
            // IMPORTANT: Each views-row has TWO .field-content elements:
            //   1. DIV.field-content (display:none, empty) — inside .views-field-field-curricular-competency-stem
            //   2. SPAN.field-content (visible, has data) — inside .views-field-nothing
            // We must target the SPAN specifically or use the parent wrapper.
            var fieldContent = vr.querySelector(".views-field-nothing .field-content") || vr.querySelector("span.field-content");
            if (!fieldContent) return;

            // Extract subdomain label: the first text/inline content before the <ul>
            var subdomain: string | null = null;
            var firstChild = fieldContent.firstChild;
            // Walk through children to find the subdomain label text
            var labelParts: string[] = [];
            Array.from(fieldContent.childNodes).forEach(function (node) {
              if (node.nodeType === 1) {
                var el = node as Element;
                if (el.tagName === "UL" || el.tagName === "OL") return; // stop at list
                if (el.classList.contains("elaboration")) return;
              }
              if (node.nodeType === 3) {
                var t = (node.textContent || "").trim();
                if (t.length > 0) labelParts.push(t);
              }
            });

            // The <ul> contains the actual competency list items
            var ul = fieldContent.querySelector("ul, ol");
            if (ul) {
              // If there's text before the <ul>, that's the subdomain label
              // Check: walk childNodes until we hit the <ul>
              var subLabel = "";
              Array.from(fieldContent.childNodes).some(function (node) {
                if (node.nodeType === 1 && ((node as Element).tagName === "UL" || (node as Element).tagName === "OL")) return true;
                if (node.nodeType === 3) subLabel += node.textContent || "";
                if (node.nodeType === 1 && !(node as Element).classList.contains("elaboration")) {
                  subLabel += (node as Element).textContent || "";
                }
                return false;
              });
              subdomain = subLabel.replace(/\s+/g, " ").trim() || null;

              Array.from(ul.querySelectorAll(":scope > li")).forEach(function (li) {
                var mainText = getVisibleText(li);
                var elabText = collectElaborations(li);
                // Also include sub-item elaborations
                var subItems = collectSubItems(li);
                var fullElab = [elabText, subItems].filter(Boolean).join(" | ") || null;

                if (mainText.length > 5) {
                  result.competencies.push({
                    domain: domainName,
                    subdomain: subdomain,
                    text: mainText,
                    elaboration: fullElab,
                    sequence: globalSeq++,
                  });
                }
              });
            } else {
              // No <ul> — the field-content itself is a standalone competency
              // (common in Applied Skills / Applied Technologies domains)
              var mainText = getVisibleText(fieldContent);
              var elabText = collectElaborations(fieldContent);
              if (mainText.length > 5) {
                result.competencies.push({
                  domain: domainName,
                  subdomain: null,
                  text: mainText,
                  elaboration: elabText,
                  sequence: globalSeq++,
                });
              }
            }
          });
        });
      }

      // Fallback 1: if no h4.ccg headings found, try <li> items
      if (result.competencies.length === 0) {
        Array.from(compSection.querySelectorAll("li")).forEach(function (li, i) {
          var mainText = getVisibleText(li);
          if (mainText.length > 5) {
            result.competencies.push({
              domain: "General",
              subdomain: null,
              text: mainText,
              elaboration: collectElaborations(li),
              sequence: i,
            });
          }
        });
      }

      // Fallback 2: if still nothing, iterate .views-row directly
      // Career Education K-9 uses flat views-rows with no h4.ccg and no <li>
      if (result.competencies.length === 0) {
        var flatRows = Array.from(compSection.querySelectorAll(".views-row"));
        flatRows.forEach(function (vr, i) {
          var fc = vr.querySelector(".views-field-nothing .field-content") || vr.querySelector("span.field-content");
          if (!fc) return;
          var mainText = getVisibleText(fc);
          if (mainText.length > 5) {
            result.competencies.push({
              domain: "General",
              subdomain: null,
              text: mainText,
              elaboration: collectElaborations(fc),
              sequence: i,
            });
          }
        });
      }
    }

    // ─── Extract Content (KDU) ──────────────────────────────────
    // Content items are in .curriculum_content .views-row divs.
    // Each views-row contains span.field-content with the item text,
    // elaboration divs (display:none), and optional nested lists.
    var contentSection = document.querySelector(".curriculum_content");
    if (contentSection) {
      var contentSeq = 0;

      // Get views-rows within the curriculum-content area
      var contentCC = contentSection.querySelector(".curriculum-content");
      var contentRows = contentCC
        ? Array.from(contentCC.querySelectorAll(":scope > .views-row"))
        : Array.from(contentSection.querySelectorAll(".views-row"));

      contentRows.forEach(function (vr) {
        // IMPORTANT: Each views-row has TWO .field-content elements:
        //   1. DIV.field-content (display:none, empty) — inside .views-field-field-curricular-competency-stem
        //   2. SPAN.field-content (visible, has data) — inside .views-field-nothing
        // We must target the SPAN specifically or use the parent wrapper.
        var fieldContent = vr.querySelector(".views-field-nothing .field-content") || vr.querySelector("span.field-content") || vr;
        var mainText = getVisibleText(fieldContent);

        // Get elaborations
        var elabText = collectElaborations(fieldContent);
        // Get nested sub-items (e.g., pre-production, production, post-production)
        var subItems = collectSubItems(fieldContent);
        var fullElab = [elabText, subItems].filter(Boolean).join(" | ") || null;

        if (mainText.length > 3) {
          result.contentItems.push({
            text: mainText,
            elaboration: fullElab,
            examples: extractExamples(mainText),
            sourceCourse: extractCourseTag(mainText),
            sequence: contentSeq++,
          });
        }
      });

      // Fallback: if no views-rows found, try <li> items
      if (result.contentItems.length === 0) {
        Array.from(contentSection.querySelectorAll("li")).forEach(function (li, i) {
          var mainText = getVisibleText(li);
          if (mainText.length > 3) {
            result.contentItems.push({
              text: mainText,
              elaboration: collectElaborations(li),
              examples: extractExamples(mainText),
              sourceCourse: extractCourseTag(mainText),
              sequence: i,
            });
          }
        });
      }
    }

    return result;
  });
}

// ─── Course Link Discovery ──────────────────────────────────────

/**
 * Extract course links from a grade/subject page.
 * These pages list all available courses for a subject at a given grade.
 *
 * The courses page (e.g., /curriculum/science/11/courses) lists course links
 * in the main content area. Each course link follows the pattern:
 *   /curriculum/{subject}/{grade}/{course-slug}
 * with exactly 4 path segments under /curriculum/.
 *
 * We MUST filter out:
 *   - Sidebar/nav links (only 2 segments, e.g., /curriculum/science)
 *   - File download links (/sites/...)
 *   - French stream links (/fr/...)
 *   - DOCX/PDF/WEB utility labels
 *   - Grade selector links (just a number or "k")
 */
export async function extractCourseLinks(
  page: Page,
  baseUrl: string
): Promise<ParsedCourseLink[]> {
  return page.evaluate(
    (base) => {
      var links: Array<{ name: string; slug: string; url: string }> = [];

      // The BC curriculum site renders course listings inside .course-title
      // elements within the .view-content area. Each real course entry has:
      //   div.course-title.col-8 > a[href="/curriculum/{subject}/{grade}/{slug}"]
      //
      // We MUST use this specific selector to avoid picking up sidebar/nav
      // links, grade-switcher links, and other non-course anchors that also
      // live inside <main> and match the same 4-segment URL pattern.
      var anchors = Array.from(
        document.querySelectorAll(".course-title a[href]")
      );

      for (var i = 0; i < anchors.length; i++) {
        var a = anchors[i];
        var href = (a.getAttribute("href") || "").trim();
        var text = (a.textContent || "").trim();

        // Skip empty/short labels and utility links
        if (text.length < 4) continue;
        if (text === "DOCX" || text === "PDF" || text === "WEB") continue;

        // Skip French-stream links
        if (href.startsWith("/fr/")) continue;

        // Clean trailing whitespace (some BC site URLs have trailing spaces)
        var cleanHref = href.replace(/\s+$/, "");

        // Must be a curriculum link with pattern /curriculum/{subject}/{grade}/{slug}
        var match = cleanHref.match(/^\/curriculum\/([^/]+)\/([^/]+)\/([^/]+)$/);
        if (!match) continue;

        var slug = match[3];

        // Skip meta pages (shouldn't appear in .course-title, but be safe)
        if (slug === "core" || slug === "courses" || slug === "introduction" ||
            slug === "goals-and-rationale" || slug === "goal-and-rationale") continue;

        // Deduplicate by slug
        if (links.some(function(l) { return l.slug === slug; })) continue;

        var fullUrl = cleanHref.startsWith("http")
          ? cleanHref
          : base + cleanHref;
        links.push({ name: text, slug: slug, url: fullUrl });
      }

      return links;
    },
    baseUrl
  );
}

// ─── Introduction Text Extraction ───────────────────────────────

/**
 * Extract introductory text from a subject's core/introduction page.
 */
export async function extractIntroductionText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const mainContent =
      document.querySelector("main") ||
      document.querySelector(".content") ||
      document.querySelector("#content") ||
      document.querySelector("article");

    if (mainContent) {
      const paragraphs = mainContent.querySelectorAll("p");
      const texts: string[] = [];
      paragraphs.forEach((p: Element) => {
        const text = (p.textContent || "").replace(/\s+/g, " ").trim();
        if (text.length > 20) {
          texts.push(text);
        }
      });
      return texts.join("\n\n");
    }

    return "";
  });
}

// ─── Core Competencies Extraction ───────────────────────────────

/**
 * Extract core competency data from a competency domain page.
 * e.g., /competencies/communication
 */
export async function extractCoreCompetencies(
  page: Page,
  domain: string
): Promise<ParsedCoreCompetency[]> {
  return page.evaluate(
    (dom) => {
      const competencies: Array<{
        domain: string;
        name: string;
        description: string;
        profiles: string[];
      }> = [];

      function cleanText(el: Element): string {
        return (el.textContent || "").replace(/\s+/g, " ").trim();
      }

      const mainContent =
        document.querySelector("main") ||
        document.querySelector(".content") ||
        document.querySelector("#content") ||
        document.body;

      // Look for competency sections — typically h2 or h3 headings with descriptions
      const headings = Array.from(mainContent.querySelectorAll("h2, h3"));
      for (const heading of headings) {
        const name = cleanText(heading);
        if (name.length < 3 || name.length > 200) continue;

        // Collect description paragraphs and profile items after this heading
        let description = "";
        const profiles: string[] = [];
        let el = heading.nextElementSibling;
        const level = parseInt(heading.tagName.substring(1));

        while (el) {
          const tagName = el.tagName.toLowerCase();
          if (
            tagName.match(/^h[1-6]$/) &&
            parseInt(tagName.substring(1)) <= level
          ) {
            break;
          }

          if (tagName === "p") {
            const text = cleanText(el);
            if (text.length > 10) {
              description += (description ? "\n\n" : "") + text;
            }
          }

          if (tagName === "ul" || tagName === "ol") {
            Array.from(el.querySelectorAll(":scope > li")).forEach((li: Element) => {
              const t = cleanText(li);
              if (t.length > 5) profiles.push(t);
            });
          }

          el = el.nextElementSibling;
        }

        if (description.length > 10 || profiles.length > 0) {
          competencies.push({ domain: dom, name, description, profiles });
        }
      }

      return competencies;
    },
    domain
  );
}

// ─── FPPL Extraction ────────────────────────────────────────────

/**
 * Extract First Peoples Principles of Learning from the indigenous education page.
 */
export async function extractFpplPrinciples(
  page: Page
): Promise<ParsedFpplPrinciple[]> {
  return page.evaluate(() => {
    const principles: Array<{ principle: string; description: string }> = [];

    function cleanText(el: Element): string {
      return (el.textContent || "").replace(/\s+/g, " ").trim();
    }

    const mainContent =
      document.querySelector("main") ||
      document.querySelector(".content") ||
      document.querySelector("#content") ||
      document.body;

    // FPPL principles are typically presented as a list or as headings with descriptions
    // Strategy 1: Look for list items that start with "Learning..."
    const listItems = Array.from(mainContent.querySelectorAll("li"));
    for (const li of listItems) {
      const text = cleanText(li);
      if (
        text.startsWith("Learning") &&
        text.length > 20 &&
        text.length < 500
      ) {
        principles.push({ principle: text, description: "" });
      }
    }

    // Strategy 2: If no list items found, look for paragraphs
    if (principles.length === 0) {
      const paragraphs = Array.from(mainContent.querySelectorAll("p"));
      for (const p of paragraphs) {
        const text = cleanText(p);
        if (
          text.startsWith("Learning") &&
          text.length > 20 &&
          text.length < 500
        ) {
          principles.push({ principle: text, description: "" });
        }
      }
    }

    // Strategy 3: Look for headings with "principle" or specific FPPL text
    if (principles.length === 0) {
      const headings = Array.from(mainContent.querySelectorAll("h2, h3, h4"));
      for (const h of headings) {
        const name = cleanText(h);
        if (name.length < 5 || name.length > 200) continue;

        let desc = "";
        let el = h.nextElementSibling;
        while (el) {
          if (el.tagName.match(/^H[1-4]$/i)) break;
          if (el.tagName.toLowerCase() === "p") {
            desc += (desc ? "\n\n" : "") + cleanText(el);
          }
          el = el.nextElementSibling;
        }

        if (desc.length > 10) {
          principles.push({ principle: name, description: desc });
        }
      }
    }

    return principles;
  });
}

// ─── Assessment Resources Extraction ────────────────────────────

/**
 * Extract assessment resource content from the classroom assessment page.
 */
export async function extractAssessmentResources(
  page: Page
): Promise<ParsedAssessmentResource[]> {
  return page.evaluate(() => {
    const resources: Array<{
      title: string;
      content: string;
      resourceType: string | null;
    }> = [];

    function cleanText(el: Element): string {
      return (el.textContent || "").replace(/\s+/g, " ").trim();
    }

    const mainContent =
      document.querySelector("main") ||
      document.querySelector(".content") ||
      document.querySelector("#content") ||
      document.body;

    // Extract sections by headings
    const headings = Array.from(mainContent.querySelectorAll("h2, h3"));
    for (const h of headings) {
      const title = cleanText(h);
      if (title.length < 3 || title.length > 300) continue;

      let content = "";
      let el = h.nextElementSibling;
      const level = parseInt(h.tagName.substring(1));

      while (el) {
        const tagName = el.tagName.toLowerCase();
        if (
          tagName.match(/^h[1-6]$/) &&
          parseInt(tagName.substring(1)) <= level
        ) {
          break;
        }

        const text = cleanText(el);
        if (text.length > 5) {
          content += (content ? "\n\n" : "") + text;
        }

        el = el.nextElementSibling;
      }

      if (content.length > 20) {
        // Infer resource type from title
        let resourceType: string | null = null;
        const lowerTitle = title.toLowerCase();
        if (lowerTitle.includes("classroom") || lowerTitle.includes("formative")) {
          resourceType = "classroom-assessment";
        } else if (lowerTitle.includes("report")) {
          resourceType = "reporting";
        } else if (lowerTitle.includes("standard") || lowerTitle.includes("proficiency")) {
          resourceType = "standards-based";
        }

        resources.push({ title, content, resourceType });
      }
    }

    return resources;
  });
}

// ─── Instructional Samples Extraction ───────────────────────────

/**
 * Extract instructional sample links and descriptions from the samples page.
 */
export async function extractInstructionalSamples(
  page: Page,
  baseUrl: string
): Promise<ParsedInstructionalSample[]> {
  return page.evaluate(
    (base) => {
      const samples: Array<{
        title: string;
        description: string;
        content: string;
        url: string | null;
      }> = [];

      function cleanText(el: Element): string {
        return (el.textContent || "").replace(/\s+/g, " ").trim();
      }

      const mainContent =
        document.querySelector("main") ||
        document.querySelector(".content") ||
        document.querySelector("#content") ||
        document.body;

      // Look for sample cards/items — these vary in structure
      // Strategy 1: Look for article elements or card-like divs
      const articles = Array.from(mainContent.querySelectorAll(
        "article, .card, .view-content .views-row, .node--type-instructional-sample"
      ));
      for (const article of articles) {
        const titleEl =
          article.querySelector("h2, h3, h4, .title, .field--name-title") ||
          article.querySelector("a");
        const title = titleEl ? cleanText(titleEl) : "";
        if (!title || title.length < 3) continue;

        const descEl = article.querySelector(
          "p, .field--name-body, .description"
        );
        const description = descEl ? cleanText(descEl) : "";

        const linkEl = article.querySelector("a[href]");
        let url: string | null = null;
        if (linkEl) {
          const href = linkEl.getAttribute("href") || "";
          url = href.startsWith("http") ? href : `${base}${href}`;
        }

        samples.push({ title, description, content: description, url });
      }

      // Strategy 2: If no articles found, look for heading+content pairs
      if (samples.length === 0) {
        const headings = Array.from(mainContent.querySelectorAll("h2, h3"));
        for (const h of headings) {
          const title = cleanText(h);
          if (title.length < 3) continue;

          let content = "";
          let el = h.nextElementSibling;
          while (el) {
            if (el.tagName.match(/^H[1-3]$/i)) break;
            content += (content ? "\n" : "") + cleanText(el);
            el = el.nextElementSibling;
          }

          if (content.length > 10) {
            const linkEl = h.querySelector("a[href]");
            let url: string | null = null;
            if (linkEl) {
              const href = linkEl.getAttribute("href") || "";
              url = href.startsWith("http") ? href : `${base}${href}`;
            }
            samples.push({ title, description: content, content, url });
          }
        }
      }

      return samples;
    },
    baseUrl
  );
}
