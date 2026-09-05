/* 详情页 JS — 拉单条提交 + 渲染 40 题明细 */

(function () {
  'use strict';

  const $ = (s) => document.querySelector(s);

  function fmt(n) { return n == null ? '—' : Number(n).toFixed(2); }
  function scoreClass(v) {
    if (v == null) return '';
    if (v >= 4.0) return 'good';
    if (v >= 3.0) return 'warn';
    return 'bad';
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  async function api(url, opts = {}) {
    const res = await fetch(url, { credentials: 'same-origin', ...opts });
    if (res.status === 401) {
      // session 失效，跳到登录页
      window.location.href = '/admin';
      return null;
    }
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      throw new Error(d.error || `请求失败（${res.status}）`);
    }
    return res.json();
  }

  async function load() {
    const id = parseInt(new URLSearchParams(location.search).get('id') || '', 10);
    if (!id) {
      $('#loading').classList.add('hidden');
      $('#error').textContent = '无效的 ID';
      $('#error').classList.remove('hidden');
      return;
    }

    try {
      const r = await api(`/api/admin/submission-detail?id=${id}`);
      if (!r) return;
      render(r.item);
    } catch (e) {
      $('#loading').classList.add('hidden');
      $('#error').textContent = '加载失败：' + e.message;
      $('#error').classList.remove('hidden');
    }
  }

  function render(it) {
    $('#loading').classList.add('hidden');
    $('#content').classList.remove('hidden');

    // 基本
    $('#dId').textContent = '#' + it.id;
    $('#dCreatedAt').textContent = it.created_at || '—';
    $('#dName').textContent = it.customer_name || '—';
    $('#dPhone').textContent = it.customer_phone || '—';
    $('#dServiceDate').textContent = it.service_date || '—';
    $('#dCaregiver').textContent = it.caregiver_name || '—';

    // 维度
    setDim('#dPro', it.professionalism);
    setDim('#dAtt', it.attitude);
    setDim('#dEff', it.efficiency);
    setDim('#dEmo', it.emotion);
    setDim('#dTotal', it.total_score, true);

    // 40 题
    const groupMap = {
      qPro: [1, 10],
      qAtt: [11, 20],
      qEff: [21, 30],
      qEmo: [31, 40],
    };
    for (const [boxId, [start, end]] of Object.entries(groupMap)) {
      const box = $('#' + boxId);
      box.innerHTML = '';
      for (let i = start; i <= end; i++) {
        const s = it['q' + i];
        box.appendChild(renderQRow(i, s));
      }
    }
  }

  function setDim(sel, v, big) {
    const el = $(sel);
    el.textContent = fmt(v);
    el.className = 'value ' + (big ? 'lg ' : '') + scoreClass(v);
  }

  function renderQRow(num, score) {
    const row = document.createElement('div');
    row.className = 'q-row';
    const pct = (score / 5) * 100;
    const cls = score >= 4 ? '#10b981' : score >= 3 ? '#f59e0b' : '#ef4444';
    row.innerHTML = `
      <span class="qn">Q${num}</span>
      <span class="qs" style="color:${cls}">${score}</span>
      <div class="qbar"><div style="width:${pct}%; background:${cls};"></div></div>
    `;
    return row;
  }

  // 返回按钮
  $('#backBtn').addEventListener('click', () => {
    if (document.referrer && document.referrer.includes('/admin')) {
      history.back();
    } else {
      location.href = '/admin';
    }
  });

  load();
})();
