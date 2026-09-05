/* POST /api/admin/report
 * AI 报告生成：基于当前 stats + 样本明细，调 LLM 生成结构化分析报告
 * 支持两种模式：
 *   1) 单段（默认，无 section_index）：~800 字精简版
 *   2) 分段（section_index: 0-9）：只生成某一节 ~800 字，前端 10 段并行拉取拼出 ~8000 字完整报告
 *
 * 需要 admin session
 * 需要 3 个 env vars: LLM_BASE_URL / LLM_API_KEY / LLM_MODEL
 * 用 OpenAI 兼容协议（MiniMax / DeepSeek / OpenAI / 智谱等）
 *
 * 关键约束：CF Pages Functions 免费版 wall clock 30s，所以单段 max_tokens 控制在 1200
 * 速度参考：MiniMax-M3 实际 ~40 tokens/秒（含 reasoning）
 *   1000 tokens ≈ 25s  ✓ 安全
 *   1200 tokens ≈ 30s  ⚠️ 临界
 *   1500 tokens ≈ 37s  ✗ 超 30s
 */

import { env, err, readAdminSession, round2 } from '../../_lib.js';

const QUESTION_COLS = Array.from({ length: 40 }, (_, i) => `q${i + 1}`).join(', ');
const DIM_RANGES = { professionalism: [1, 10], attitude: [11, 20], efficiency: [21, 30], emotion: [31, 40] };
const DIM_NAMES = { professionalism: '专业性', attitude: '服务态度', efficiency: '服务效率', emotion: '情感体验' };

// 10 个分段。每节单独生成，前端 10 个并行请求拼出全文
const SECTIONS = [
  { idx: 0, name: '执行摘要',         target: 250,  hint: '3-5 句结论 + 关键数字 + 最重要 1 个建议' },
  { idx: 1, name: '调研概览',         target: 400,  hint: '用表格列：样本量、时间范围、整体均分、维度均分、护理员覆盖率、判定结论' },
  { idx: 2, name: '四维度深度分析',   target: 1500, hint: '4 个子节（专业性/服务态度/服务效率/情感体验），每节含 TOP 题、BOTTOM 题、可能原因' },
  { idx: 3, name: '关键发现 TOP 10',  target: 800,  hint: '按重要度排序，每条 1-2 句，含具体 Q 编号和数据' },
  { idx: 4, name: '重点改进项',       target: 1200, hint: '按 P0/P1/P2 优先级，每项含：问题 + 数据 + 建议动作 + 责任人建议' },
  { idx: 5, name: '护理员个人洞察',   target: 600,  hint: '点名表扬（TOP 3）+ 点名关注（BOTTOM 3），每人 1-2 句' },
  { idx: 6, name: '客户声音',         target: 600,  hint: '基于强弱题推测客户最在意 / 最不满意的方面，结合 Q 编号' },
  { idx: 7, name: '未来 30 天行动清单', target: 1200, hint: '不超过 10 条，每条含：动作 / 负责人 / 衡量指标 / 截止时间' },
  { idx: 8, name: '调研方法局限说明', target: 300,  hint: '样本量、覆盖率、可能偏差、建议改进' },
  { idx: 9, name: '附录：数据明细',   target: 600,  hint: '用表格列：每日提交数 / 整体均分；以及各题均分表（Q1-Q40）' },
];

// 去除 LLM 思考链 (<think>...</think>) 块
function stripThink(s) {
  if (!s) return s;
  return s.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/^<think>[\s\S]*?(?=\S)/i, '').trim();
}

export async function onRequestPost(context) {
  const { ADMIN_SESSION_SECRET, LLM_BASE_URL, LLM_API_KEY, LLM_MODEL } = env(context);
  if (!ADMIN_SESSION_SECRET) return err('服务端未配置', 500);
  const session = await readAdminSession(context.request, ADMIN_SESSION_SECRET);
  if (!session || !session.admin) return err('未登录', 401);
  if (!LLM_BASE_URL || !LLM_API_KEY || !LLM_MODEL) {
    return err('服务端未配置 LLM（缺 LLM_BASE_URL / LLM_API_KEY / LLM_MODEL）', 500);
  }
  const DB = context.env.DB;
  if (!DB) return err('数据库未配置', 500);

  // 解析请求体
  let body = {};
  try { body = await context.request.json(); } catch (_) {}
  const start = (body.start || '').trim();
  const end = (body.end || '').trim();
  const caregiver = (body.caregiver || '').trim();
  const sectionIndex = (body.section_index != null) ? Number(body.section_index) : null;

  // 动态 WHERE
  const where = [];
  const binds = [];
  if (/^\d{4}-\d{2}-\d{2}$/.test(start)) { where.push('service_date >= ?'); binds.push(start); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(end))   { where.push('service_date <= ?'); binds.push(end); }
  if (caregiver) { where.push('caregiver_name = ?'); binds.push(caregiver); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  // 拉数据
  const overview = (await DB.prepare(`
    SELECT COUNT(*) as total,
      AVG(professionalism) as pro, AVG(attitude) as att,
      AVG(efficiency) as eff, AVG(emotion) as emo,
      AVG(total_score) as overall
    FROM submissions ${whereSql}
  `).bind(...binds).all()).results?.[0] || {};

  const trend = (await DB.prepare(`
    SELECT service_date as date, AVG(total_score) as overall, COUNT(*) as n
    FROM submissions ${whereSql}
    GROUP BY service_date ORDER BY service_date
  `).bind(...binds).all()).results || [];

  const ranking = (await DB.prepare(`
    SELECT caregiver_name as name, AVG(total_score) as overall,
      AVG(professionalism) as pro, AVG(attitude) as att,
      AVG(efficiency) as eff, AVG(emotion) as emo, COUNT(*) as n
    FROM submissions ${whereSql}
    GROUP BY caregiver_name ORDER BY overall DESC LIMIT 30
  `).bind(...binds).all()).results || [];

  const qRow = (await DB.prepare(`
    SELECT ${QUESTION_COLS} FROM submissions ${whereSql}
  `).bind(...binds).all()).results?.[0] || {};
  const questionAverages = Array.from({ length: 40 }, (_, i) => round2(qRow[`q${i + 1}`] || 0));
  const sortedQ = questionAverages.map((v, i) => ({ i: i + 1, v })).sort((a, b) => b.v - a.v);
  const top5 = sortedQ.slice(0, 5);
  const bottom5 = sortedQ.slice(-5).reverse();

  // 共享数据快照
  const total = overview.total || 0;
  const overall = round2(overview.overall || 0);
  const filterDesc = where.length
    ? `【数据筛选】\n- 时间范围：${start || '不限'} 至 ${end || '不限'}\n- 护理员：${caregiver || '全部'}`
    : '【数据筛选】全部数据，无筛选';

  const dataSnapshot = `【数据快照】
${filterDesc}
- 总提交数：${total}
- 整体均分：${overall}
- 专业性：${round2(overview.pro || 0)}  |  服务态度：${round2(overview.att || 0)}  |  服务效率：${round2(overview.eff || 0)}  |  情感体验：${round2(overview.emo || 0)}

【维度分组均分】
${Object.entries(DIM_RANGES).map(([k, [s, e]]) => {
  const arr = questionAverages.slice(s - 1, e);
  return `- ${DIM_NAMES[k]}（Q${s}-Q${e}）：${round2(arr.reduce((a, b) => a + b, 0) / arr.length)}`;
}).join('\n')}

【TOP 5 强项题】${top5.map((q) => `Q${q.i}(${q.v})`).join('、')}
【BOTTOM 5 弱项题】${bottom5.map((q) => `Q${q.i}(${q.v})`).join('、')}

【各题均分明细】
${questionAverages.map((v, i) => `Q${i + 1}=${v}`).join(' ')}

【每日趋势】
${trend.length ? trend.map((t) => `${t.date}: ${round2(t.overall)} (n=${t.n})`).join('\n') : '（无）'}

【护理员排名（TOP 10）】
${ranking.slice(0, 10).map((r, i) => `${i + 1}. ${r.name} — 整体 ${round2(r.overall)} | 提交 ${r.n}`).join('\n') || '（无）'}`;

  // ===== 决定 prompt 模式 =====
  let section;
  if (sectionIndex != null) {
    if (!Number.isInteger(sectionIndex) || sectionIndex < 0 || sectionIndex >= SECTIONS.length) {
      return err(`section_index 必须是 0-${SECTIONS.length - 1} 之间的整数`, 400);
    }
    section = SECTIONS[sectionIndex];
  }
  // else: 单段模式，section = null（走老逻辑，800 字整段）

  let systemPrompt, userPrompt, maxTokens;
  if (section) {
    // 分段模式
    systemPrompt = `你是「居家护理服务质量分析专家」。当前任务是写完整报告的第 ${section.idx + 1} 节（共 10 节）：**${section.name}**。

【风格】专业、具体、可执行。避免空话套话；每个结论都要带数据支撑；提到具体题目必须用 Q 编号。
【输出格式】严格用 Markdown。本节用一个 ## 标题开头（"## ${section.idx + 1}. ${section.name}"），后面跟正文。**不要输出其他章节**。
【字数】约 ${section.target} 字（允许 ±20%）。不足 ${Math.round(section.target * 0.8)} 字扣分，超过 ${Math.round(section.target * 1.2)} 字扣分。
【重要】不要输出 <think> 思考过程；不要解释你在做什么；直接给出本节内容。
【禁止】不要编造数据（所有结论必须基于下面给的数据快照）；不要给法律/医疗建议。`;
    userPrompt = `${dataSnapshot}\n\n请基于以上数据，写报告的第 ${section.idx + 1} 节："${section.name}"。\n【本节要点提示】${section.hint}`;
    maxTokens = 1200; // ~800 中文字，安全
  } else {
    // 单段模式（兼容旧调用）：精简 800 字
    systemPrompt = `你是「居家护理服务质量分析专家」。

【风格】专业、具体、可执行。避免空话套话；每个结论都要带数据支撑；提到具体题目必须用 Q 编号。
【输出格式】必须用 Markdown。包含 10 个章节：执行摘要 / 调研概览 / 四维度深度分析 / 关键发现 TOP 10 / 重点改进项 / 护理员个人洞察 / 客户声音 / 未来 30 天行动清单 / 调研方法局限说明 / 附录：数据明细。每节用 ## 标题。
【字数】约 800 字（允许 ±20%）。
【重要】不要输出 <think> 思考过程；直接给出报告内容。
【禁止】不要编造数据；不要给法律/医疗建议。`;
    userPrompt = `${dataSnapshot}\n\n请基于以上数据，生成结构化报告（约 800 字）。`;
    maxTokens = 1200;
  }

  // ===== 调 LLM =====
  let llmRes;
  try {
    llmRes = await fetch(`${LLM_BASE_URL.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'authorization': `Bearer ${LLM_API_KEY}`,
      },
      body: JSON.stringify({
        model: LLM_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.7,
        max_tokens: maxTokens,
        stream: false,
      }),
    });
  } catch (e) {
    console.error('LLM fetch error:', e);
    return err(`LLM 请求失败：${e.message}`, 502);
  }

  if (!llmRes.ok) {
    const t = await llmRes.text();
    console.error('LLM error:', llmRes.status, t.slice(0, 500));
    return new Response(`LLM 调用失败 (${llmRes.status}): ${t.slice(0, 200)}`, { status: 502 });
  }

  const llmData = await llmRes.json();
  const rawReport = llmData.choices?.[0]?.message?.content || '';
  if (!rawReport) return err('LLM 返回为空', 502);

  // 清理 <think> 块 + 前后空白
  const report = stripThink(rawReport);

  return new Response(JSON.stringify({
    ok: true,
    report,
    section: section ? section.idx : null,
    section_name: section ? section.name : null,
    meta: { total, overall, model: LLM_MODEL, total_sections: SECTIONS.length },
  }), {
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
