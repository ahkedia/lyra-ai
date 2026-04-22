/**
 * Notion API utilities
 * - notionRequest: single request with rate limiting
 * - notionQuery: query database (single page)
 * - notionQueryAll: paginated query (handles 100+ rows)
 * - notionPatch: update page properties
 */

const NOTION_KEY = process.env.NOTION_API_KEY;
const NOTION_DELAY_MS = 350;
const MAX_RETRIES = 2;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function notionRequest(method, endpoint, body, retries = 0) {
  await sleep(NOTION_DELAY_MS);

  const headers = {
    Authorization: `Bearer ${NOTION_KEY}`,
    "Notion-Version": "2022-06-28",
  };
  if (body !== undefined && body !== null) {
    headers["Content-Type"] = "application/json";
  }

  const res = await fetch(`https://api.notion.com/v1${endpoint}`, {
    method,
    headers,
    body: body !== undefined && body !== null ? JSON.stringify(body) : undefined,
  });
  
  const json = await res.json();
  
  if (res.status === 429 && retries < MAX_RETRIES) {
    const retryAfter = parseInt(res.headers.get("Retry-After") || "2", 10);
    console.log(`Notion 429 - retrying in ${retryAfter}s (attempt ${retries + 1})`);
    await sleep(retryAfter * 1000);
    return notionRequest(method, endpoint, body, retries + 1);
  }
  
  if (res.status === 401) {
    throw new Error(`Notion 401 Unauthorized: ${json.message}`);
  }
  
  if (!res.ok) {
    throw new Error(`Notion ${method} ${endpoint}: ${json.message}`);
  }
  
  return json;
}

export async function notionQuery(dbId, filter, sorts, pageSize = 100) {
  return notionRequest("POST", `/databases/${dbId}/query`, {
    filter,
    sorts,
    page_size: pageSize,
  });
}

export async function notionQueryAll(dbId, filter, sorts) {
  const results = [];
  let hasMore = true;
  let startCursor = undefined;
  
  while (hasMore) {
    const body = { page_size: 100 };
    if (filter) body.filter = filter;
    if (sorts) body.sorts = sorts;
    if (startCursor) body.start_cursor = startCursor;
    
    const res = await notionRequest("POST", `/databases/${dbId}/query`, body);
    results.push(...res.results);
    hasMore = res.has_more;
    startCursor = res.next_cursor;
  }
  
  return results;
}

export async function notionPatch(pageId, properties) {
  return notionRequest("PATCH", `/pages/${pageId}`, { properties });
}

export async function notionCreatePage(parent, properties, children) {
  const body = { parent, properties };
  if (children) body.children = children;
  return notionRequest("POST", "/pages", body);
}

export async function notionGetPage(pageId) {
  return notionRequest("GET", `/pages/${pageId}`);
}

/**
 * List direct children of a block or page (paginated).
 * @param {string} blockId - Page id or block id
 * @param {string|undefined} startCursor
 */
export async function notionListBlockChildren(blockId, startCursor) {
  const qs = new URLSearchParams({ page_size: "100" });
  if (startCursor) qs.set("start_cursor", startCursor);
  return notionRequest("GET", `/blocks/${blockId}/children?${qs.toString()}`);
}

function richTextToPlain(rich) {
  if (!rich || !Array.isArray(rich)) return "";
  return rich.map((t) => t.plain_text || "").join("");
}

/** Extract plain text from a single block (one line or paragraph body). */
export function blockToPlain(block) {
  const t = block?.type;
  if (!t || !block[t]) return "";
  const obj = block[t];
  if (t === "divider") return "";
  if (obj.rich_text) return richTextToPlain(obj.rich_text);
  if (t === "table" || t === "child_page") return "";
  return "";
}

/**
 * Depth-first walk of block tree; concatenates text with newlines.
 * @param {string} rootId - Notion page id
 * @param {number} maxChars - hard cap on returned string length
 */
export async function notionFetchBlockTreeAsPlainText(rootId, maxChars = 8000) {
  const lines = [];

  async function walk(id) {
    let cursor = undefined;
    do {
      const json = await notionListBlockChildren(id, cursor);
      for (const block of json.results || []) {
        const line = blockToPlain(block);
        if (line.trim()) lines.push(line);
        if (block.has_children) {
          await walk(block.id);
        }
      }
      cursor = json.has_more ? json.next_cursor : undefined;
    } while (cursor);
  }

  await walk(rootId);
  let text = lines.join("\n").trim();
  if (text.length > maxChars) {
    text = `${text.slice(0, maxChars)}\n...[truncated for prompt size]`;
  }
  return text;
}

export async function notionCreateDatabase(parent, title, properties) {
  return notionRequest("POST", "/databases", {
    parent,
    title: [{ type: "text", text: { content: title } }],
    properties,
  });
}

export function extractTitle(page, propName = null) {
  if (propName && page.properties[propName]) {
    const prop = page.properties[propName];
    if (prop.type === "title") {
      return prop.title?.[0]?.plain_text || "";
    }
    if (prop.type === "rich_text") {
      return prop.rich_text?.map(t => t.plain_text).join("") || "";
    }
    return "";
  }
  const titleProp = Object.values(page.properties).find(p => p.type === "title");
  return titleProp?.title?.[0]?.plain_text || "";
}

export function extractText(page, propName) {
  const prop = page.properties[propName];
  if (!prop) return "";
  if (prop.type === "title") {
    return prop.title?.map(t => t.plain_text).join("") || "";
  }
  if (prop.type === "rich_text") {
    return prop.rich_text?.map(t => t.plain_text).join("") || "";
  }
  return "";
}

export function extractRichText(page, propName) {
  const prop = page.properties[propName];
  if (!prop || prop.type !== "rich_text") return "";
  return prop.rich_text.map(t => t.plain_text).join("");
}

export function extractSelect(page, propName) {
  const prop = page.properties[propName];
  return prop?.select?.name || null;
}

export function extractNumber(page, propName) {
  const prop = page.properties[propName];
  return prop?.number ?? null;
}

export function extractUrl(page, propName) {
  const prop = page.properties[propName];
  return prop?.url || null;
}

export function extractDate(page, propName) {
  const prop = page.properties[propName];
  return prop?.date?.start || null;
}

export async function notionAppendBlock(pageId, children) {
  return notionRequest("PATCH", `/blocks/${pageId}/children`, { children });
}

/** Notion rich_text `text.content` max length per segment. */
const NOTION_TEXT_SEGMENT_MAX = 2000;
/** Notion allows at most 100 block children per append; stay under for headroom. */
const NOTION_APPEND_BATCH_SIZE = 90;

export function chunkTextForNotion(str, maxLen = NOTION_TEXT_SEGMENT_MAX) {
  const chunks = [];
  if (!str) return chunks;
  for (let i = 0; i < str.length; i += maxLen) {
    chunks.push(str.slice(i, i + maxLen));
  }
  return chunks;
}

/**
 * Turn plain blog text into paragraph blocks (split on blank lines; long paragraphs chunked).
 */
export function blogPlainTextToParagraphBlocks(fullText) {
  const blocks = [];
  const parts = fullText.split(/\n\n+/);
  for (const raw of parts) {
    const p = raw.trim();
    if (!p) continue;
    for (const chunk of chunkTextForNotion(p)) {
      blocks.push({
        type: "paragraph",
        paragraph: {
          rich_text: [{ type: "text", text: { content: chunk } }],
        },
      });
    }
  }
  return blocks;
}

export async function notionAppendChildrenBatched(pageId, children) {
  for (let i = 0; i < children.length; i += NOTION_APPEND_BATCH_SIZE) {
    const batch = children.slice(i, i + NOTION_APPEND_BATCH_SIZE);
    await notionAppendBlock(pageId, batch);
  }
}
