/* POST /api/admin/report
 * AI 报告生成：基于当前 stats + 样本明细，调 LLM 生成 800 字分析报告
 * 流式返回 SSE（text/event-stream）
 *
 * 需要 admin session
 * 需要 3 个 env vars: LLM_BASE_URL / LLM_API_KEY / LLM_MODEL
 * 用 OpenAI 兼容协议（MiniMax / DeepSeek / OpenAI / 智谱等）
 */

import { env, err, readAdminSession, round2 } from '../../_lib.js';

const QUESTION_COLS = Array.from({ length: 40 }, (_, i) => `q${i + 1}`).join(', ');
const DIM_RANGES = { professionalism: [1, 10], attitude: [11, 20], efficiency: [21, 30], emotion: [31, 40] };
const DIM_NAMES = { professionalism: '专业性', attitude: '服务态度', efficiency: '服务效率', emotion: '情感体验' };

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

  // 解析请求体（可带筛选参数）
  let body = {};
  try { body = await context.request.json(); } catch (_) {}
  const start = (body.start || '').trim();
  const end = (body.end || '').trim();
  const caregiver = (body.caregiver || '').trim();

  // 动态 WHERE
  const where = [];
  const binds = [];
  if (/^\d{4}-\d{2}-\d{2}$/.test(start)) { where.push('service_date >= ?'); binds.push(start); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(end))   { where.push('service_date <= ?'); binds.push(end); }
  if (caregiver) { where.push('caregiver_name = ?'); binds.push(caregiver); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  // 1) 总览
  const overview = (await DB.prepare(`
    SELECT
      COUNT(*) as total,
      AVG(professionalism) as pro, AVG(attitude) as att,
      AVG(efficiency) as eff, AVG(emotion) as emo,
      AVG(total_score) as overall
    FROM submissions ${whereSql}
  `).bind(...binds).all()).results?.[0] || {};

  // 2) 趋势
  const trend = (await DB.prepare(`
    SELECT service_date as date, AVG(total_score) as overall, COUNT(*) as n
    FROM submissions ${whereSql}
    GROUP BY service_date ORDER BY service_date
  `).bind(...binds).all()).results || [];

  // 3) 护理员排名
  const ranking = (await DB.prepare(`
    SELECT caregiver_name as name, AVG(total_score) as overall,
      AVG(professionalism) as pro, AVG(attitude) as att,
      AVG(efficiency) as eff, AVG(emotion) as emo, COUNT(*) as n
    FROM submissions ${whereSql}
    GROUP BY caregiver_name ORDER BY overall DESC LIMIT 30
  `).bind(...binds).all()).results || [];

  // 4) 各题均分
  const qRow = (await DB.prepare(`
    SELECT ${QUESTION_COLS} FROM submissions ${whereSql}
  `).bind(...binds).all()).results?.[0] || {};
  const questionAverages = Array.from({ length: 40 }, (_, i) => round2(qRow[`q${i + 1}`] || 0));

  // 5) 强弱题
  const sortedQ = questionAverages.map((v, i) => ({ i: i + 1, v })).sort((a, b) => b.v - a.v);
  const top3 = sortedQ.slice(0, 5);
  const bottom3 = sortedQ.slice(-5).reverse();

  // ===== 组装 prompt（用中文，要求 800 字结构化报告）=====
  const total = overview.total || 0;
  const overall = round2(overview.overall || 0);
  const filterDesc = where.length
    ? `【数据筛选】\n- 时间范围：${start || '不限'} 至 ${end || '不限'}\n- 护理员：${caregiver || '全部'}`
    : '【数据筛选】全部数据，无筛选';

  const userBlock = `【数据快照】
${filterDesc}
- 总提交数：${total}
- 整体均分：${overall}
- 专业性：${round2(overview.pro || 0)}  |  服务态度：${round2(overview.att || 0)}  |  服务效率：${round2(overview.eff || 0)}  |  情感体验：${round2(overview.emo || 0)}

【维度分组均分】
${Object.entries(DIM_RANGES).map(([k, [s, e]]) => {
  const arr = questionAverages.slice(s - 1, e);
  return `- ${DIM_NAMES[k]}（Q${s}-Q${e}）：${round2(arr.reduce((a, b) => a + b, 0) / arr.length)}`;
}).join('\n')}

【TOP 5 强项题（按均分）】${top3.map((q) => `Q${q.i}(${q.v})`).join('、')}
【BOTTOM 5 弱项题（按均分）】${bottom3.map((q) => `Q${q.i}(${q.v})`).join('、')}

【各题均分明细】
${questionAverages.map((v, i) => `Q${i + 1}=${v}`).join(' ')}

【每日趋势】
${trend.length ? trend.map((t) => `${t.date}: ${round2(t.overall)} (n=${t.n})`).join('\n') : '（无）'}

【护理员排名（TOP 10）】
${ranking.slice(0, 10).map((r, i) => `${i + 1}. ${r.name} — 整体 ${round2(r.overall)} | 提交 ${r.n}`).join('\n') || '（无）'}

请基于以上数据，生成结构化报告（约 800 字）。`;

  const systemPrompt = `你是「居家护理服务质量分析专家」，擅长把数据转成可执行的运营洞察。

【报告受众】公司管理层、运营负责人
【目标】给一份能直接拿去做季度复盘 / 服务改进决策的报告
【风格】专业、具体、可执行。避免空话套话；每个结论都要带数据支撑；提到具体题目必须用 Q 编号。
【格式要求】必须用 Markdown，分为以下固定章节（每节都给数字 + 解读 + 行动建议）：
1. 执行摘要（200 字以内）
2. 调研概览（样本量、时间范围、整体均分等级判定）
3. 四维度深度分析（每维度独立一节，含强弱题、对比基线、可能原因）
4. 关键发现 TOP 10（按重要度排序，每条 1-2 句）
5. 重点改进项（按优先级，每项含"问题 + 数据 + 建议动作 + 责任人建议"）
6. 护理员个人洞察（点名表扬 + 点名关注）
7. 客户声音（基于强弱题推测客户最在意 / 最不满意的方面）
8. 未来 30 天行动清单（不超过 10 条，每条含动作 / 负责人 / 衡量指标）
9. 调研方法局限说明
10. 附录：数据明细

【字数】约 800 字（允许 ±20% 浮动）。不足 600 字扣分，超过 1000 字扣分。
【说明】CF Pages Functions 免费版 wall clock 上限 30s，按 MiniMax-M3 ~40 tokens/秒算，800 字是上限。
【禁止】不要编造数据（所有结论必须基于上面给的数据快照）；不要给法律/医疗建议。`;

  // ===== 调 LLM（OpenAI 兼容 chat completions，非流式）=====
  const llmRes = await fetch(`${LLM_BASE_URL.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'authorization': `Bearer ${LLM_API_KEY}`,
    },
    body: JSON.stringify({
      model: LLM_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userBlock },
      ],
      temperature: 0.7,
      max_tokens: 1200,
      stream: false,
    }),
  });

  if (!llmRes.ok) {
    const t = await llmRes.text();
    console.error('LLM error:', llmRes.status, t.slice(0, 500));
    return new Response(`LLM 调用失败 (${llmRes.status}): ${t.slice(0, 200)}`, { status: 502 });
  }

  const llmData = await llmRes.json();
  const report = llmData.choices?.[0]?.message?.content || '';
  if (!report) return err('LLM 返回为空', 502);

  return new Response(JSON.stringify({ ok: true, report, meta: { total, overall, model: LLM_MODEL } }), {
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
