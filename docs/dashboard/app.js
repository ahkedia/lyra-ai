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

const TIER_COLORS = {
  core_capability: CHART_COLORS.blue,
  architectural: CHART_COLORS.purple,
  judgment: CHART_COLORS.orange,
  showcase: CHART_COLORS.teal,
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
  renderPassRateChart(history);
  renderCategoryChart(summary);
  renderLatencyChart(history);
  renderTierChart(summary);
  renderFailures(failures);
  renderArchitecture(architecture);
}

function renderHeroStats(summary) {
  if (!summary || summary.message) {
    document.getElementById('passRate').textContent = '—';
    document.getElementById('totalTests').textContent = '0';
    document.getElementById('avgLatency').textContent = '—';
    document.getElementById('p95Latency').textContent = '—';
    document.getElementById('lastUpdated').textContent = 'No eval runs yet';
    return;
  }

  const passRate = Math.round((summary.pass_rate || 0) * 100);
  document.getElementById('passRate').textContent = `${passRate}%`;
  document.getElementById('totalTests').textContent = summary.total_tests || 0;
  document.getElementById('avgLatency').textContent = `${summary.avg_latency_ms || 0}ms`;
  document.getElementById('p95Latency').textContent = `${summary.p95_latency_ms || 0}ms`;

  // Color the pass rate card
  const card = document.querySelector('.stat-card.primary');
  if (passRate >= 90) card.style.background = 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)';
  else if (passRate >= 70) card.style.background = 'linear-gradient(135deg, #eab308 0%, #ca8a04 100%)';
  else card.style.background = 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)';

  if (summary.timestamp) {
    const date = new Date(summary.timestamp);
    document.getElementById('lastUpdated').textContent =
      `Last run: ${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  }
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

  // Per-tier data
  const tiers = {};
  for (const h of history) {
    if (!h.by_tier) continue;
    for (const [tier, data] of Object.entries(h.by_tier)) {
      if (!tiers[tier]) tiers[tier] = [];
      tiers[tier].push(Math.round((data.pass_rate || 0) * 100));
    }
  }

  const datasets = [
    {
      label: 'Overall',
      data: overall,
      borderColor: CHART_COLORS.accent,
      backgroundColor: 'rgba(99, 102, 241, 0.1)',
      borderWidth: 2,
      fill: true,
      tension: 0.3,
    },
  ];

  for (const [tier, data] of Object.entries(tiers)) {
    datasets.push({
      label: tier.replace(/_/g, ' '),
      data: data,
      borderColor: TIER_COLORS[tier] || CHART_COLORS.text,
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

  const categories = Object.entries(summary.by_category);
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
      responsive: true,
      plugins: { legend: { position: 'bottom', labels: { padding: 16, usePointStyle: true } } },
      scales: {
        x: { stacked: true, ticks: { maxRotation: 45, font: { size: 11 } } },
        y: { stacked: true, beginAtZero: true },
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
        },
        {
          label: 'P95 Latency',
          data: p95,
          borderColor: CHART_COLORS.orange,
          borderWidth: 2,
          borderDash: [5, 5],
          tension: 0.3,
        },
      ],
    },
    options: {
      responsive: true,
      plugins: { legend: { position: 'bottom', labels: { padding: 16, usePointStyle: true } } },
      scales: {
        y: { beginAtZero: true, ticks: { callback: (v) => v + 'ms' } },
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
  const labels = tiers.map(([k]) => k.replace(/_/g, ' '));
  const passRates = tiers.map(([, v]) => Math.round((v.pass_rate || 0) * 100));
  const colors = tiers.map(([k]) => TIER_COLORS[k] || CHART_COLORS.accent);

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
      plugins: {
        legend: { position: 'bottom', labels: { padding: 12, usePointStyle: true } },
        tooltip: { callbacks: { label: (ctx) => `${ctx.label}: ${ctx.raw}% pass rate` } },
      },
    },
  });
}

function renderFailures(failures) {
  const tbody = document.getElementById('failuresBody');
  if (!failures || failures.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty-state">No failures recorded yet. All tests passing!</td></tr>';
    return;
  }

  tbody.innerHTML = failures.map((f) => `
    <tr>
      <td>${f.date || '—'}</td>
      <td><strong>${f.name || f.id}</strong></td>
      <td>${(f.category || '').replace(/_/g, ' ')}</td>
      <td style="max-width:300px;overflow:hidden;text-overflow:ellipsis">${escapeHtml(f.error || '—')}</td>
      <td>${f.latency_ms || 0}ms</td>
    </tr>
  `).join('');
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
    { label: 'Framework', value: `${arch.framework?.name} ${arch.framework?.version}` },
    { label: 'Default Model', value: arch.models?.default },
    { label: 'Fallback', value: arch.models?.fallback },
    { label: 'Escalation', value: arch.models?.escalation },
    { label: 'Channels', value: arch.channels?.join(', ') },
    { label: 'Databases', value: `${arch.databases?.count} (${arch.databases?.engine})` },
    { label: 'Cron Jobs', value: arch.cron_jobs },
    { label: 'Persistence', value: arch.persistence },
    { label: 'Monitoring', value: arch.monitoring },
    { label: 'Backup', value: arch.backup },
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

// Init
document.addEventListener('DOMContentLoaded', init);
