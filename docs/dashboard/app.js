/**
 * Lyra Eval Dashboard — Client-side rendering
 * Fetches static JSON data and renders charts + tables.
 */

const DATA_BASE = './data';
const CHART_COLORS = {
  accent: '#6366f1',
  accentLight: '#818cf8',
  green: '#22c55e',
  red: '#ef4444',
  yellow: '#eab308',
  blue: '#3b82f6',
  purple: '#a855f7',
  orange: '#f97316',
  teal: '#14b8a6',
  grid: 'rgba(255,255,255,0.06)',
  text: '#8888a0',
};

const TIER_CONFIG = {
  core_capability: { color: '#3b82f6', label: 'Core Capability', icon: 'T1', desc: '12 tests: memory, instructions, retrieval' },
  architectural: { color: '#a855f7', label: 'Architectural', icon: 'T2', desc: '10 tests: latency, tools, routing' },
  judgment: { color: '#f97316', label: 'Judgment & Safety', icon: 'T3', desc: '10 tests: ACL, safety, degradation' },
  showcase: { color: '#14b8a6', label: 'Showcase', icon: 'T4', desc: '8 tests: multi-step, proactive, edge cases' },
};

Chart.defaults.color = CHART_COLORS.text;
Chart.defaults.borderColor = CHART_COLORS.grid;
Chart.defaults.font.family = "'Inter', sans-serif";

async function fetchJSON(file) {
  try {
    const res = await fetch(`${DATA_BASE}/${file}`);
    if (!res.ok) return null;
    return res.json();
  } catch { return null; }
}

async function init() {
  const [summary, history, failures, architecture] = await Promise.all([
    fetchJSON('summary.json'),
    fetchJSON('history.json'),
    fetchJSON('failures.json'),
    fetchJSON('architecture.json'),
  ]);

  renderHeroStats(summary);
  renderTierBreakdown(summary);
  renderPassRateChart(history);
  renderCategoryChart(summary);
  renderLatencyChart(history);
  renderTierChart(summary);
  renderFailures(failures);
  renderArchitecture(architecture);
}

function renderHeroStats(summary) {
  if (!summary || summary.message) {
    document.getElementById('passRate').textContent = '\u2014';
    document.getElementById('totalTests').textContent = '0';
    document.getElementById('avgLatency').textContent = '\u2014';
    document.getElementById('p95Latency').textContent = '\u2014';
    document.getElementById('lastUpdated').textContent = 'No eval runs yet';
    return;
  }

  const passRate = Math.round((summary.pass_rate || 0) * 100);
  document.getElementById('passRate').textContent = `${passRate}%`;
  document.getElementById('totalTests').textContent = summary.total_tests || 0;
  document.getElementById('avgLatency').textContent = formatLatency(summary.avg_latency_ms);
  document.getElementById('p95Latency').textContent = formatLatency(summary.p95_latency_ms);

  // Color the pass rate card
  const card = document.querySelector('.stat-card.primary');
  if (passRate >= 90) card.style.background = 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)';
  else if (passRate >= 70) card.style.background = 'linear-gradient(135deg, #eab308 0%, #ca8a04 100%)';
  else card.style.background = 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)';

  if (summary.timestamp) {
    const date = new Date(summary.timestamp);
    document.getElementById('lastUpdated').textContent =
      `Last run: ${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} at ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} UTC`;
  }
}

function formatLatency(ms) {
  if (!ms) return '\u2014';
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${ms}ms`;
}

function renderTierBreakdown(summary) {
  const grid = document.getElementById('tierGrid');
  if (!summary || !summary.by_tier) {
    grid.innerHTML = '<p class="empty-state">No tier data yet</p>';
    return;
  }

  grid.innerHTML = Object.entries(TIER_CONFIG).map(([key, config]) => {
    const data = summary.by_tier[key] || { total: 0, passed: 0 };
    const passRate = data.total > 0 ? Math.round((data.passed / data.total) * 100) : 0;
    const barColor = passRate >= 80 ? '#22c55e' : passRate >= 60 ? '#eab308' : '#ef4444';

    return `
      <div class="tier-card">
        <div class="tier-badge" style="background:${config.color}">${config.icon}</div>
        <div class="tier-info" style="flex:1">
          <h4>${config.label}</h4>
          <div class="tier-stats">
            <span class="pass-count">${data.passed} passed</span>
            <span class="fail-count">${data.total - data.passed} failed</span>
            <span>${passRate}%</span>
          </div>
          <div class="tier-bar">
            <div class="tier-bar-fill" style="width:${passRate}%;background:${barColor}"></div>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function renderPassRateChart(history) {
  const canvas = document.getElementById('passRateChart');
  if (!history || history.length === 0) {
    canvas.style.display = 'none';
    document.getElementById('passRateEmpty').style.display = 'block';
    return;
  }

  const labels = history.map((h) => h.date);
  const overall = history.map((h) => Math.round((h.pass_rate || 0) * 100));

  const datasets = [
    {
      label: 'Overall',
      data: overall,
      borderColor: CHART_COLORS.accent,
      backgroundColor: 'rgba(99, 102, 241, 0.1)',
      borderWidth: 2.5,
      fill: true,
      tension: 0.3,
      pointRadius: 4,
      pointBackgroundColor: CHART_COLORS.accent,
    },
  ];

  // Per-tier trend lines
  const tiers = {};
  for (const h of history) {
    if (!h.by_tier) continue;
    for (const [tier, data] of Object.entries(h.by_tier)) {
      if (!tiers[tier]) tiers[tier] = [];
      tiers[tier].push(Math.round((data.pass_rate || 0) * 100));
    }
  }

  for (const [tier, data] of Object.entries(tiers)) {
    const config = TIER_CONFIG[tier];
    if (!config) continue;
    datasets.push({
      label: config.label,
      data: data,
      borderColor: config.color,
      borderWidth: 1.5,
      borderDash: [5, 5],
      tension: 0.3,
      pointRadius: 2,
    });
  }

  new Chart(canvas, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      plugins: { legend: { position: 'bottom', labels: { padding: 16, usePointStyle: true } } },
      scales: {
        y: { min: 0, max: 100, ticks: { callback: (v) => v + '%' } },
        x: { ticks: { maxRotation: 45 } },
      },
    },
  });
}

function renderCategoryChart(summary) {
  const canvas = document.getElementById('categoryChart');
  if (!summary || !summary.by_category || Object.keys(summary.by_category).length === 0) {
    canvas.style.display = 'none';
    document.getElementById('categoryEmpty').style.display = 'block';
    return;
  }

  const categories = Object.entries(summary.by_category).sort((a, b) => b[1].pass_rate - a[1].pass_rate);
  const labels = categories.map(([k]) => k.replace(/_/g, ' '));
  const passed = categories.map(([, v]) => v.passed);
  const failed = categories.map(([, v]) => v.total - v.passed);

  new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Passed', data: passed, backgroundColor: CHART_COLORS.green, borderRadius: 4 },
        { label: 'Failed', data: failed, backgroundColor: CHART_COLORS.red, borderRadius: 4 },
      ],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      plugins: { legend: { position: 'bottom', labels: { padding: 16, usePointStyle: true } } },
      scales: {
        x: { stacked: true, beginAtZero: true },
        y: { stacked: true, ticks: { font: { size: 11 } } },
      },
    },
  });
}

function renderLatencyChart(history) {
  const canvas = document.getElementById('latencyChart');
  if (!history || history.length === 0) {
    canvas.style.display = 'none';
    document.getElementById('latencyEmpty').style.display = 'block';
    return;
  }

  const labels = history.map((h) => h.date);
  const avg = history.map((h) => h.avg_latency_ms || 0);
  const p95 = history.map((h) => h.p95_latency_ms || 0);

  new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Avg Latency',
          data: avg,
          borderColor: CHART_COLORS.blue,
          backgroundColor: 'rgba(59, 130, 246, 0.1)',
          borderWidth: 2,
          fill: true,
          tension: 0.3,
          pointRadius: 4,
          pointBackgroundColor: CHART_COLORS.blue,
        },
        {
          label: 'P95 Latency',
          data: p95,
          borderColor: CHART_COLORS.orange,
          borderWidth: 2,
          borderDash: [5, 5],
          tension: 0.3,
          pointRadius: 3,
        },
      ],
    },
    options: {
      responsive: true,
      plugins: { legend: { position: 'bottom', labels: { padding: 16, usePointStyle: true } } },
      scales: {
        y: { beginAtZero: true, ticks: { callback: (v) => formatLatency(v) } },
        x: { ticks: { maxRotation: 45 } },
      },
    },
  });
}

function renderTierChart(summary) {
  const canvas = document.getElementById('tierChart');
  if (!summary || !summary.by_tier || Object.keys(summary.by_tier).length === 0) {
    canvas.style.display = 'none';
    document.getElementById('tierEmpty').style.display = 'block';
    return;
  }

  const tiers = Object.entries(summary.by_tier);
  const labels = tiers.map(([k]) => (TIER_CONFIG[k]?.label || k).replace(/_/g, ' '));
  const passRates = tiers.map(([, v]) => Math.round((v.pass_rate || 0) * 100));
  const colors = tiers.map(([k]) => TIER_CONFIG[k]?.color || CHART_COLORS.accent);

  new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data: passRates,
        backgroundColor: colors,
        borderColor: '#12121a',
        borderWidth: 3,
      }],
    },
    options: {
      responsive: true,
      cutout: '60%',
      plugins: {
        legend: { position: 'bottom', labels: { padding: 12, usePointStyle: true, font: { size: 12 } } },
        tooltip: { callbacks: { label: (ctx) => `${ctx.label}: ${ctx.raw}% pass rate` } },
      },
    },
  });
}

function renderFailures(failures) {
  const tbody = document.getElementById('failuresBody');
  const subtitle = document.getElementById('failuresSubtitle');

  if (!failures || failures.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty-state">All tests passing!</td></tr>';
    subtitle.textContent = '';
    return;
  }

  subtitle.textContent = `(${failures.length} from recent runs)`;

  tbody.innerHTML = failures.map((f) => {
    const isTimeout = (f.error || '').includes('Timeout');
    const isJudge = (f.error || '').includes('Judge');
    const errorClass = isTimeout ? 'timeout' : isJudge ? 'judge-fail' : '';

    return `
      <tr>
        <td>${f.date || '\u2014'}</td>
        <td><strong>${f.name || f.id}</strong></td>
        <td>${(f.category || '').replace(/_/g, ' ')}</td>
        <td><span class="error-text ${errorClass}" title="${escapeAttr(f.error || '')}">${escapeHtml((f.error || '\u2014').slice(0, 100))}</span></td>
        <td>${formatLatency(f.latency_ms)}</td>
      </tr>
    `;
  }).join('');
}

function renderArchitecture(arch) {
  const grid = document.getElementById('archGrid');
  if (!arch) {
    grid.innerHTML = '<p class="empty-state">Architecture info not available</p>';
    return;
  }

  const items = [
    { label: 'Server', value: `${arch.server?.provider} ${arch.server?.type} (${arch.server?.ram})` },
    { label: 'Location', value: arch.server?.location },
    { label: 'OS', value: arch.server?.os },
    { label: 'Framework', value: `${arch.framework?.name} ${arch.framework?.version}` },
    { label: 'Default Model', value: arch.models?.default },
    { label: 'Fallback Model', value: arch.models?.fallback },
    { label: 'Escalation Model', value: arch.models?.escalation },
    { label: 'Channels', value: arch.channels?.join(', ') },
    { label: 'Databases', value: `${arch.databases?.count} Notion databases` },
    { label: 'Cron Jobs', value: `${arch.cron_jobs} scheduled tasks` },
    { label: 'Persistence', value: arch.persistence },
    { label: 'Monitoring', value: arch.monitoring },
    { label: 'Monthly Cost', value: arch.monthly_cost },
  ];

  grid.innerHTML = items
    .filter((i) => i.value)
    .map((i) => `
      <div class="arch-item">
        <div class="arch-item-label">${i.label}</div>
        <div class="arch-item-value">${i.value}</div>
      </div>
    `).join('');
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str) {
  return str.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Init
document.addEventListener('DOMContentLoaded', init);
