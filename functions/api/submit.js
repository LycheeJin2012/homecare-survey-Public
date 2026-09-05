/* POST /api/submit
 * 提交问卷：校验 cookie + 评分 + 写入 D1
 */

import {
  env, err, json, hasSurveyCookie, calcDimensions,
  validateScores, cleanString,
} from '../_lib.js';

export async function onRequestPost(context) {
  const { request } = context;
  if (!hasSurveyCookie(request)) return err('请先通过密码验证', 401);

  const DB = context.env.DB;
  if (!DB) return err('数据库未配置', 500);

  let body;
  try { body = await request.json(); } catch (_) { return err('请求格式错误'); }
  if (!body || typeof body !== 'object') return err('请求格式错误');

  // 字段
  const customer_name = cleanString(body.customer_name, 50);
  const customer_phone = cleanString(body.customer_phone, 20);
  const service_date = cleanString(body.service_date, 10);
  const caregiver_name = cleanString(body.caregiver_name, 50);
  if (!customer_name) return err('请填写姓名');
  if (!customer_phone) return err('请填写联系电话');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(service_date)) return err('服务日期格式应为 YYYY-MM-DD');
  if (!caregiver_name) return err('请填写护理员姓名');

  let scores;
  try { scores = validateScores(body.scores); } catch (e) { return err(e.message); }

  const dim = calcDimensions(scores);
  const ua = (request.headers.get('user-agent') || '').slice(0, 500);

  try {
    const result = await DB.prepare(`
      INSERT INTO submissions (
        customer_name, customer_phone, service_date, caregiver_name,
        q1, q2, q3, q4, q5, q6, q7, q8, q9, q10,
        q11, q12, q13, q14, q15, q16, q17, q18, q19, q20,
        professionalism, attitude, efficiency, emotion, total_score,
        user_agent
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).bind(
      customer_name, customer_phone, service_date, caregiver_name,
      ...scores, dim.professionalism, dim.attitude, dim.efficiency, dim.emotion, dim.total_score,
      ua
    ).run();

    return json({ ok: true, id: result.meta?.last_row_id, scores: dim });
  } catch (e) {
    console.error('DB insert error:', e);
    return err('保存失败，请稍后重试', 500);
  }
}
