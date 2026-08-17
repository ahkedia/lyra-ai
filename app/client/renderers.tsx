import { useState } from 'preact/hooks';

export type LyraAction = {
  id: string;
  label: string;
  actionType: string;
  targetId?: string;
  payload?: Record<string, unknown>;
  disabledReason?: string;
  status?: 'available' | 'disabled' | 'pending' | 'completed' | 'failed' | 'undone';
  requiresConfirmation?: boolean;
};

export type Provenance = {
  id: string;
  title?: string;
  source?: string;
  url?: string;
  asOf?: string;
  freshness?: string;
  confidence?: string;
};

export type LyraBlock = Record<string, any> & { id: string; type: string };
export type LyraEnvelope = { blocks: LyraBlock[]; actions: LyraAction[]; provenance: Provenance[] };

export type RenderContext = {
  envelope: LyraEnvelope;
  onAction?: (action: LyraAction) => Promise<void>;
  onQuestionAnswer?: (block: LyraBlock, answers: Record<string, string | string[]>) => Promise<void>;
  onShare?: (title: string, text: string, url?: string) => Promise<void>;
};

const safeUrl = (value?: string) => {
  try {
    const url = new URL(value || '');
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : undefined;
  } catch { return undefined; }
};

const escape = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] || char));
const renderMarkdown = (value: string) => escape(value)
  .replace(/^## (.+)$/gm, '<h2>$1</h2>')
  .replace(/^### (.+)$/gm, '<h3>$1</h3>')
  .replace(/`([^`]+)`/g, '<code>$1</code>')
  .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
  .replace(/\n/g, '<br>');

function Sources({ refs, context }: { refs?: string[]; context: RenderContext }) {
  const sources = (refs || []).map(ref => context.envelope.provenance.find(source => source.id === ref)).filter(Boolean) as Provenance[];
  if (!sources.length) return null;
  return <ol class="source-chips" aria-label="Sources">{sources.map(source => {
    const url = safeUrl(source.url);
    const label = source.source && source.title ? `${source.source} — ${source.title}` : source.title || source.source || 'Source';
    return <li>{url ? <a class="source-chip" href={url} target="_blank" rel="noreferrer">{label}<span aria-hidden="true">↗</span></a> : <span class="source-chip">{label}</span>}{source.asOf && <time dateTime={source.asOf}>{new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(source.asOf))}</time>}</li>;
  })}</ol>;
}

function ActionButton({ action, context }: { action: LyraAction; context: RenderContext }) {
  const [running, setRunning] = useState(false);
  const unavailable = running || action.status === 'disabled' || action.status === 'pending';
  const run = async () => {
    if (unavailable || !context.onAction) return;
    setRunning(true);
    try { await context.onAction(action); } finally { setRunning(false); }
  };
  const status = running ? 'Working…' : action.status === 'completed' ? 'Completed' : action.status === 'undone' ? 'Undone' : action.status === 'failed' ? 'Try again' : action.label;
  return <button class={`rich-action ${action.status || 'available'}`} data-action-status={action.status || 'available'} disabled={unavailable} onClick={() => void run()}>{status}{action.disabledReason ? ` — ${action.disabledReason}` : ''}</button>;
}

function Checklist({ block, context }: { block: LyraBlock; context: RenderContext }) {
  return <section class="rich-block checklist-block">{block.title && <h3>{block.title}</h3>}{(block.items || []).map((item: any) => {
    const action = item.actionId ? context.envelope.actions.find(candidate => candidate.id === item.actionId) : undefined;
    return <label class={`check-row ${item.checked ? 'checked' : ''}`}>
      <input type="checkbox" role="checkbox" aria-checked={Boolean(item.checked)} checked={Boolean(item.checked)} onChange={() => action && context.onAction?.(action)} disabled={!action || action.status === 'pending'}/>
      <span class="check-indicator" aria-hidden="true">{item.checked ? '✓' : ''}</span><span>{item.label}</span>
    </label>;
  })}<Sources refs={block.sourceRefs} context={context}/></section>;
}

function Chart({ block, context }: { block: LyraBlock; context: RenderContext }) {
  const points = (block.series || []).flatMap((series: any) => (series.points || []).map((point: any) => ({ ...point, series: series.label || series.name || '' })));
  const max = Math.max(1, ...points.map((point: any) => Math.abs(Number(point.value) || 0)));
  return <figure class="rich-block chart-block" data-chart-type={block.chartType}><figcaption><strong>{block.title || 'Chart'}</strong>{block.summary && <span>{block.summary}</span>}</figcaption><svg role="img" aria-label={block.summary || block.title || 'Chart data'} viewBox="0 0 100 12" preserveAspectRatio="none"><rect width="100" height="12" fill="currentColor" opacity=".08"/></svg>
    <div class="chart-bars" role="img" aria-label={block.summary || block.title || 'Chart data'}>{points.map((point: any) => <div class="chart-row"><span>{point.label}</span><span class="chart-track"><span class="chart-fill" style={{ width: `${Math.max(2, Math.round(Math.abs(Number(point.value) || 0) / max * 100))}%` }}/></span><strong>{point.value}</strong></div>)}</div>
    <details><summary>View data</summary><table><tbody>{points.map((point: any) => <tr><th>{point.series ? `${point.series} · ` : ''}{point.label}</th><td>{point.value}</td></tr>)}</tbody></table></details><Sources refs={block.sourceRefs} context={context}/>
  </figure>;
}

function Media({ block, context }: { block: LyraBlock; context: RenderContext }) {
  const [failed, setFailed] = useState(false); const url = safeUrl(block.url);
  if (!url) return <aside class="rich-block callout warning">Media is unavailable.</aside>;
  const type = block.type === 'image' ? 'image' : block.mediaType;
  const body = failed ? <div data-media-error="true">{block.caption || block.title || 'Media unavailable'}</div> : type === 'audio' ? <audio controls src={url} onError={() => setFailed(true)}/> : type === 'video' ? <video controls src={url} onError={() => setFailed(true)}/> : type === 'image' ? <img src={url} alt={block.alt || block.title || 'Lyra media'} loading="lazy" onError={() => setFailed(true)}/> : <a class="file-card" href={url} target="_blank" rel="noreferrer"><span>↗</span><span><strong>{block.title || 'Open file'}</strong><small>{block.caption || 'Opens in a new window'}</small></span></a>;
  return <figure class="rich-block media-block" role={type === 'audio' || type === 'video' ? 'group' : undefined} aria-label={block.title}>{body}{(block.caption || (type !== 'file' && block.title)) && <figcaption>{block.caption || block.title}</figcaption>}<Sources refs={block.sourceRefs || (block.sourceRef ? [block.sourceRef] : [])} context={context}/></figure>;
}

function QuestionForm({ block, context }: { block: LyraBlock; context: RenderContext }) {
  const [answers, setAnswers] = useState<Record<string, string | string[]>>(block.answers || {});
  const [submitting, setSubmitting] = useState(false);
  const isClosed = block.status !== 'pending';
  const visible = (field: any) => {
    if (!field.when) return true;
    const actual = String(answers[field.when.questionId] || '').toLowerCase();
    const expected = String(field.when.value || '').toLowerCase();
    return field.when.operator === 'not_equals' ? actual !== expected : actual === expected;
  };
  const submit = async (event: Event) => {
    event.preventDefault();
    if (!context.onQuestionAnswer || isClosed) return;
    setSubmitting(true);
    try { await context.onQuestionAnswer(block, answers); } finally { setSubmitting(false); }
  };
  return <form class="rich-block question-form" data-question-id={block.questionId} onSubmit={submit}><h3>{block.preview}</h3>{(block.questions || []).filter(visible).map((field: any) => <fieldset data-question-field={field.id} disabled={isClosed || submitting}><legend>{field.label}{field.optional ? <small> Optional</small> : null}</legend>{field.inputType === 'free_text' ? <textarea aria-label={field.label} placeholder={field.placeholder} value={String(answers[field.id] || '')} onInput={event => setAnswers({ ...answers, [field.id]: (event.target as HTMLTextAreaElement).value })}/> : <div class="question-options" role={field.inputType === 'single_select' ? 'radiogroup' : undefined} aria-label={field.label}>{(field.options || []).map((option: any) => { const value = option.id || option.label || option; const selected = Array.isArray(answers[field.id]) ? answers[field.id].includes(value) : answers[field.id] === value; return <label><input type={field.inputType === 'multi_select' ? 'checkbox' : 'radio'} name={field.id} value={value} checked={selected} onChange={() => setAnswers({ ...answers, [field.id]: field.inputType === 'multi_select' ? (selected ? (answers[field.id] as string[]).filter(item => item !== value) : [...(Array.isArray(answers[field.id]) ? answers[field.id] : []), value]) : value })}/><span>{option.label || option}</span></label>; })}</div>}</fieldset>)}{isClosed ? <p class="muted">{block.status === 'expired' ? 'This question has expired.' : 'Answer recorded.'}</p> : <button class="rich-action primary" data-action-id={block.submitActionId} type="submit" disabled={submitting}>{submitting ? 'Sending…' : 'Send answer'}</button>}</form>;
}

function Briefing({ block, context }: { block: LyraBlock; context: RenderContext }) {
  return <><header class="briefing-header"><h2>{block.title}</h2>{block.subtitle && <p>{block.subtitle}</p>}</header>{(block.sections || []).map((section: any) => <section class="briefing-section"><h3>{section.title}</h3><BlockList blocks={section.blocks || []} context={context}/></section>)}</>;
}

export function BlockList({ blocks, context }: { blocks: LyraBlock[]; context: RenderContext }) {
  return <>{blocks.map(block => <Block key={block.id} block={block} context={context}/>)}</>;
}

export function Block({ block, context }: { block: LyraBlock; context: RenderContext }) {
  const sources = <Sources refs={block.sourceRefs} context={context}/>;
  let content;
  if (block.type === 'rich_text') content = <div class="rich-text" dangerouslySetInnerHTML={{ __html: renderMarkdown(block.markdown || '') }} />;
  else if (block.type === 'bullet_list' || block.type === 'numbered_list') { const Tag = block.type === 'bullet_list' ? 'ul' : 'ol'; content = <><Tag class="rich-list">{(block.items || []).map((item: any) => <li>{typeof item === 'string' ? item : item.label}</li>)}</Tag>{sources}</>; }
  else if (block.type === 'checklist') content = <Checklist block={block} context={context}/>;
  else if (block.type === 'callout') content = <aside class={`callout ${block.tone || 'info'}`} data-tone={block.tone || 'info'} role={block.tone === 'error' ? 'alert' : 'status'}><strong>{block.title}</strong><p>{block.body}</p>{sources}</aside>;
  else if (block.type === 'metric_group') content = <><h3>{block.title}</h3><dl class="metrics-block">{(block.metrics || []).map((metric: any) => <div data-trend={metric.trend || (String(metric.delta || '').includes('↑') ? 'up' : undefined)}><dt>{metric.label}</dt><dd>{metric.value}{metric.unit ? ` ${metric.unit}` : ''}{metric.delta !== undefined && metric.delta !== '' && <small>{metric.trend === 'up' ? '↑ ' : metric.trend === 'down' ? '↓ ' : ''}{metric.delta}</small>}</dd></div>)}</dl>{sources}</>;
  else if (block.type === 'chart') content = <Chart block={block} context={context}/>;
  else if (block.type === 'table') content = <><h3>{block.title}</h3><div class="table-wrap"><table aria-label={block.title}><thead><tr>{(block.columns || []).map((column: any) => <th>{column.label || column}</th>)}</tr></thead><tbody>{(block.rows || []).map((row: any) => <tr>{(block.columns || []).map((column: any, index: number) => <td>{Array.isArray(row) ? row[index] : row[column.key || column]}</td>)}</tr>)}</tbody></table></div>{sources}</>;
  else if (block.type === 'image' || block.type === 'media') content = <Media block={block} context={context}/>;
  else if (block.type === 'source_list') content = <><h3>{block.title || 'Sources'}</h3><Sources refs={block.sourceRefs} context={context}/></>;
  else if (block.type === 'action_group') content = <><h3>{block.title || 'Actions'}</h3><div class="action-group">{(block.actionRefs || []).map((ref: string) => context.envelope.actions.find(action => action.id === ref)).filter(Boolean).map((action: LyraAction) => <ActionButton action={action} context={context}/>)}</div></>;
  else if (block.type === 'briefing') content = <Briefing block={block} context={context}/>;
  else if (block.type === 'news_brief') content = <><header><p class="block-eyebrow">{block.date || 'Morning brief'}</p><h2>{block.title}</h2><p>{block.summary}</p></header>{(block.themes || []).length ? <div class="topic-row">{block.themes.map((theme: string) => <span data-topic={theme}>{theme}</span>)}</div> : null}{(block.items || []).map((item: any) => <article data-news-item-id={item.id} aria-label={item.headline}><span data-topic={item.topic || 'News'}>{item.topic || 'News'}</span>{item.image && <img src={safeUrl(item.image.url)} alt={item.image.alt || ''}/>}<h3>{item.headline}</h3><p>{item.summary}</p>{item.whyItMatters && <p><strong>Why it matters</strong>{item.whyItMatters}</p>}<small data-source-count={(item.sourceRefs || []).length}>{(item.sourceRefs || []).length > 1 ? `${item.sourceRefs.length} sources` : 'Source'}</small></article>)}</>;
  else if (block.type === 'task_snapshot') content = <><h3>{block.title}</h3>{(block.tasks || []).map((task: any) => <div data-task-id={task.id} data-sync-status={task.status} role="checkbox" aria-checked={Boolean(task.completed)} class={task.completed ? 'done' : ''}><span>{task.completed ? '✓' : '○'}</span><span>{task.title || task.label}</span>{task.dueAt && <time dateTime={task.dueAt}>{new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(task.dueAt))}</time>}{task.status === 'stale' && <small>Stale</small>}</div>)}</>;
  else if (block.type === 'question_form') content = <QuestionForm block={block} context={context}/>;
  else if (block.type === 'code') content = <section class="code-block"><header><span>{block.language || 'text'}</span><button data-copy-code aria-label="Copy code" onClick={() => navigator.clipboard?.writeText(block.code || '')}>Copy</button></header><pre><code data-language={block.language}>{block.code}</code></pre></section>;
  else content = <aside class="callout warning"><strong>Unsupported Lyra content</strong><p>This update is available in a safe text form.</p></aside>;
  return <section class={`rich-block block-${block.type}`} data-block-id={block.id} data-block-type={block.type} data-question-status={block.type === 'question_form' ? block.status : undefined}>{content}</section>;
}

export function envelopeText(envelope: LyraEnvelope) {
  return envelope.blocks.map(block => block.markdown || block.body || block.summary || block.title || '').filter(Boolean).join('\n\n').slice(0, 1200);
}
