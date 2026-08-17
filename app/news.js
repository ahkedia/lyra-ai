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
  return items.filter(item => !seen.has(item.id) && seen.add(item.id)).sort((a, b) => String(b.publishedAt || '').localeCompare(String(a.publishedAt || ''))).slice(0, 24);
}

export function normaliseNewsBrief(brief) {
  if (!brief) return [];
  return (brief.items || []).flatMap((item, index) => {
    const headline = String(item.headline || item.title || '').trim(); const sourceUrl = item.sourceUrl || item.url;
    if (!headline) return [];
    const sources = Array.isArray(item.sources) ? item.sources : [{ source: item.source || 'Lyra morning brief', title: item.sourceTitle || headline, url: sourceUrl, publishedAt: item.publishedAt || brief.generatedAt || brief.date }];
    return [{ id: item.id || stableId(sourceUrl || `${brief.date || brief.generatedAt || 'brief'}:${headline}:${index}`), headline, summary: String(item.summary || '').slice(0, 620), whyItMatters: String(item.whyItMatters || '').slice(0, 480), topic: item.topic || 'For you', source: item.source || sources[0]?.source || 'Lyra morning brief', sourceUrl, imageUrl: item.imageUrl || item.image?.url, publishedAt: item.publishedAt || brief.generatedAt || brief.date, sources }];
  });
}
