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
    // 启用所有需要登录后才能用的按钮
    const reportBtn = $('#reportBtn');
    if (reportBtn) reportBtn.disabled = false;
    const exportBtn = $('#exportBtn');
    if (exportBtn) exportBtn.disabled = false;
    const refreshBtn = $('#refreshBtn');
    if (refreshBtn) refreshBtn.disabled = false;
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

  // ===== AI 报告 =====
  $('#reportBtn').addEventListener('click', generateReport);
  $('#copyReport').addEventListener('click', copyReport);
  document.querySelectorAll('#reportModal [data-close]').forEach((el) => {
    el.addEventListener('click', closeReport);
  });
  let _lastReport = '';

  async function generateReport() {
    const btn = $('#reportBtn');
    const modal = $('#reportModal');
    const body = $('#reportBody');
    const copyBtn = $('#copyReport');
    btn.disabled = true;
    btn.textContent = '🤖 生成中…';
    modal.classList.remove('hidden');
    copyBtn.disabled = true;
    _lastReport = '';

    // 准备 10 个空槽位
    const slots = new Array(10).fill(null);
    const slotStatus = new Array(10).fill('pending'); // pending | loading | done | error
    const slotErrors = new Array(10).fill('');
    function renderProgress() {
      const done = slotStatus.filter((s) => s === 'done').length;
      const errs = slotStatus.filter((s) => s === 'error').length;
      const header = `<div class="report-progress">
        <div class="dim small">分段生成进度：${done}/10 完成${errs ? ` · ${errs} 个失败` : ''}</div>
        <div class="report-progress-bar"><div class="report-progress-fill" style="width:${(done / 10) * 100}%"></div></div>
      </div>`;
      const sections = slots.map((content, i) => {
        const status = slotStatus[i];
        let cls = 'report-slot';
        let inner;
        if (status === 'pending') {
          inner = `<div class="report-slot-pending">⏳ 第 ${i + 1} 段：等待生成…</div>`;
        } else if (status === 'loading') {
          inner = `<div class="report-slot-pending">⏳ 第 ${i + 1} 段：正在生成…</div>`;
        } else if (status === 'error') {
          inner = `<div class="report-slot-error">❌ 第 ${i + 1} 段失败：${escapeHtml(slotErrors[i])}</div>`;
        } else if (content) {
          const html = window.marked ? marked.parse(content) : escapeHtml(content);
          inner = `<div class="report-slot-content">${html}</div>`;
        } else {
          inner = '';
        }
        return `<div class="${cls}" data-slot="${i}">${inner}</div>`;
      }).join('');
      body.innerHTML = header + sections;
    }
    renderProgress();
    body.scrollTop = 0;

    try {
      const qs = buildFilterQS();
      const sp = new URLSearchParams(qs.startsWith('?') ? qs.slice(1) : '');
      const filterBody = {
        start: sp.get('start') || '',
        end: sp.get('end') || '',
        caregiver: sp.get('caregiver') || '',
      };

      // 10 个并行请求
      const tasks = slots.map((_, i) => (async () => {
        slotStatus[i] = 'loading';
        renderProgress();
        try {
          const r = await fetch('/api/admin/report', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ ...filterBody, section_index: i }),
          });
          const data = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(data.error || `请求失败（${r.status}）`);
          slots[i] = data.report || '';
          slotStatus[i] = 'done';
          _lastReport = slots.map((c, j) => c || '').join('\n\n');
        } catch (e) {
          slotStatus[i] = 'error';
          slotErrors[i] = e.message;
        }
        renderProgress();
      })());

      await Promise.all(tasks);

      // 收尾：清掉进度条
      const finalHtml = slots.map((c, i) => {
        if (slotStatus[i] === 'done' && c) {
          const html = window.marked ? marked.parse(c) : escapeHtml(c);
          return `<div class="report-slot">${html}</div>`;
        } else if (slotStatus[i] === 'error') {
          return `<div class="report-slot-error">❌ 第 ${i + 1} 段失败：${escapeHtml(slotErrors[i])}</div>`;
        }
        return '';
      }).join('');
      body.innerHTML = `<div class="report-content">${finalHtml}</div>`;
      body.scrollTop = 0;
      copyBtn.disabled = false;
    } catch (e) {
      body.innerHTML = `<p style="color:#ef4444;">生成失败：${escapeHtml(e.message)}</p>
        <p class="dim small" style="margin-top:12px;">提示：检查 Cloudflare Pages 环境变量 <code>LLM_BASE_URL / LLM_API_KEY / LLM_MODEL</code> 是否已配置。</p>`;
    } finally {
      btn.disabled = false;
      btn.textContent = '🤖 AI 报告';
    }
  }

  function closeReport() {
    $('#reportModal').classList.add('hidden');
  }

  async function copyReport() {
    if (!_lastReport) return;
    try {
      await navigator.clipboard.writeText(_lastReport);
      const btn = $('#copyReport');
      const old = btn.textContent;
      btn.textContent = '✓ 已复制';
      setTimeout(() => { btn.textContent = old; }, 1500);
    } catch (_) {
      alert('复制失败，请手动选择文本复制');
    }
  }

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
        <td class="id-cell">#${it.id}</td>
        <td>${escapeHtml(it.created_at)}</td>
        <td>${escapeHtml(it.customer_name)}</td>
        <td>${escapeHtml(it.customer_phone)}</td>
        <td>${escapeHtml(it.service_date)}</td>
        <td>${escapeHtml(it.caregiver_name)}</td>
        ${sc(it.professionalism)}${sc(it.attitude)}${sc(it.efficiency)}${sc(it.emotion)}
        <td class="score-cell ${scoreClass(it.total_score)}"><b>${fmt(it.total_score)}</b></td>
        <td><a class="act-btn" href="/admin/submission?id=${it.id}">查看</a></td>
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
