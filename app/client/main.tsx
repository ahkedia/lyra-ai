import { render } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { loginPasskey, registerPasskey } from './passkey.js';
import { BlockList, envelopeText, type LyraAction, type LyraEnvelope } from './renderers.js';
import { pendingMutations, queueMutation, removeMutation, updateMutation, readCached, writeCached } from './offline.js';
import { shareLyraContent } from './share.js';

type Tab = 'lyra' | 'todo' | 'news';
type Status = 'fresh' | 'refreshing' | 'stale' | 'offline' | 'sign-in';
type Toast = { text: string; undo?: () => void };
type FeedEvent = { id: string; actor: 'user' | 'assistant' | 'automation'; title?: string; occurredAt: string; status?: string; envelope: LyraEnvelope };
type Task = { id: string; title: string; detail?: string; notes?: string; dueAt?: string; source?: string; list?: string; completed?: boolean; flagged?: boolean; pending?: boolean };
type NewsItem = { id: string; headline: string; summary?: string; whyItMatters?: string; topic?: string; source?: string; sourceUrl?: string; imageUrl?: string; publishedAt?: string; read?: boolean; saved?: boolean; sources?: Array<{ title?: string; source?: string; url?: string }> };
type News = { items: NewsItem[]; brief?: { title?: string; summary?: string; date?: string; themes?: string[] }; refreshedAt?: string; stale?: boolean; topics?: string[] };

const token = () => localStorage.getItem('lyra_token') || '';
const authHeaders = (base: HeadersInit = {}) => ({ ...(token() ? { authorization: `Bearer ${token()}` } : {}), ...base });
const clock = (value?: string) => value ? new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(value)) : '';
const date = (value?: string) => value ? new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(value)) : '';
const safeUrl = (value?: string) => { try { const url = new URL(value || ''); return ['https:', 'http:'].includes(url.protocol) ? url.href : undefined; } catch { return undefined; } };

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { credentials: 'include', ...options, headers: authHeaders({ 'content-type': 'application/json', ...(options.headers || {}) }) });
  if (!response.ok) { const detail = await response.json().catch(() => ({})); throw Object.assign(new Error(detail.error || `Request failed (${response.status})`), { status: response.status }); }
  return response.json() as Promise<T>;
}

const decodePushKey = (value: string) => {
  const padded = `${value}${'='.repeat((4 - value.length % 4) % 4)}`.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
};

async function enablePushNotifications() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) throw new Error('Notifications are not supported on this device');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notification permission was not granted');
  const registration = await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  const subscription = existing || await request<{ publicKey: string }>('/v1/push/public-key').then(({ publicKey }) => registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: decodePushKey(publicKey) }));
  await request('/v1/push/subscriptions', { method: 'POST', body: JSON.stringify(subscription) });
}

function useResource<T>(key: string, path: string, empty: T) {
  const [value, setValue] = useState<T>(empty); const [status, setStatus] = useState<Status>('refreshing');
  const load = async (force = false) => {
    setStatus(current => current === 'fresh' ? 'refreshing' : current);
    try { const next = await request<T>(force ? `${path}${path.includes('?') ? '&' : '?'}refresh=1` : path); setValue(next); void writeCached(key, next); setStatus('fresh'); return next; }
    catch (error) { setStatus((error as { status?: number }).status === 401 ? 'sign-in' : 'offline'); return null; }
  };
  useEffect(() => { void readCached<T>(key).then(cached => { if (cached) { setValue(cached); setStatus('stale'); } }).finally(() => { void load(); }); }, [key, path]);
  return { value, setValue, status, load };
}

function App() {
  if (location.pathname === '/app/dev/components') return <ComponentGallery/>;
  const query = new URLSearchParams(location.search); const initial = query.get('tab');
  const [tab, setTab] = useState<Tab>(initial === 'todo' || initial === 'news' ? initial : 'lyra'); const [seed, setSeed] = useState(''); const [storyContext, setStoryContext] = useState<string | null>(null);
  const feed = useResource<{ events: FeedEvent[] }>('feed', '/v1/feed', { events: [] });
  const tasks = useResource<{ items: Task[] }>('tasks', '/v1/tasks', { items: [] });
  const news = useResource<News>('news', '/v1/news', { items: [] });
  const [toast, setToast] = useState<Toast | null>(null); const [settings, setSettings] = useState(false); const [pendingCount, setPendingCount] = useState(0);
  useEffect(() => { document.title = tab === 'lyra' ? 'Lyra' : `${tab === 'todo' ? 'To Do' : 'News'} · Lyra`; history.replaceState({}, '', `/app/?tab=${tab}`); }, [tab]);
  useEffect(() => { if (!toast) return; const id = setTimeout(() => setToast(null), 4800); return () => clearTimeout(id); }, [toast]);
  const refreshPending = () => void pendingMutations().then(items => setPendingCount(items.length));
  const flushPending = async () => {
    if (!navigator.onLine) return;
    for (const mutation of await pendingMutations()) {
      try {
        if (mutation.kind === 'message') { const response = await fetch('/v1/messages', { method: 'POST', credentials: 'include', headers: authHeaders({ 'content-type': 'application/json' }), body: JSON.stringify(mutation.payload) }); if (!response.ok) throw new Error('Queued message was rejected'); await response.text(); }
        if (mutation.kind === 'action') { const preview = await request<{ id: string }>('/v1/actions', { method: 'POST', body: JSON.stringify(mutation.payload) }); await request(`/v1/actions/${preview.id}/commit`, { method: 'POST', body: '{}' }); }
        await removeMutation(mutation.id);
      } catch (error) { await updateMutation(mutation.id, { attempts: mutation.attempts + 1, error: error instanceof Error ? error.message : 'Retry failed' }); break; }
    }
    refreshPending(); void feed.load(); void tasks.load();
  };
  useEffect(() => { refreshPending(); void flushPending(); const online = () => { void flushPending(); }; window.addEventListener('online', online); return () => window.removeEventListener('online', online); }, []);
  useEffect(() => {
    if (!window.EventSource) return;
    const stream = new EventSource('/v1/feed/stream');
    stream.onmessage = message => {
      try {
        const next = JSON.parse(message.data);
        if (next.type !== 'feed.event' || !next.event?.id) return;
        feed.setValue(current => ({ ...current, events: [next.event, ...current.events.filter(event => event.id !== next.event.id)] }));
      } catch { /* A malformed live frame must not remove cached content. */ }
    };
    return () => stream.close();
  }, []);
  return <div class="app-shell app-next"><header class="topbar"><strong class="topbar-title">{tab === 'lyra' ? 'Lyra' : tab === 'todo' ? 'To Do' : 'News'}</strong><div class="topbar-actions"><Connection status={tab === 'lyra' ? feed.status : tab === 'todo' ? tasks.status : news.status}/><button class="icon-button" aria-label="Open settings" onClick={() => setSettings(true)}>•••</button></div></header><main class="main-content"><section hidden={tab !== 'lyra'}><LyraStream events={feed.value.events} reload={feed.load} seed={seed} storyContext={storyContext} clearSeed={() => setSeed('')} clearStoryContext={() => setStoryContext(null)} onToast={setToast}/></section><section hidden={tab !== 'todo'}><TodoScreen data={tasks.value} status={tasks.status} refresh={tasks.load} setData={tasks.setValue} onToast={setToast}/></section><section hidden={tab !== 'news'}><NewsScreen data={news.value} status={news.status} refresh={news.load} setData={news.setValue} onAsk={item => { setSeed('What matters about this story, and what should I do next?'); setStoryContext(item.id); setTab('lyra'); }} onToast={setToast}/></section></main><nav class="tabbar" aria-label="Primary navigation"><Tab label="Lyra" icon="✦" active={tab === 'lyra'} onClick={() => setTab('lyra')}/><Tab label="To Do" icon="✓" active={tab === 'todo'} onClick={() => setTab('todo')}/><Tab label="News" icon="◌" active={tab === 'news'} onClick={() => setTab('news')}/></nav>{toast && <div class="toast" role="status"><span>{toast.text}</span>{toast.undo && <button onClick={() => { toast.undo?.(); setToast(null); }}>Undo</button>}</div>}{settings && <SettingsSheet onClose={() => setSettings(false)} pendingCount={pendingCount} onRetry={() => void flushPending()}/>}</div>;
}

function ComponentGallery() {
  const [fixture, setFixture] = useState<{ cases?: Array<{ id: string; component: string; envelope: LyraEnvelope }> } | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { void fetch('/v1/dev/components').then(response => response.ok ? response.json() : Promise.reject(new Error('Component gallery is unavailable'))).then(setFixture).catch(issue => setError(issue.message)); }, []);
  if (error) return <main class="component-gallery"><h1>Component gallery</h1><p>{error}</p></main>;
  if (!fixture) return <main class="component-gallery"><h1>Component gallery</h1><p>Loading fixtures…</p></main>;
  return <main class="component-gallery"><header><p class="block-eyebrow">Development only</p><h1>Lyra rich components</h1><p>Every fixture below uses the same validated renderer as the Lyra stream.</p></header>{fixture.cases?.map(item => <section class="gallery-case" data-fixture-id={item.id}><header><strong>{item.component}</strong><small>{item.id}</small></header><BlockList blocks={item.envelope.blocks} context={{ envelope: item.envelope, onAction: async () => undefined, onQuestionAnswer: async () => undefined }}/></section>)}</main>;
}

function Connection({ status }: { status: Status }) { return status === 'offline' ? <span class="connection-state">Offline</span> : status === 'sign-in' ? <span class="connection-state">Sign in required</span> : status === 'refreshing' ? <span class="quiet-status">Updating</span> : null; }
function Tab({ label, icon, active, onClick }: { label: string; icon: string; active: boolean; onClick: () => void }) { return <button class={`tab-button ${active ? 'active' : ''}`} aria-current={active ? 'page' : undefined} onClick={onClick}><span>{icon}</span><small>{label}</small></button>; }
function Empty({ title, detail }: { title: string; detail: string }) { return <div class="empty-state"><h2>{title}</h2><p>{detail}</p></div>; }

function SettingsSheet({ onClose, pendingCount, onRetry }: { onClose: () => void; pendingCount: number; onRetry: () => void }) {
  const [theme, setTheme] = useState(localStorage.getItem('lyra.theme') || 'system'); const [message, setMessage] = useState('Private controls for this device.');
  const [health, setHealth] = useState<{ sources?: Array<{ name: string; status: string }> } | null>(null);
  useEffect(() => { void request<{ sources?: Array<{ name: string; status: string }> }>('/v1/app-health').then(setHealth).catch(() => setHealth(null)); }, []);
  const run = async (work: () => Promise<unknown>, success: string) => { try { await work(); setMessage(success); } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not update settings'); } };
  const changeTheme = (next: string) => { localStorage.setItem('lyra.theme', next); document.documentElement.dataset.theme = next; setTheme(next); };
  return <div class="sheet-backdrop" role="presentation" onClick={onClose}><section class="sheet settings-sheet" role="dialog" aria-modal="true" aria-label="Lyra settings" onClick={event => event.stopPropagation()}><div class="sheet-handle"/><header><h2>Settings</h2><button class="text-button" onClick={onClose}>Done</button></header><p class="settings-status">{message}</p><section><h3>Account</h3><button class="setting-row" onClick={() => void run(registerPasskey, 'Face ID is ready on this device.')}><span>Face ID</span><small>Set up</small></button><button class="setting-row" onClick={() => void run(loginPasskey, 'Signed in with Face ID.')}><span>Sign in</span><small>Use Face ID</small></button></section><section><h3>Notifications</h3><button class="setting-row" onClick={() => void run(enablePushNotifications, 'Alerts are enabled on this device.')}><span>Alerts</span><small>{typeof Notification !== 'undefined' && Notification.permission === 'granted' ? 'Enabled' : 'Enable'}</small></button><button class="setting-row" onClick={() => void run(() => request('/v1/push/test', { method: 'POST', body: '{}' }), 'A test notification was sent.')}><span>Test alert</span><small>Send</small></button></section><section><h3>Appearance</h3><div class="theme-picker">{['system', 'light', 'dark'].map(choice => <button class={theme === choice ? 'active' : ''} onClick={() => changeTheme(choice)}>{choice}</button>)}</div></section><section><h3>Connection</h3><button class="setting-row" onClick={onRetry}><span>Offline changes</span><small>{pendingCount ? `${pendingCount} pending · Retry` : 'Up to date'}</small></button>{health?.sources?.map(source => <div class="setting-row static"><span>{source.name}</span><small>{source.status}</small></div>)}<div class="setting-row static"><span>Version</span><small>Next</small></div></section></section></div>;
}

function VoiceCapture({ onToast }: { onToast: (next: Toast) => void }) {
  const recorder = useRef<MediaRecorder | null>(null);
  const [state, setState] = useState<'idle' | 'recording' | 'saving'>('idle');
  const stop = () => recorder.current?.state === 'recording' && recorder.current.stop();
  const start = async () => {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { onToast({ text: 'Voice capture is not supported on this device.' }); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const chunks: Blob[] = [];
      const next = new MediaRecorder(stream);
      recorder.current = next;
      next.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      next.onerror = () => { stream.getTracks().forEach(track => track.stop()); setState('idle'); onToast({ text: 'Voice recording could not start.' }); };
      next.onstop = async () => {
        stream.getTracks().forEach(track => track.stop()); setState('saving');
        try {
          const audio = new Blob(chunks, { type: next.mimeType || 'audio/webm' });
          const encoded = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onerror = () => reject(new Error('Could not read the recording')); reader.onloadend = () => resolve(String(reader.result).split(',')[1] || ''); reader.readAsDataURL(audio); });
          const capture = await request<{ status?: string }>('/v1/captures', { method: 'POST', body: JSON.stringify({ kind: 'audio', audioBase64: encoded }) });
          onToast({ text: capture.status === 'transcription_failed' ? 'Voice note saved. Transcription is unavailable.' : 'Voice note saved.' });
        } catch (error) { onToast({ text: error instanceof Error ? error.message : 'Voice note could not be saved.' }); }
        finally { recorder.current = null; setState('idle'); }
      };
      next.start(); setState('recording');
    } catch (error) { onToast({ text: error instanceof Error ? error.message : 'Microphone access was not granted.' }); }
  };
  return <button type="button" class={state === 'recording' ? 'recording' : ''} onClick={() => state === 'recording' ? stop() : void start()} disabled={state === 'saving'}>{state === 'recording' ? 'Stop recording' : state === 'saving' ? 'Saving voice note…' : 'Add voice or note'}</button>;
}

function LyraStream({ events, reload, seed, storyContext, clearSeed, clearStoryContext, onToast }: { events: FeedEvent[]; reload: () => Promise<unknown>; seed: string; storyContext: string | null; clearSeed: () => void; clearStoryContext: () => void; onToast: (next: Toast) => void }) {
  const [draft, setDraft] = useState(''); const [sending, setSending] = useState(false); const [local, setLocal] = useState<FeedEvent[]>([]); const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => { if (seed) { setDraft(seed); clearSeed(); } }, [seed]);
  const all = useMemo(() => [...events, ...local].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt)), [events, local]);
  const onAction = async (action: LyraAction) => { const preview = await request<{ id: string }>('/v1/actions', { method: 'POST', body: JSON.stringify({ type: action.actionType, targetId: action.targetId || action.id, payload: action.payload || {}, idempotencyKey: `block:${action.id}:${crypto.randomUUID()}` }) }); const result = await request<{ status: string }>(`/v1/actions/${preview.id}/commit`, { method: 'POST', body: '{}' }); if (result.status === 'failed') throw new Error('Lyra could not complete that action.'); onToast({ text: 'Action completed' }); void reload(); };
  const onAnswer = async (block: Record<string, any>, answers: Record<string, string | string[]>) => { await request(`/v1/questions/${block.questionId}/answer`, { method: 'POST', body: JSON.stringify({ answers, idempotencyKey: crypto.randomUUID() }) }); onToast({ text: 'Answer sent' }); void reload(); };
  const send = async (event: Event) => {
    event.preventDefault(); const text = draft.trim(); if (!text || sending) return;
    setSending(true); setDraft(''); const userId = crypto.randomUUID(); const assistantId = crypto.randomUUID(); const contextId = storyContext; clearStoryContext();
    setLocal(current => [...current, { id: userId, actor: 'user', occurredAt: new Date().toISOString(), envelope: { blocks: [{ id: `${userId}-text`, type: 'rich_text', markdown: text }], actions: [], provenance: [] } }, { id: assistantId, actor: 'assistant', occurredAt: new Date().toISOString(), status: 'pending', envelope: { blocks: [{ id: `${assistantId}-text`, type: 'rich_text', markdown: '' }], actions: [], provenance: [] } }]);
    requestAnimationFrame(() => bottom.current?.scrollIntoView({ block: 'end', behavior: 'smooth' }));
    try {
      const response = await fetch('/v1/messages', { method: 'POST', credentials: 'include', headers: authHeaders({ 'content-type': 'application/json' }), body: JSON.stringify({ text, idempotencyKey: userId, ...(contextId ? { context: { newsItemId: contextId } } : {}) }) });
      if (!response.ok || !response.body) throw new Error('Lyra could not be reached');
      const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = '';
      while (true) { const frame = await reader.read(); if (frame.done) break; buffer += decoder.decode(frame.value, { stream: true }); const messages = buffer.split('\n\n'); buffer = messages.pop() || ''; for (const message of messages) { if (!message.startsWith('data: ')) continue; const next = JSON.parse(message.slice(6)); if (next.type === 'error') throw new Error('Lyra could not finish that response.'); if (next.type === 'message.delta') setLocal(current => current.map(item => item.id === assistantId ? { ...item, envelope: { ...item.envelope, blocks: [{ ...item.envelope.blocks[0], markdown: `${item.envelope.blocks[0].markdown || ''}${next.content || ''}` }] } } : item)); } }
      setLocal([]); await reload();
    } catch (error) {
      if (!navigator.onLine || error instanceof TypeError) {
        await queueMutation({ id: userId, kind: 'message', payload: { text, idempotencyKey: userId, ...(contextId ? { context: { newsItemId: contextId } } : {}) } });
        setLocal(current => current.map(item => item.id === assistantId ? { ...item, status: 'pending', envelope: { ...item.envelope, blocks: [{ ...item.envelope.blocks[0], markdown: 'Queued until Lyra reconnects.' }] } } : item));
        onToast({ text: 'Message queued for delivery' });
      } else {
        setLocal(current => current.map(item => item.id === assistantId ? { ...item, status: 'failed', envelope: { ...item.envelope, blocks: [{ ...item.envelope.blocks[0], markdown: 'I could not finish that response. Please try again.' }] } } : item));
        onToast({ text: error instanceof Error ? error.message : 'Message failed' });
      }
    } finally { setSending(false); }
  };
  return <div class="conversation-screen"><div class="stream-context">{all.length ? 'Today' : 'Lyra'}</div><div class="event-stream">{all.length ? all.map(event => <Message event={event} onAction={onAction} onAnswer={onAnswer} onToast={onToast}/>) : <Empty title="Lyra is ready" detail="Your reminders, briefings, and conversations will live here."/>}</div><div ref={bottom}/><form class="composer-wrap" onSubmit={send}><div class="composer"><textarea value={draft} onInput={event => setDraft((event.target as HTMLTextAreaElement).value)} rows={1} placeholder="Message Lyra…" aria-label="Message Lyra"/><button class="send-button" type="submit" disabled={sending} aria-label="Send message">↑</button></div><div class="composer-tools"><VoiceCapture onToast={onToast}/><span>{sending ? 'Lyra is working…' : 'Trusted context appears with every answer.'}</span></div></form></div>;
}

function Message({ event, onAction, onAnswer, onToast }: { event: FeedEvent; onAction: (action: LyraAction) => Promise<void>; onAnswer: (block: Record<string, any>, answers: Record<string, string | string[]>) => Promise<void>; onToast: (next: Toast) => void }) {
  const scheduled = event.actor === 'automation'; const title = scheduled ? friendlyTitle(event.title) : event.actor === 'user' ? 'You' : 'Lyra'; const share = async () => { try { const outcome = await shareLyraContent({ title, text: envelopeText(event.envelope) }); onToast({ text: outcome === 'copied' ? 'Copied to clipboard' : 'Shared' }); } catch { /* cancelled */ } };
  return <article class={`message ${event.actor === 'user' ? 'user-message' : 'assistant-message'} ${scheduled ? 'scheduled-message' : ''}`}><div class="message-rail">{event.actor === 'user' ? null : <span class="lyra-avatar">✦</span>}</div><div class="message-content"><header><strong>{event.actor === 'user' ? 'You' : 'Lyra'}</strong><time>{clock(event.occurredAt)}</time><button class="share-button" aria-label="Share this message" onClick={() => void share()}>↗</button></header>{scheduled && <p class="scheduled-label">{title} · {clock(event.occurredAt)}</p>}{event.status === 'failed' ? <aside class="message-failure"><strong>Update unavailable</strong><p>Lyra recorded this update but could not complete it.</p></aside> : <BlockList blocks={event.envelope.blocks} context={{ envelope: event.envelope, onAction, onQuestionAnswer: onAnswer, onShare: share }}/>}</div></article>;
}

function friendlyTitle(value?: string) { return ({ 'morning-digest-news': 'Morning news', 'morning-digest-combine': 'Morning briefing', 'health-morning-bundle': 'Morning health', 'health-evening-checkin': 'Health check-in', 'reading-nudge': 'Reading reminder' } as Record<string, string>)[value || ''] || value || 'Lyra update'; }

function TodoScreen({ data, status, refresh, setData, onToast }: { data: { items: Task[] }; status: Status; refresh: () => Promise<unknown>; setData: (next: { items: Task[] } | ((current: { items: Task[] }) => { items: Task[] })) => void; onToast: (next: Toast) => void }) {
  const [filter, setFilter] = useState<'today' | 'scheduled' | 'all' | 'flagged'>('today'); const [selected, setSelected] = useState<Task | null>(null); const [adding, setAdding] = useState(false); const active = data.items.filter(item => !item.completed); const now = new Date(); const visible = active.filter(item => filter === 'all' ? true : filter === 'flagged' ? item.flagged : filter === 'scheduled' ? Boolean(item.dueAt) : !item.dueAt || new Date(item.dueAt).toDateString() === now.toDateString());
  const complete = async (task: Task) => {
    const prior = data; const payload = { type: 'complete', targetId: task.id, idempotencyKey: `complete:${task.id}:${crypto.randomUUID()}`, payload: { source: task.source || 'Notion reminders', kind: 'reminder' } };
    setData({ items: data.items.map(item => item.id === task.id ? { ...item, completed: true, pending: true } : item) });
    try {
      const action = await request<{ id: string }>('/v1/actions', { method: 'POST', body: JSON.stringify(payload) });
      const result = await request<{ status: string }>(`/v1/actions/${action.id}/commit`, { method: 'POST', body: '{}' });
      if (result.status === 'failed') throw new Error('Provider did not confirm completion');
      setData(current => ({ items: current.items.map(item => item.id === task.id ? { ...item, pending: false } : item) }));
      onToast({ text: 'Completed', undo: () => { setData(prior); void request(`/v1/actions/${action.id}/undo`, { method: 'POST', body: '{}' }); } });
    } catch (error) {
      if (!navigator.onLine || error instanceof TypeError) { await queueMutation({ id: payload.idempotencyKey, kind: 'action', payload }); onToast({ text: 'Completion queued for sync' }); }
      else { setData(prior); onToast({ text: error instanceof Error ? error.message : 'Could not complete reminder' }); }
    }
  };
  return <div class="todo-screen"><header class="screen-heading"><div><h1>To Do</h1><p>{active.length} {active.length === 1 ? 'reminder' : 'reminders'}</p></div><button class="text-button" onClick={() => void refresh()}>Refresh</button></header><div class="smart-lists" role="tablist">{(['today', 'scheduled', 'all', 'flagged'] as const).map(name => <button class={filter === name ? 'active' : ''} onClick={() => setFilter(name)}>{name[0].toUpperCase() + name.slice(1)}</button>)}</div>{status === 'offline' && <div class="state-banner">Showing saved reminders. Changes will retry when you reconnect.</div>}<div class="reminder-list">{visible.length ? visible.map(task => <article class={`reminder-row ${task.pending ? 'pending' : ''}`}><button class="reminder-toggle" aria-label={`Complete ${task.title}`} onClick={() => void complete(task)}>{task.completed ? '✓' : ''}</button><button class="reminder-main" onClick={() => setSelected(task)}><strong>{task.title}</strong><span>{task.dueAt ? date(task.dueAt) : task.notes || task.detail || 'Anytime'}</span></button>{task.flagged && <span class="task-flag">⚑</span>}</article>) : <Empty title="All clear" detail={filter === 'today' ? 'Nothing is due today.' : 'No reminders in this list.'}/>}</div><button class="new-reminder" onClick={() => setAdding(true)}><span>＋</span> New Reminder</button>{selected && <TaskSheet task={selected} onClose={() => setSelected(null)} onRefresh={refresh} onToast={onToast}/>} {adding && <QuickAdd onClose={() => setAdding(false)} onToast={onToast} onRefresh={refresh}/>}</div>;
}

function TaskSheet({ task, onClose, onRefresh, onToast }: { task: Task; onClose: () => void; onRefresh: () => Promise<unknown>; onToast: (next: Toast) => void }) {
  const [title, setTitle] = useState(task.title); const [notes, setNotes] = useState(task.notes || task.detail || ''); const [dueAt, setDueAt] = useState(task.dueAt?.slice(0, 10) || ''); const [flagged, setFlagged] = useState(Boolean(task.flagged)); const [saving, setSaving] = useState(false);
  const save = async (event: Event) => { event.preventDefault(); if (!title.trim()) return; setSaving(true); try { const action = await request<{ id: string }>('/v1/actions', { method: 'POST', body: JSON.stringify({ type: 'update_reminder', targetId: task.id, idempotencyKey: `update:${task.id}:${crypto.randomUUID()}`, payload: { source: task.source || 'Notion reminders', title: title.trim(), notes, dueAt: dueAt || null, flagged } }) }); const result = await request<{ status: string }>(`/v1/actions/${action.id}/commit`, { method: 'POST', body: '{}' }); if (result.status === 'failed') throw new Error('Lyra could not update this reminder.'); onToast({ text: 'Reminder updated' }); onClose(); await onRefresh(); } catch (error) { onToast({ text: error instanceof Error ? error.message : 'Reminder could not be updated.' }); } finally { setSaving(false); } };
  return <div class="sheet-backdrop" onClick={onClose}><form class="sheet task-sheet task-editor" onSubmit={save} onClick={event => event.stopPropagation()}><div class="sheet-handle"/><header><h2>Reminder</h2><button class="text-button" type="button" onClick={onClose}>Done</button></header><label>Title<input value={title} onInput={event => setTitle((event.target as HTMLInputElement).value)}/></label><label>Notes<textarea value={notes} onInput={event => setNotes((event.target as HTMLTextAreaElement).value)}/></label><label>Due date<input type="date" value={dueAt} onInput={event => setDueAt((event.target as HTMLInputElement).value)}/></label><label class="flag-toggle"><input type="checkbox" checked={flagged} onChange={() => setFlagged(value => !value)}/> Flagged</label><dl><dt>List</dt><dd>{task.list || 'Inbox'}</dd><dt>Source</dt><dd>{task.source || 'Lyra'}</dd></dl><button class="primary-button" disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button></form></div>;
}
function QuickAdd({ onClose, onToast, onRefresh }: { onClose: () => void; onToast: (next: Toast) => void; onRefresh: () => Promise<unknown> }) {
  const [title, setTitle] = useState(''); const [saving, setSaving] = useState(false);
  const save = async (event: Event) => {
    event.preventDefault(); if (!title.trim()) return; setSaving(true);
    const payload = { type: 'create_reminder', targetId: `new:${crypto.randomUUID()}`, idempotencyKey: crypto.randomUUID(), payload: { title: title.trim() } };
    try {
      const action = await request<{ id: string }>('/v1/actions', { method: 'POST', body: JSON.stringify(payload) });
      const result = await request<{ status: string }>(`/v1/actions/${action.id}/commit`, { method: 'POST', body: '{}' });
      if (result.status === 'failed') throw new Error('Lyra could not add this reminder.');
      onToast({ text: 'Reminder added' }); onClose(); await onRefresh();
    } catch (error) {
      if (!navigator.onLine || error instanceof TypeError) { await queueMutation({ id: payload.idempotencyKey, kind: 'action', payload }); onToast({ text: 'Reminder queued for sync' }); onClose(); }
      else onToast({ text: error instanceof Error ? error.message : 'Could not add reminder' });
    } finally { setSaving(false); }
  };
  return <div class="sheet-backdrop" onClick={onClose}><form class="sheet quick-add" onSubmit={save} onClick={event => event.stopPropagation()}><div class="sheet-handle"/><header><h2>New Reminder</h2><button class="text-button" type="button" onClick={onClose}>Cancel</button></header><input autoFocus value={title} onInput={event => setTitle((event.target as HTMLInputElement).value)} placeholder="What do you need to do?"/><button class="primary-button" disabled={saving}>{saving ? 'Adding…' : 'Add reminder'}</button></form></div>;
}

function NewsScreen({ data, status, refresh, setData, onAsk, onToast }: { data: News; status: Status; refresh: (force?: boolean) => Promise<unknown>; setData: (next: News) => void; onAsk: (item: NewsItem) => void; onToast: (next: Toast) => void }) {
  const [topic, setTopic] = useState('For you');
  const [selected, setSelected] = useState<NewsItem | null>(null);
  const topics = ['For you', ...(data.topics || [])];
  const items = data.items.filter(item => topic === 'For you' || item.topic === topic);
  const update = (id: string, patch: Partial<NewsItem>) => setData({ ...data, items: data.items.map(item => item.id === id ? { ...item, ...patch } : item) });
  const persistRead = (item: NewsItem) => { update(item.id, { read: true }); void request(`/v1/news/items/${encodeURIComponent(item.id)}/read`, { method: 'POST', body: '{}' }).catch(() => onToast({ text: 'Read state will retry when you reconnect.' })); };
  const toggleSaved = (item: NewsItem) => { const saved = !item.saved; update(item.id, { saved }); void request(`/v1/news/items/${encodeURIComponent(item.id)}/save`, { method: saved ? 'POST' : 'DELETE', body: '{}' }).catch(() => onToast({ text: 'Saved state will retry when you reconnect.' })); };
  return <div class="news-screen">
    <header class="screen-heading"><div><h1>News</h1><p>{data.refreshedAt ? `Updated ${clock(data.refreshedAt)}` : 'Your focused briefing'}</p></div><button class="text-button" onClick={() => void refresh(true)}>Refresh</button></header>
    {data.brief && <article class="news-lead"><p class="block-eyebrow">{data.brief.date || 'Morning brief'}</p><h2>{data.brief.title || 'Your briefing'}</h2><p>{data.brief.summary}</p>{data.brief.themes?.length ? <div class="topic-row">{data.brief.themes.map(theme => <span>{theme}</span>)}</div> : null}</article>}
    <div class="smart-lists news-topics">{topics.map(value => <button class={topic === value ? 'active' : ''} onClick={() => setTopic(value)}>{value}</button>)}</div>
    {(status === 'offline' || data.stale) && <div class="state-banner">Showing the last available brief.</div>}
    <div class="news-feed">{items.length ? items.map(item => <article class={`news-card ${item.read ? 'read' : ''}`}>
      <button class="news-main" onClick={() => { persistRead(item); setSelected({ ...item, read: true }); }}>
        {item.imageUrl && <img src={safeUrl(item.imageUrl)} alt="" loading="lazy" onError={event => { (event.currentTarget as HTMLImageElement).style.display = 'none'; }}/>}
        <div><p class="news-meta">{item.topic || 'Briefing'} · {item.source || 'Lyra'} · {clock(item.publishedAt)}</p><h2>{item.headline}</h2><p>{item.summary}</p>{item.whyItMatters && <p class="why"><strong>Why it matters</strong>{item.whyItMatters}</p>}</div>
      </button>
      <footer><button onClick={() => toggleSaved(item)}>{item.saved ? 'Saved' : 'Save'}</button><button onClick={() => void shareLyraContent({ title: item.headline, text: item.summary || '', url: item.sourceUrl }).then(() => onToast({ text: 'Shared' })).catch(() => undefined)}>Share</button>{item.sourceUrl && <a href={safeUrl(item.sourceUrl)} target="_blank" rel="noreferrer">Source ↗</a>}</footer>
    </article>) : <Empty title="Your brief is on its way" detail="No stories are available yet. Lyra will keep the last valid briefing here."/>}</div>
    {selected && <StorySheet item={selected} onClose={() => setSelected(null)} onAsk={() => { onAsk(selected); setSelected(null); }} onToast={onToast}/>}</div>;
}

function StorySheet({ item, onClose, onAsk, onToast }: { item: NewsItem; onClose: () => void; onAsk: () => void; onToast: (next: Toast) => void }) { return <div class="sheet-backdrop" onClick={onClose}><section class="sheet story-sheet" onClick={event => event.stopPropagation()}><div class="sheet-handle"/><header><p class="block-eyebrow">{item.topic || 'News'}</p><button class="text-button" onClick={onClose}>Done</button></header><h2>{item.headline}</h2><p>{item.summary}</p>{item.whyItMatters && <aside class="why"><strong>Why it matters</strong>{item.whyItMatters}</aside>}<h3>Sources</h3><div class="story-sources">{(item.sources?.length ? item.sources : [{ title: item.source, url: item.sourceUrl }]).map(source => safeUrl(source.url) ? <a href={safeUrl(source.url)} target="_blank" rel="noreferrer">{source.title || source.source || 'Open source'} ↗</a> : <span>{source.title || source.source}</span>)}</div><div class="sheet-actions"><button class="secondary-button" onClick={() => void shareLyraContent({ title: item.headline, text: item.summary || '', url: item.sourceUrl }).then(() => onToast({ text: 'Shared' })).catch(() => undefined)}>Share</button><button class="primary-button" onClick={onAsk}>Ask Lyra</button></div></section></div>; }

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/app/sw.js', { scope: '/app/' }).catch(() => undefined);
render(<App/>, document.getElementById('app')!);
