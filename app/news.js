import { createHash } from 'node:crypto';

const SOURCES = [
  { name: 'TechCrunch', topic: 'Fintech', url: 'https://techcrunch.com/category/fintech/feed/' },
  { name: 'Sifted', topic: 'European startups', url: 'https://sifted.eu/feed' },
  { name: 'Finextra', topic: 'Fintech', url: 'https://www.finextra.com/rss/headlines.aspx' },
  { name: 'GitHub Blog', topic: 'Technology', url: 'https://github.blog/feed/' },
  { name: "Lenny's Newsletter", topic: 'Product', url: 'https://www.lennysnewsletter.com/feed' },
  { name: 'arXiv AI', topic: 'AI', url: 'https://export.arxiv.org/api/query?search_query=cat:cs.AI&start=0&max_results=8&sortBy=submittedDate&sortOrder=descending' },
];

const text = value => String(value || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const field = (xml, tag) => text(xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i'))?.[1]);
const link = xml => xml.match(/<link[^>]+href=["']([^"']+)["'][^>]*>/i)?.[1] || field(xml, 'link');
const stableId = value => createHash('sha256').update(value).digest('hex').slice(0, 24);
const headlineTokens = value => new Set(text(value).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(token => token.length > 2 && !new Set(['with', 'from', 'that', 'this', 'into', 'after', 'about', 'over', 'will', 'have', 'their', 'your']).has(token)));
const sameStory = (left, right) => {
  const a = headlineTokens(left.headline); const b = headlineTokens(right.headline);
  const overlap = [...a].filter(token => b.has(token)).length;
  const similarity = overlap / Math.max(1, Math.min(a.size, b.size));
  const hoursApart = Math.abs(Date.parse(left.publishedAt || 0) - Date.parse(right.publishedAt || 0)) / 3_600_000;
  return similarity >= 0.72 && (!Number.isFinite(hoursApart) || hoursApart <= 72);
};

function parseFeed(xml, source) {
  const entries = [...xml.matchAll(/<(?:item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/(?:item|entry)>/gi)].map(match => match[1]);
  return entries.slice(0, 8).flatMap(entry => {
    const headline = field(entry, 'title'); const sourceUrl = link(entry); if (!headline || !sourceUrl) return [];
    const summary = field(entry, 'description') || field(entry, 'summary') || field(entry, 'content');
    const publishedAt = field(entry, 'pubDate') || field(entry, 'published') || field(entry, 'updated');
    const imageUrl = entry.match(/<(?:media:content|media:thumbnail|enclosure)[^>]+(?:url|href)=["']([^"']+)["']/i)?.[1];
    const date = Number.isNaN(Date.parse(publishedAt)) ? undefined : new Date(publishedAt).toISOString();
    return [{ id: stableId(sourceUrl), headline: headline.slice(0, 300), summary: summary.slice(0, 620), topic: source.topic, source: source.name, sourceUrl, imageUrl, publishedAt: date, whyItMatters: '', sources: [{ source: source.name, title: headline.slice(0, 300), url: sourceUrl, publishedAt: date }] }];
  });
}

export async function fetchNewsSources({ timeoutMs = 5000 } = {}) {
  const results = await Promise.allSettled(SOURCES.map(async source => {
    const response = await fetch(source.url, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml' } });
    if (!response.ok) throw new Error(`${source.name} returned ${response.status}`);
    return parseFeed(await response.text(), source);
  }));
  const items = results.flatMap(result => result.status === 'fulfilled' ? result.value : []);
  const seen = new Set();
  return clusterNewsItems(items.filter(item => !seen.has(item.id) && seen.add(item.id))).slice(0, 24);
}

export function clusterNewsItems(items = []) {
  const groups = [];
  for (const item of items.sort((a, b) => String(b.publishedAt || '').localeCompare(String(a.publishedAt || '')))) {
    const group = groups.find(candidate => sameStory(candidate.lead, item));
    if (group) group.items.push(item);
    else groups.push({ lead: item, items: [item] });
  }
  return groups.map(group => {
    const sources = [...new Map(group.items.flatMap(item => item.sources || [{ source: item.source, title: item.headline, url: item.sourceUrl, publishedAt: item.publishedAt }]).filter(source => source.url).map(source => [source.url, source])).values()];
    const lead = [...group.items].sort((a, b) => String(b.summary || '').length - String(a.summary || '').length)[0];
    return { ...lead, id: group.items.length === 1 ? lead.id : stableId(sources.map(source => source.url).sort().join('|') || lead.id), sources, source: lead.source || sources[0]?.source, sourceUrl: lead.sourceUrl || sources[0]?.url };
  }).sort((a, b) => String(b.publishedAt || '').localeCompare(String(a.publishedAt || '')));
}

export function normaliseNewsBrief(brief) {
  if (!brief) return [];
  return clusterNewsItems((brief.items || []).flatMap((item, index) => {
    const headline = String(item.headline || item.title || '').trim(); const sourceUrl = item.sourceUrl || item.url;
    if (!headline) return [];
    const sources = Array.isArray(item.sources) ? item.sources : [{ source: item.source || 'Lyra morning brief', title: item.sourceTitle || headline, url: sourceUrl, publishedAt: item.publishedAt || brief.generatedAt || brief.date }];
    return [{ id: item.id || stableId(sourceUrl || `${brief.date || brief.generatedAt || 'brief'}:${headline}:${index}`), headline, summary: String(item.summary || '').slice(0, 620), whyItMatters: String(item.whyItMatters || '').slice(0, 480), topic: item.topic || 'For you', source: item.source || sources[0]?.source || 'Lyra morning brief', sourceUrl, imageUrl: item.imageUrl || item.image?.url, publishedAt: item.publishedAt || brief.generatedAt || brief.date, sources }];
  }));
}
