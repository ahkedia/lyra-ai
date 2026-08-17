import { render } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { loginPasskey, registerPasskey } from './passkey.js';

type Tab = 'lyra' | 'todo' | 'news';
type Status = 'fresh' | 'refreshing' | 'stale' | 'offline' | 'sign-in';
type Action = { id: string; status: string; label?: string; actionType?: string; targetId?: string };
type Source = { id: string; title?: string; source?: string; url?: string; asOf?: string };
type Block = Record<string, any>;
type Envelope = { blocks: Block[]; actions: Action[]; provenance: Source[] };
type FeedEvent = { id: string; actor: string; title?: string; occurredAt: string; status?: string; envelope: Envelope };
type Task = { id: string; title: string; detail?: string; dueAt?: string; source?: string; completed?: boolean; pending?: boolean };
type NewsItem = { id: string; headline: string; summary?: string; whyItMatters?: string; topic?: string; source?: string; sourceUrl?: string; imageUrl?: string; publishedAt?: string; read?: boolean; saved?: boolean };
type News = { items: NewsItem[]; generatedAt?: string; stale?: boolean; topics?: string[] };
type Setter<T> = (next: T | ((current: T) => T)) => void;

const CACHE_PREFIX = 'lyra.v3.';
const legacyToken = () => localStorage.getItem('lyra_token') || '';
const apiHeaders = (headers: HeadersInit = {}) => ({ ...(legacyToken() ? { authorization: `Bearer ${legacyToken()}` } : {}), ...headers });
const getCached = <T,>(key: string): T | null => { try { return JSON.parse(localStorage.getItem(CACHE_PREFIX + key) || 'null') as T | null; } catch { return null; } };
const cache = (key: string, value: unknown) => localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(value));
const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
const safeUrl = (value?: string) => { try { const parsed = new URL(value || ''); return ['https:', 'http:'].includes(parsed.protocol) ? parsed.href : undefined; } catch { return undefined; } };
const relativeTime = (value?: string) => value ? new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(value)) : '';

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { credentials: 'include', ...options, headers: apiHeaders({ 'content-type': 'application/json', ...(options.headers || {}) }) });
  if (!response.ok) { const detail = await response.json().catch(() => ({})); const error = Object.assign(new Error(detail.error?.message || detail.error || `Request failed (${response.status})`), { status: response.status }); throw error; }
  return response.json() as Promise<T>;
}

function useResource<T>(key: string, path: string, empty: T) {
  const [value, setValue] = useState<T>(() => getCached<T>(key) || empty);
  const [status, setStatus] = useState<Status>(() => getCached<T>(key) ? 'stale' : 'refreshing');
  const load = async (force = false) => {
    setStatus(current => current === 'fresh' ? 'refreshing' : current);
    try { const next = await request<T>(force ? `${path}${path.includes('?') ? '&' : '?'}refresh=1` : path); setValue(next); cache(key, next); setStatus('fresh'); return next; }
    catch (error) { setStatus((error as { status?: number }).status === 401 ? 'sign-in' : 'offline'); return null; }
  };
  useEffect(() => { void load(); }, [path]);
  return { value, setValue, status, load };
}

function App() {
  const initialTab = new URLSearchParams(location.search).get('tab');
  const [tab, setTab] = useState<Tab>(initialTab === 'todo' || initialTab === 'news' ? initialTab : 'lyra');
  const feed = useResource<{ events: FeedEvent[] }>('feed', '/v1/feed', { events: [] });
  const tasks = useResource<{ items: Task[]; warnings?: string[] }>('tasks', '/v1/tasks', { items: [] });
  const news = useResource<News>('news', '/v1/news', { items: [] });
  const [toast, setToast] = useState<{ text: string; undo?: () => void } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const scrolls = useRef<Record<Tab, number>>({ lyra: 0, todo: 0, news: 0 });

  useEffect(() => {
    const warm = window.setTimeout(() => { void tasks.load(); void news.load(); }, 350);
    return () => window.clearTimeout(warm);
  }, []);
  useEffect(() => { document.title = tab === 'lyra' ? 'Lyra' : tab === 'todo' ? 'To Do · Lyra' : 'News · Lyra'; history.replaceState({}, '', `/app/?tab=${tab}`); }, [tab]);
  useEffect(() => { if (!toast) return; const id = window.setTimeout(() => setToast(null), 5500); return () => window.clearTimeout(id); }, [toast]);
  const changeTab = (next: Tab) => { scrolls.current[tab] = window.scrollY; setTab(next); requestAnimationFrame(() => window.scrollTo({ top: scrolls.current[next], behavior: 'instant' as ScrollBehavior })); };

  return <div class="app-shell v3-shell">
    <header class="topbar"><div class="topbar-title"><span class="lyra-mark">✦</span><strong>{tab === 'lyra' ? 'Lyra' : tab === 'todo' ? 'To Do' : 'News'}</strong></div><div class="topbar-actions"><StatusPill status={tab === 'lyra' ? feed.status : tab === 'todo' ? tasks.status : news.status}/><button class="round-button" aria-label="Open settings" onClick={() => setSettingsOpen(true)}>⚙</button></div></header>
    <main class="main-content">
      <section hidden={tab !== 'lyra'} aria-label="Lyra conversation"><LyraStream events={feed.value.events} reload={feed.load} onToast={setToast} /></section>
      <section hidden={tab !== 'todo'} aria-label="To Do"><TodoScreen data={tasks.value} status={tasks.status} refresh={tasks.load} setData={tasks.setValue} onToast={setToast} /></section>
      <section hidden={tab !== 'news'} aria-label="News"><NewsScreen data={news.value} status={news.status} refresh={news.load} setData={news.setValue} /></section>
    </main>
    <nav class="tabbar" aria-label="Primary navigation"><TabButton active={tab === 'lyra'} onClick={() => changeTab('lyra')} icon="✦" label="Lyra"/><TabButton active={tab === 'todo'} onClick={() => changeTab('todo')} icon="✓" label="To Do"/><TabButton active={tab === 'news'} onClick={() => changeTab('news')} icon="◌" label="News"/></nav>
    {toast && <div class="toast" role="status"><span>{toast.text}</span>{toast.undo && <button onClick={() => { toast.undo?.(); setToast(null); }}>Undo</button>}</div>}
    {settingsOpen && <SettingsSheet onClose={() => setSettingsOpen(false)} onToast={setToast}/>} 
  </div>;
}

function StatusPill({ status }: { status: Status }) { return status === 'offline' ? <span class="connection-state">Offline, showing saved data</span> : status === 'sign-in' ? <span class="connection-state">Sign in required</span> : status === 'refreshing' ? <span class="quiet-status">Updating</span> : null; }
function SettingsSheet({ onClose, onToast }: { onClose: () => void; onToast: (value: { text: string } | null) => void }) {
  const [message, setMessage] = useState('Private controls for this device.');
  const run = async (work: () => Promise<unknown>, success: string) => { try { await work(); setMessage(success); } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not update settings'); } };
  return <div class="settings-backdrop" role="presentation" onClick={onClose}><section class="settings-sheet v3-settings" role="dialog" aria-modal="true" aria-label="Lyra settings" onClick={event => event.stopPropagation()}><div class="sheet-handle"/><h2>Lyra settings</h2><p class="muted">{message}</p><div class="settings-actions"><button class="secondary-button" onClick={() => void run(registerPasskey, 'Face ID is ready on this device.')}>Set up Face ID</button><button class="secondary-button" onClick={() => void run(loginPasskey, 'Signed in with Face ID.')}>Sign in with Face ID</button><button class="secondary-button" onClick={() => void run(async () => { await request('/v1/push/test', { method: 'POST', body: '{}' }); }, 'Test alert sent.')}>Send test alert</button></div><button class="primary-button close-sheet" onClick={onClose}>Done</button></section></div>;
}
function TabButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: string; label: string }) { return <button class={`tab-button ${active ? 'active' : ''}`} aria-current={active ? 'page' : undefined} onClick={onClick}><span aria-hidden="true">{icon}</span><small>{label}</small></button>; }

function LyraStream({ events, reload, onToast }: { events: FeedEvent[]; reload: () => Promise<unknown>; onToast: (value: { text: string; undo?: () => void } | null) => void }) {
  const [draft, setDraft] = useState(''); const [sending, setSending] = useState(false); const [localEvents, setLocalEvents] = useState<FeedEvent[]>([]); const bottom = useRef<HTMLDivElement>(null);
  const allEvents = useMemo(() => [...events, ...localEvents].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt)), [events, localEvents]);
  const send = async (event: Event) => {
    event.preventDefault(); const text = draft.trim(); if (!text || sending) return; setDraft(''); setSending(true);
    const userId = crypto.randomUUID(); const assistantId = crypto.randomUUID();
    setLocalEvents(current => [...current, { id: userId, actor: 'user', title: 'You', occurredAt: new Date().toISOString(), envelope: { blocks: [{ id: `${userId}-text`, type: 'rich_text', markdown: text }], actions: [], provenance: [] } }, { id: assistantId, actor: 'assistant', title: 'Lyra', occurredAt: new Date().toISOString(), status: 'pending', envelope: { blocks: [{ id: `${assistantId}-text`, type: 'rich_text', markdown: '' }], actions: [], provenance: [] } }]);
    requestAnimationFrame(() => bottom.current?.scrollIntoView({ block: 'end', behavior: 'smooth' }));
    try {
      const response = await fetch('/v1/messages', { method: 'POST', credentials: 'include', headers: apiHeaders({ 'content-type': 'application/json' }), body: JSON.stringify({ text, idempotencyKey: userId }) });
      if (!response.ok || !response.body) throw new Error('Lyra could not be reached');
      const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = '';
      while (true) { const { value, done } = await reader.read(); if (done) break; buffer += decoder.decode(value, { stream: true }); const frames = buffer.split('\n\n'); buffer = frames.pop() || ''; for (const frame of frames) { if (!frame.startsWith('data: ')) continue; const message = JSON.parse(frame.slice(6)); if (message.type === 'error' || message.type === 'message.failed') throw new Error(message.message || 'Lyra could not finish'); if (message.type === 'message.delta') setLocalEvents(current => current.map(item => item.id === assistantId ? { ...item, envelope: { ...item.envelope, blocks: [{ ...item.envelope.blocks[0], markdown: String(item.envelope.blocks[0].markdown || '') + String(message.content || '') }] } } : item)); if (message.type === 'tool.started') setLocalEvents(current => current.map(item => item.id === assistantId ? { ...item, status: message.label || 'Thinking' } : item)); } }
      setLocalEvents([]); await reload();
    } catch (error) { setLocalEvents(current => current.map(item => item.id === assistantId ? { ...item, status: 'failed', envelope: { ...item.envelope, blocks: [{ ...item.envelope.blocks[0], markdown: 'I could not finish that response. Please try again.' }] } } : item)); onToast({ text: error instanceof Error ? error.message : 'Message failed' }); } finally { setSending(false); }
  };
  return <div class="lyra-stream conversation-screen"><ScreenHeader eyebrow="Your Lyra stream" title="What’s on your mind?" onRefresh={() => void reload()}/><div class="event-stream">{allEvents.length ? allEvents.map(item => <Message key={item.id} event={item}/>) : <Empty title="Start wherever you are" detail="Ask Lyra to think, find, organise, or act. Scheduled updates will appear here too."/>}</div><div ref={bottom}/><form class="composer-wrap" onSubmit={send}><div class="composer"><textarea value={draft} onInput={event => setDraft((event.target as HTMLTextAreaElement).value)} rows={1} placeholder="Message Lyra…" aria-label="Message Lyra"/><button class="send-button" type="submit" disabled={sending} aria-label="Send message">↑</button></div><div class="composer-tools"><span>{sending ? 'Lyra is working…' : 'Trusted context appears with every answer.'}</span><button type="button" onClick={() => onToast({ text: 'Voice capture is available from Lyra settings.' })}>Add voice or note</button></div></form></div>;
}

function ScreenHeader({ eyebrow, title, onRefresh }: { eyebrow: string; title: string; onRefresh: () => void }) { return <div class="stream-header"><div><p class="eyebrow">{eyebrow}</p><h1>{title}</h1></div><button class="refresh-button" onClick={onRefresh}>Refresh</button></div>; }
function Empty({ title, detail }: { title: string; detail: string }) { return <div class="empty-state"><span class="lyra-mark">✦</span><h2>{title}</h2><p class="muted">{detail}</p></div>; }

function Message({ event }: { event: FeedEvent }) { return <article class={`event-card ${event.actor === 'user' ? 'user' : ''} ${event.status === 'pending' ? 'pending' : ''}`}><div class="event-avatar">{event.actor === 'user' ? 'A' : '✦'}</div><div class="event-body"><div class="event-meta"><span class="event-title">{event.title || (event.actor === 'user' ? 'You' : 'Lyra')}</span><time>{relativeTime(event.occurredAt)}</time>{event.status && event.status !== 'completed' && <span>{event.status}</span>}</div>{event.envelope.blocks.map(block => <BlockView key={block.id} block={block} envelope={event.envelope}/>)}</div></article>; }

function BlockView({ block, envelope }: { block: Block; envelope: Envelope }) {
  const sources = (block.sourceRefs || []).map((id: string) => envelope.provenance.find(source => source.id === id)).filter(Boolean) as Source[];
  const provenance = sources.length ? <div class="sources">{sources.map(source => <a class="source-chip" href={safeUrl(source.url)} target="_blank" rel="noreferrer">{source.title || source.source}</a>)}</div> : null;
  if (block.type === 'rich_text') return <div class="block rich-text" dangerouslySetInnerHTML={{ __html: markdown(block.markdown || '') }}/>;
  if (block.type === 'bullet_list' || block.type === 'numbered_list') { const List = block.type === 'bullet_list' ? 'ul' : 'ol'; return <div class="block"><List class="rich-list">{(block.items || []).map((item: string) => <li>{item}</li>)}</List>{provenance}</div>; }
  if (block.type === 'checklist') return <section class="block checklist"><h3>{block.title || 'Checklist'}</h3>{(block.items || []).map((item: any) => <label class="check-row"><input type="checkbox" checked={Boolean(item.checked)} readOnly/><span>{item.label}</span></label>)}{provenance}</section>;
  if (block.type === 'callout') return <aside class={`block callout ${block.tone || 'info'}`}><strong>{block.title}</strong><div>{block.body}</div>{provenance}</aside>;
  if (block.type === 'metric_group') return <div class="block metrics">{(block.metrics || []).map((metric: any) => <div class="metric"><span>{metric.label}</span><strong>{metric.value} {metric.unit}</strong><small>{metric.delta}</small></div>)}</div>;
  if (block.type === 'chart') return <figure class="block chart"><figcaption>{block.title}</figcaption>{(block.series || []).flatMap((series: any) => series.points || []).map((point: any) => <div class="chart-row"><span>{point.label}</span><span class="chart-track"><span class="chart-bar" style={{ width: `${Math.min(100, Number(point.value) || 0)}%` }}/></span><strong>{point.value}</strong></div>)}</figure>;
  if (block.type === 'image' || block.type === 'media') return <figure class="media-card">{block.mediaType === 'audio' ? <audio controls src={safeUrl(block.url)}/> : <img src={safeUrl(block.url)} alt={block.alt || block.title || 'Lyra media'} loading="lazy"/>}<figcaption>{block.caption || block.title}</figcaption></figure>;
  if (block.type === 'table') return <div class="rich-table-wrap"><table class="rich-table"><thead><tr>{(block.columns || []).map((column: any) => <th>{column.label || column}</th>)}</tr></thead><tbody>{(block.rows || []).map((row: string[]) => <tr>{row.map(cell => <td>{cell}</td>)}</tr>)}</tbody></table></div>;
  return <div class="block callout info">{block.title || block.summary || 'Lyra update'}{provenance}</div>;
}
function markdown(value: string) { return escape(value).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>'); }

function TodoScreen({ data, status, refresh, setData, onToast }: { data: { items: Task[]; warnings?: string[] }; status: Status; refresh: () => Promise<unknown>; setData: Setter<{ items: Task[]; warnings?: string[] }>; onToast: (value: { text: string; undo?: () => void } | null) => void }) {
  const [filter, setFilter] = useState<'today' | 'scheduled' | 'all' | 'completed'>('today');
  const visible = data.items.filter(item => filter === 'completed' ? item.completed : filter === 'scheduled' ? !item.completed && item.dueAt : filter === 'all' ? !item.completed : !item.completed && (!item.dueAt || new Date(item.dueAt).toDateString() === new Date().toDateString()));
  const complete = async (task: Task) => {
    const previous = data; setData({ ...data, items: data.items.map(item => item.id === task.id ? { ...item, completed: true, pending: true } : item) });
    let actionId = ''; try { const preview = await request<Action>('/v1/actions', { method: 'POST', body: JSON.stringify({ type: 'complete', targetId: task.id, idempotencyKey: `complete:${task.id}:${Date.now()}`, payload: { source: task.source || 'Notion reminders', kind: 'reminder' } }) }); actionId = preview.id; const result = await request<Action>(`/v1/actions/${preview.id}/commit`, { method: 'POST' }); if (result.status === 'failed') throw new Error('Could not complete reminder'); setData(current => ({ ...current, items: current.items.map(item => item.id === task.id ? { ...item, pending: false } : item) })); onToast({ text: 'Completed', undo: () => void undo() }); }
    catch (error) { setData(previous); onToast({ text: error instanceof Error ? error.message : 'Could not complete reminder' }); }
    async function undo() { setData(previous); if (actionId) await request(`/v1/actions/${actionId}/undo`, { method: 'POST', body: '{}' }).catch(() => undefined); }
  };
  return <div class="lyra-stream reminders-screen"><ScreenHeader eyebrow="Your reminders" title="To Do" onRefresh={() => void refresh()}/><div class="list-count">{data.items.filter(item => !item.completed).length} reminders</div><div class="reminder-filters" role="tablist">{(['today', 'scheduled', 'all', 'completed'] as const).map(name => <button class={`filter-pill ${filter === name ? 'active' : ''}`} onClick={() => setFilter(name)}>{name[0].toUpperCase() + name.slice(1)}</button>)}</div>{status === 'offline' && <div class="source-strip">Showing saved reminders. Lyra will catch up when you reconnect.</div>}<div class="task-list">{visible.length ? visible.map(task => <article class={`reminder-row ${task.pending ? 'is-pending' : ''}`}><label><input type="checkbox" checked={Boolean(task.completed)} onChange={() => !task.completed && void complete(task)}/><span class="reminder-checkbox"/><span class="reminder-copy"><strong>{task.title}</strong><small>{task.detail || task.dueAt ? task.dueAt ? new Date(task.dueAt).toLocaleDateString() : task.detail : task.source || 'Anytime'}</small></span></label></article>) : <Empty title={filter === 'completed' ? 'No completed reminders' : 'All clear'} detail={filter === 'today' ? 'Nothing due today.' : 'Your reminders will appear here when Lyra finds them.'}/>}</div></div>;
}

function NewsScreen({ data, status, refresh, setData }: { data: News; status: Status; refresh: (force?: boolean) => Promise<unknown>; setData: Setter<News> }) {
  const [topic, setTopic] = useState('For you'); const topics = ['For you', ...(data.topics || [])]; const items = data.items.filter(item => topic === 'For you' || item.topic === topic);
  const updateItem = (id: string, patch: Partial<NewsItem>) => setData({ ...data, items: data.items.map(item => item.id === id ? { ...item, ...patch } : item) });
  return <div class="lyra-stream news-screen"><ScreenHeader eyebrow="A focused read from Lyra" title="News" onRefresh={() => void refresh(true)}/><div class="news-filters">{topics.map(value => <button class={`filter-pill ${topic === value ? 'active' : ''}`} onClick={() => setTopic(value)}>{value}</button>)}</div>{status === 'offline' && <div class="source-strip">Showing your last saved feed.</div>}<div class="news-feed">{items.length ? items.map(item => <article class="news-card rich-news-card"><button class="news-card-main" onClick={() => updateItem(item.id, { read: true })}>{item.imageUrl && <img src={safeUrl(item.imageUrl)} alt="" loading="lazy"/>}<div><div class="briefing-meta"><span class="news-topic">{item.topic || 'Briefing'}</span><span>{item.source || 'Lyra'} · {item.publishedAt ? relativeTime(item.publishedAt) : 'Today'}</span></div><h2>{item.headline}</h2><p>{item.summary}</p>{item.whyItMatters && <p class="why-it-matters"><strong>Why it matters</strong>{item.whyItMatters}</p>}</div></button><footer><button class={item.saved ? 'saved' : ''} onClick={() => updateItem(item.id, { saved: !item.saved })}>{item.saved ? 'Saved' : 'Save'}</button>{item.sourceUrl && <a href={safeUrl(item.sourceUrl)} target="_blank" rel="noreferrer">Read source ↗</a>}</footer></article>) : <Empty title="Your brief is on its way" detail="There are no stories in this feed yet. Pull to refresh or ask Lyra for today’s news."/>}</div></div>;
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/app/sw.js', { scope: '/app/' }).catch(() => undefined);
render(<App/>, document.getElementById('app')!);
