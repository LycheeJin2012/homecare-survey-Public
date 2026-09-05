/* 主页 JS — 拉公开 stats + 最近 10 条填写预览（脱敏）*/

(function () {
  'use strict';

  // ===== 脱敏 =====
  function maskName(s) {
    if (!s) return '';
    if (s.length === 1) return s;
    if (s.length === 2) return s[0] + '*';
    return s[0] + '*'.repeat(s.length - 2) + s[s.length - 1];
  }
  function maskPhone(s) {
    if (!s) return '';
    const d = String(s).replace(/\D/g, '');
    if (d.length < 7) return s;
    return d.slice(0, 3) + '****' + d.slice(-4);
  }
  function scoreClass(v) {
    if (v >= 4.0) return 'score-good';
    if (v >= 3.0) return 'score-warn';
    return 'score-bad';
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }
  function fmtDate(s) {
    if (!s) return '';
    // D1 返回 'YYYY-MM-DD HH:MM:SS'，截到分钟
    return s.slice(5, 16);
  }
  function initial(name) {
    return (name && name[0]) || '?';
  }

  // ===== Meta 区域 =====
  async function loadMeta() {
    try {
      const res = await fetch('/api/public/recent?meta=1', { credentials: 'omit' });
      if (!res.ok) return;
      const d = await res.json();
      const elT = document.getElementById('metaTotal');
      const elA = document.getElementById('metaAvg');
      const elC = document.getElementById('metaCaregivers');
      if (elT) elT.textContent = d.total ?? '—';
      if (elA) elA.textContent = (d.overall != null) ? d.overall.toFixed(2) : '—';
      if (elC) elC.textContent = (d.caregivers != null) ? d.caregivers : '—';
    } catch (_) { /* 忽略 */ }
  }

  // ===== 最近 10 条 =====
  async function loadRecent() {
    const box = document.getElementById('recentList');
    try {
      const res = await fetch('/api/public/recent?limit=10', { credentials: 'omit' });
      if (!res.ok) {
        box.innerHTML = '<div class="recent-empty">⚠️ 加载失败，请稍后重试</div>';
        return;
      }
      const d = await res.json();
      const items = d.items || [];
      if (!items.length) {
        box.innerHTML = `
          <div class="recent-empty">
            <p style="font-size:18px;">📭</p>
            <p>暂无反馈记录</p>
            <p>成为第一位反馈者 → <a href="/survey" style="color:#2563eb;">填写问卷</a></p>
          </div>`;
        return;
      }
      box.innerHTML = items.map((it) => {
        const cls = scoreClass(it.total_score);
        return `
          <div class="recent-item">
            <div class="recent-avatar">${esc(initial(it.customer_name))}</div>
            <div class="recent-body">
              <p class="recent-name">${esc(maskName(it.customer_name))}</p>
              <p class="recent-meta">
                <span>📞 ${esc(maskPhone(it.customer_phone))}</span>
                <span>👩‍⚕️ ${esc(it.caregiver_name)}</span>
                <span>🕐 ${esc(fmtDate(it.created_at))}</span>
              </p>
            </div>
            <div class="recent-score">
              <div class="recent-score-num ${cls}">${it.total_score.toFixed(2)}</div>
              <div class="recent-score-label">总均分</div>
            </div>
          </div>`;
      }).join('');
    } catch (e) {
      box.innerHTML = '<div class="recent-empty">⚠️ 网络错误</div>';
    }
  }

  loadMeta();
  loadRecent();
})();
