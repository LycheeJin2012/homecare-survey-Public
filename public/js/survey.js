/* 问卷前端逻辑
 * - 密码门：调用 /api/survey-gate 通过后，后端会种 HttpOnly cookie
 * - 渲染 40 道题（4 维度 × 10 题），5 档评分单选
 * - 提交：调 /api/submit，带 cookie 验证
 */

(function () {
  'use strict';

  // ===== 题目配置（4 维度 × 10 题 = 40 题）=====
  const QUESTIONS = [
    // 一、专业性 Q1-Q10
    { group: 'professionalism', text: '护理人员具备与服务内容相匹配的专业知识和护理技能。' },
    { group: 'professionalism', text: '护理人员能够按照规范流程完成护理操作。' },
    { group: 'professionalism', text: '护理人员在服务过程中能够关注并识别服务对象的身体状况变化。' },
    { group: 'professionalism', text: '护理人员能够清楚、准确地向您说明护理内容及相关注意事项。' },
    { group: 'professionalism', text: '当遇到突发情况或特殊需求时，护理人员能够做出专业、妥善的处理。' },
    { group: 'professionalism', text: '护理人员对常见慢性病（高血压/糖尿病/术后等）的护理要点掌握到位。' },
    { group: 'professionalism', text: '护理人员能正确使用并维护护理用具（血压计、血糖仪、翻身垫等）。' },
    { group: 'professionalism', text: '护理人员对用药管理（按时按量、药物配伍禁忌）执行到位。' },
    { group: 'professionalism', text: '护理人员操作前后手部消毒与无菌意识符合规范。' },
    { group: 'professionalism', text: '护理人员能在服务中向家属传递专业的健康指导与照护建议。' },

    // 二、服务态度 Q11-Q20
    { group: 'attitude', text: '护理人员在服务过程中态度友善、有礼貌。' },
    { group: 'attitude', text: '护理人员能够耐心倾听您或服务对象的需求。' },
    { group: 'attitude', text: '护理人员尊重服务对象的生活习惯、个人意愿和隐私。' },
    { group: 'attitude', text: '当您提出问题或意见时，护理人员能够认真回应并积极沟通。' },
    { group: 'attitude', text: '整体而言，护理人员让您感受到尊重和被重视。' },
    { group: 'attitude', text: '护理人员面对服务对象的负面情绪（烦躁、抵触、哭闹）保持耐心与理解。' },
    { group: 'attitude', text: '护理人员称呼您与服务对象时礼貌得体（如"叔叔/阿姨/爷爷/奶奶"等，不直呼姓名）。' },
    { group: 'attitude', text: '护理人员不与同事在服务过程中议论服务对象家事。' },
    { group: 'attitude', text: '护理人员在服务过程中保持微笑与正向语言。' },
    { group: 'attitude', text: '护理人员能主动询问您的顾虑，而不是被动等您反映问题。' },

    // 三、服务效率 Q21-Q30
    { group: 'efficiency', text: '护理人员能够按照约定时间准时到达并开始服务。' },
    { group: 'efficiency', text: '护理人员能够在合理时间内完成约定的护理服务内容。' },
    { group: 'efficiency', text: '当您临时提出合理的服务需求时，工作人员能够及时响应。' },
    { group: 'efficiency', text: '当服务时间、人员或安排发生变化时，公司能够及时通知并协调。' },
    { group: 'efficiency', text: '整体服务流程顺畅，没有让您感到明显等待或反复沟通。' },
    { group: 'efficiency', text: '首次派单后，护理人员主动电话/微信确认到达时间。' },
    { group: 'efficiency', text: '服务过程中不频繁看手机或处理与本服务无关的事务。' },
    { group: 'efficiency', text: '同一护理周期内更换护理员时，能提前通知并交接清楚。' },
    { group: 'efficiency', text: '预约下单到首次服务的等待时长在您可接受范围内。' },
    { group: 'efficiency', text: '若服务时间需要延长，护理人员能主动沟通说明而非单方面结束。' },

    // 四、情感体验 Q31-Q40
    { group: 'emotion', text: '护理人员能够关注服务对象的情绪和心理感受。' },
    { group: 'emotion', text: '护理人员在服务过程中能够给予服务对象适当的陪伴和关怀。' },
    { group: 'emotion', text: '接受护理服务后，服务对象能够感受到更多安心和安全感。' },
    { group: 'emotion', text: '护理人员能够让服务对象在护理过程中感到舒适、有尊严。' },
    { group: 'emotion', text: '综合此次服务体验，您愿意继续选择或向他人推荐我们的居家护理服务。' },
    { group: 'emotion', text: '护理人员能在服务对象情绪低落时给予口头安慰或肢体关怀（如轻拍肩膀）。' },
    { group: 'emotion', text: '服务结束后，护理人员能主动向服务对象道别，留下温暖印象。' },
    { group: 'emotion', text: '服务对象（如老人）面对护理人员时表现出放松而非紧张。' },
    { group: 'emotion', text: '护理人员能记住服务对象的个人偏好（喜欢的称呼、爱吃的食物等）。' },
    { group: 'emotion', text: '整体服务让家属感到"把家人交给他/她很放心"。' },
  ];

  const SCORE_LABELS = ['非常不满意', '不满意', '一般', '满意', '非常满意'];
  const GROUP_LABELS = { professionalism: 'group-professionalism', attitude: 'group-attitude', efficiency: 'group-efficiency', emotion: 'group-emotion' };
  const GROUP_TITLES = { professionalism: '一、专业性', attitude: '二、服务态度', efficiency: '三、服务效率', emotion: '四、情感体验' };

  // ===== 工具 =====
  const $ = (sel) => document.querySelector(sel);

  function show(el) { el.classList.remove('hidden'); }
  function hide(el) { el.classList.add('hidden'); }
  function showOverlay(text) {
    $('#overlayText').textContent = text || '处理中…';
    show($('#overlay'));
  }
  function hideOverlay() { hide($('#overlay')); }

  // ===== 1. 密码门 =====
  async function tryGate(password) {
    const res = await fetch('/api/survey-gate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ password }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || '密码错误');
    }
    return res.json();
  }

  async function initGate() {
    // 后端会通过 cookie 记 30 分钟。如果 cookie 还在，直接进表单
    try {
      const res = await fetch('/api/survey-gate', { method: 'GET', credentials: 'same-origin' });
      if (res.ok) {
        enterSurvey();
        return;
      }
    } catch (_) { /* 网络错误也停留密码门 */ }
    show($('#gate'));
  }

  $('#gateEnter').addEventListener('click', async () => {
    const pw = $('#gatePassword').value.trim();
    if (!pw) {
      $('#gateError').textContent = '请输入密码';
      $('#gateError').hidden = false;
      return;
    }
    const btn = $('#gateEnter');
    btn.disabled = true;
    try {
      await tryGate(pw);
      hide($('#gate'));
      enterSurvey();
    } catch (e) {
      $('#gateError').textContent = e.message;
      $('#gateError').hidden = false;
    } finally {
      btn.disabled = false;
    }
  });
  $('#gatePassword').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('#gateEnter').click();
  });

  // ===== 2. 渲染问卷（40 题按 4 维度分组）=====
  function renderQuestions() {
    Object.values(GROUP_LABELS).forEach((id) => { $(`#${id}`).innerHTML = ''; });
    QUESTIONS.forEach((q, i) => {
      const container = $(`#${GROUP_LABELS[q.group]}`);
      const num = i + 1;
      const div = document.createElement('div');
      div.className = 'question';
      div.innerHTML = `
        <p class="q-title"><span class="q-index">${num}.</span>${escapeHtml(q.text)}</p>
        <div class="options" role="radiogroup" aria-label="第${num}题评分"></div>
      `;
      const optsBox = div.querySelector('.options');
      for (let s = 5; s >= 1; s--) {
        const opt = document.createElement('label');
        opt.className = 'opt';
        opt.dataset.score = s;
        opt.setAttribute('role', 'radio');
        opt.setAttribute('tabindex', '0');
        opt.innerHTML = `<input type="radio" name="q${num}" value="${s}" />
          <span class="opt-num">${s}</span>
          <span class="opt-label">${SCORE_LABELS[s-1]}</span>`;
        opt.addEventListener('click', () => selectOption(div, opt));
        opt.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectOption(div, opt); }
        });
        optsBox.appendChild(opt);
      }
      container.appendChild(div);
    });
  }

  function selectOption(questionDiv, opt) {
    questionDiv.querySelectorAll('.opt').forEach((o) => o.classList.remove('selected'));
    opt.classList.add('selected');
    opt.querySelector('input').checked = true;
  }

  function enterSurvey() {
    hide($('#gate'));
    renderQuestions();
    // 默认服务日期 = 今天
    const dateInput = document.querySelector('input[name="service_date"]');
    if (dateInput && !dateInput.value) {
      const d = new Date();
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      dateInput.value = `${y}-${m}-${day}`;
    }
    show($('#survey'));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ===== 3. 收集答案 =====
  function collectAnswers() {
    const form = $('#survey');
    const data = {
      customer_name: form.customer_name.value.trim(),
      customer_phone: form.customer_phone.value.trim(),
      service_date: form.service_date.value,
      caregiver_name: form.caregiver_name.value.trim(),
      scores: [],
    };
    for (let i = 1; i <= 40; i++) {
      const checked = form.querySelector(`input[name="q${i}"]:checked`);
      if (!checked) return { error: `第 ${i} 题未作答` };
      data.scores.push(parseInt(checked.value, 10));
    }
    if (!data.customer_name) return { error: '请填写姓名' };
    if (!data.customer_phone) return { error: '请填写联系电话' };
    if (!data.service_date) return { error: '请选择服务日期' };
    if (!data.caregiver_name) return { error: '请填写护理员姓名' };
    return { data };
  }

  // ===== 4. 提交 =====
  $('#survey').addEventListener('submit', async (e) => {
    e.preventDefault();
    const { data, error } = collectAnswers();
    if (error) { alert(error); return; }
    showOverlay('正在提交…');
    try {
      const res = await fetch('/api/submit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(data),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `提交失败（${res.status}）`);
      hide($('#survey'));
      show($('#done'));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      alert('提交失败：' + err.message);
    } finally {
      hideOverlay();
    }
  });

  // ===== 工具：HTML 转义 =====
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  // ===== 启动 =====
  initGate();
})();
