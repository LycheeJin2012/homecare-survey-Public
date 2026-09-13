/* POST /api/submit
 * 提交问卷：校验 cookie + 40 题评分 + 写入 D1
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
  // 中国电话格式：11 位手机号 (1[3-9]xxxxxxxxx) / 带区号固话 (0xxx-xxxxxxx) / 7-11 位纯数字
  if (!/^(1[3-9]\d{9}|0\d{2,3}-?\d{7,8}|\d{7,11})$/.test(customer_phone.replace(/\s/g, ''))) {
    return err('电话格式不正确（11 位手机号 / 带区号固话 / 7-11 位数字）');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(service_date)) return err('服务日期格式应为 YYYY-MM-DD');
  if (!caregiver_name) return err('请填写护理员姓名');

  let scores;
  try { scores = validateScores(body.scores); } catch (e) { return err(e.message); }

  const dim = calcDimensions(scores);
  const ua = (request.headers.get('user-agent') || '').slice(0, 500);

  // 40 个 q 字段 + 4 个维度 + 1 个总均分 + 4 个元数据 + 1 个 UA = 50 个字段
  try {
    const result = await DB.prepare(`
      INSERT INTO submissions (
        customer_name, customer_phone, service_date, caregiver_name,
        q1, q2, q3, q4, q5, q6, q7, q8, q9, q10,
        q11, q12, q13, q14, q15, q16, q17, q18, q19, q20,
        q21, q22, q23, q24, q25, q26, q27, q28, q29, q30,
        q31, q32, q33, q34, q35, q36, q37, q38, q39, q40,
        professionalism, attitude, efficiency, emotion, total_score,
        user_agent
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
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
