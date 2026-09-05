/* 管理后台逻辑
 * - 登录（POST /api/admin/login）→ 后端种 HttpOnly session cookie
 * - 拉取统计 / 明细
 * - 渲染 4 个 Chart.js 图（雷达 / 趋势 / 各题 / 护理员排名）
 * - 筛选 + 导出 CSV
 */

(function () {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const API = {
    login: '/api/admin/login',
    logout: '/api/admin/logout',
    stats: '/api/admin/stats',
    submissions: '/api/admin/submissions',
    export: '/api/admin/export',
    session: '/api/admin/session',
  };

  let radarChart, trendChart, questionChart, caregiverChart;

  // ===== 工具 =====
  function fmt(n, d = 2) {
    if (n == null || isNaN(n)) return '—';
    return Number(n).toFixed(d);
  }
  function fmtInt(n) { return n == null ? '—' : Number(n).toLocaleString('zh-CN'); }

  function scoreClass(v) {
    if (v == null || isNaN(v)) return '';
    if (v >= 4.0) return 'score-good';
    if (v >= 3.0) return 'score-warn';
    return 'score-bad';
  }
  function kpiClass(v) {
    if (v == null || isNaN(v)) return '';
    if (v >= 4.0) return 'good';
    if (v >= 3.0) return 'warn';
    return 'bad';
  }

  async function api(url, opts = {}) {
    const res = await fetch(url, { credentials: 'same-origin', ...opts });
    if (res.status === 401) {
      showLogin();
      throw new Error('未登录');
    }
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `请求失败（${res.status}）`);
    }
    return res.json();
  }

  // ===== 视图切换 =====
  function showLogin() {
    $('#dashboardView').classList.add('hidden');
    $('#loginView').classList.remove('hidden');
    $('#loginPwd').value = '';
    $('#loginError').hidden = true;
    $('#loginPwd').focus();
  }
  function showDashboard() {
    $('#loginView').classList.add('hidden');
    $('#dashboardView').classList.remove('hidden');
  }

  // ===== 登录 =====
  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const pwd = $('#loginPwd').value;
    const btn = e.target.querySelector('button');
    btn.disabled = true;
    $('#loginError').hidden = true;
    try {
      await api(API.login, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password: pwd }),
      });
      showDashboard();
      await loadAll();
    } catch (err) {
      $('#loginError').textContent = err.message;
      $('#loginError').hidden = false;
    } finally {
      btn.disabled = false;
    }
  });

  // ===== 退出 =====
  $('#logoutBtn').addEventListener('click', async () => {
    try { await api(API.logout, { method: 'POST' }); } catch (_) {}
    showLogin();
  });

  // ===== 刷新 =====
  $('#refreshBtn').addEventListener('click', loadAll);

  // ===== 筛选 =====
  $('#applyFilter').addEventListener('click', loadAll);
  $('#resetFilter').addEventListener('click', () => {
    $('#filterStart').value = '';
    $('#filterEnd').value = '';
    $('#filterCaregiver').value = '';
    loadAll();
  });

  // ===== 导出 =====
  $('#exportBtn').addEventListener('click', () => {
    const qs = buildFilterQS();
    window.location.href = `${API.export}${qs}`;
  });

  function buildFilterQS() {
    const params = new URLSearchParams();
    const s = $('#filterStart').value;
    const e = $('#filterEnd').value;
    const c = $('#filterCaregiver').value;
    if (s) params.set('start', s);
    if (e) params.set('end', e);
    if (c) params.set('caregiver', c);
    const s2 = params.toString();
    return s2 ? `?${s2}` : '';
  }

  // ===== 加载所有数据 =====
  async function loadAll() {
    try {
      const qs = buildFilterQS();
      const [stats, subs] = await Promise.all([
        api(API.stats + qs),
        api(API.submissions + qs + (qs ? '&' : '?') + 'limit=50'),
      ]);
      renderKPI(stats);
      renderCaregiverFilter(stats.caregivers || []);
      renderCharts(stats);
      renderTable(subs.items || []);
      $('#lastUpdated').textContent = `更新时间：${new Date().toLocaleString('zh-CN')}`;
    } catch (e) {
      console.error(e);
      alert('加载失败：' + e.message);
    }
  }

  // ===== 渲染 KPI =====
  function renderKPI(s) {
    $('#kpiTotal').textContent = fmtInt(s.total);
    const overall = s.overall;
    const ovEl = $('#kpiOverall');
    ovEl.textContent = fmt(overall);
    ovEl.className = 'kpi-value ' + kpiClass(overall);
    [['#kpiPro', s.professionalism], ['#kpiAtt', s.attitude], ['#kpiEff', s.efficiency], ['#kpiEmo', s.emotion]]
      .forEach(([sel, v]) => {
        const el = $(sel);
        el.textContent = fmt(v);
        el.className = 'kpi-value ' + kpiClass(v);
      });
  }

  function renderCaregiverFilter(list) {
    const sel = $('#filterCaregiver');
    const cur = sel.value;
    sel.innerHTML = '<option value="">全部</option>' +
      list.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
    if (cur && list.includes(cur)) sel.value = cur;
  }

  // ===== 渲染图表 =====
  function renderCharts(s) {
    // 1. 雷达
    const radarData = {
      labels: ['专业性', '服务态度', '服务效率', '情感体验'],
      datasets: [{
        label: '平均分',
        data: [s.professionalism, s.attitude, s.efficiency, s.emotion].map((v) => Number(v.toFixed(2))),
        backgroundColor: 'rgba(37, 99, 235, 0.18)',
        borderColor: '#2563eb',
        pointBackgroundColor: '#2563eb',
      }],
    };
    const radarOpts = {
      responsive: true, maintainAspectRatio: false,
      scales: { r: { suggestedMin: 0, suggestedMax: 5, ticks: { stepSize: 1 } } },
      plugins: { legend: { display: false } },
    };
    if (radarChart) radarChart.destroy();
    radarChart = new Chart($('#radarChart'), { type: 'radar', data: radarData, options: radarOpts });

    // 2. 趋势
    const trend = s.trend || [];
    const trendData = {
      labels: trend.map((t) => t.date),
      datasets: [
        { label: '专业性', data: trend.map((t) => t.professionalism), borderColor: '#2563eb', tension: 0.3, spanGaps: true },
        { label: '态度',   data: trend.map((t) => t.attitude),        borderColor: '#10b981', tension: 0.3, spanGaps: true },
        { label: '效率',   data: trend.map((t) => t.efficiency),      borderColor: '#f59e0b', tension: 0.3, spanGaps: true },
        { label: '情感',   data: trend.map((t) => t.emotion),         borderColor: '#ec4899', tension: 0.3, spanGaps: true },
      ],
    };
    const trendOpts = {
      responsive: true, maintainAspectRatio: false,
      scales: { y: { suggestedMin: 0, suggestedMax: 5 } },
      plugins: { legend: { position: 'bottom' } },
    };
    if (trendChart) trendChart.destroy();
    trendChart = new Chart($('#trendChart'), { type: 'line', data: trendData, options: trendOpts });

    // 3. 各题均分
    const qAvg = s.questionAverages || [];
    const qData = {
      labels: qAvg.map((_, i) => `Q${i + 1}`),
      datasets: [{
        label: '平均分',
        data: qAvg.map((v) => Number(v.toFixed(2))),
        backgroundColor: qAvg.map((v) => v >= 4.0 ? '#10b981' : v >= 3.0 ? '#f59e0b' : '#ef4444'),
      }],
    };
    const qOpts = {
      responsive: true, maintainAspectRatio: false,
      scales: { y: { suggestedMin: 0, suggestedMax: 5 } },
      plugins: { legend: { display: false } },
    };
    if (questionChart) questionChart.destroy();
    questionChart = new Chart($('#questionChart'), { type: 'bar', data: qData, options: qOpts });

    // 4. 护理员排名
    const cr = (s.caregiverRanking || []).slice(0, 10);
    const crData = {
      labels: cr.map((c) => c.name),
      datasets: [{
        label: '整体均分',
        data: cr.map((c) => Number(c.overall.toFixed(2))),
        backgroundColor: cr.map((c) => c.overall >= 4.0 ? '#10b981' : c.overall >= 3.0 ? '#f59e0b' : '#ef4444'),
      }],
    };
    const crOpts = {
      indexAxis: 'y',
      responsive: true, maintainAspectRatio: false,
      scales: { x: { suggestedMin: 0, suggestedMax: 5 } },
      plugins: { legend: { display: false } },
    };
    if (caregiverChart) caregiverChart.destroy();
    caregiverChart = new Chart($('#caregiverChart'), { type: 'bar', data: crData, options: crOpts });
  }

  // ===== 渲染明细表 =====
  function renderTable(items) {
    const tbody = $('#submissionsBody');
    if (!items.length) {
      tbody.innerHTML = '<tr><td colspan="10" class="dim center">暂无数据</td></tr>';
      $('#moreHint').hidden = true;
      return;
    }
    tbody.innerHTML = items.map((it) => {
      const sc = (v) => `<td class="score-cell ${scoreClass(v)}">${fmt(v)}</td>`;
      return `<tr>
        <td>${escapeHtml(it.created_at)}</td>
        <td>${escapeHtml(it.customer_name)}</td>
        <td>${escapeHtml(it.customer_phone)}</td>
        <td>${escapeHtml(it.service_date)}</td>
        <td>${escapeHtml(it.caregiver_name)}</td>
        ${sc(it.professionalism)}${sc(it.attitude)}${sc(it.efficiency)}${sc(it.emotion)}
        <td class="score-cell ${scoreClass(it.total_score)}"><b>${fmt(it.total_score)}</b></td>
      </tr>`;
    }).join('');
    $('#moreHint').hidden = items.length < 50;
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  // ===== 启动：先检查 session =====
  (async function init() {
    try {
      const r = await fetch(API.session, { credentials: 'same-origin' });
      if (r.ok) {
        showDashboard();
        await loadAll();
        return;
      }
    } catch (_) { /* 落到登录页 */ }
    showLogin();
  })();
})();
