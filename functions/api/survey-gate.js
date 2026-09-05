/* 问卷密码门
 * GET  → 检查 cookie 是否有效
 * POST → 验证密码，种 cookie
 */

import { env, json, err, hasSurveyCookie, setSurveyCookie } from '../_lib.js';

export async function onRequestGet(context) {
  if (hasSurveyCookie(context.request)) return json({ ok: true });
  return err('未通过密码验证', 401);
}

export async function onRequestPost(context) {
  const SURVEY_PASSWORD = env(context).SURVEY_PASSWORD;
  if (!SURVEY_PASSWORD) return err('服务端未配置 SURVEY_PASSWORD', 500);

  let body;
  try { body = await context.request.json(); } catch (_) { return err('请求格式错误'); }
  const password = (body && body.password) || '';
  if (password !== SURVEY_PASSWORD) return err('密码错误', 401);

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'set-cookie': setSurveyCookie(1800),
    },
  });
}
