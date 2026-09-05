/* POST /api/admin/login
 * 管理员登录：密码正确就种 HttpOnly + 签名的 session cookie
 */

import { env, err, setAdminCookie } from '../../_lib.js';

export async function onRequestPost(context) {
  const { ADMIN_PASSWORD, ADMIN_SESSION_SECRET } = env(context);
  if (!ADMIN_PASSWORD || !ADMIN_SESSION_SECRET) {
    return err('服务端未配置管理员密码', 500);
  }
  let body;
  try { body = await context.request.json(); } catch (_) { return err('请求格式错误'); }
  const password = (body && body.password) || '';
  // 用恒定时间比较，避免时序攻击
  if (!timingSafeEqual(password, ADMIN_PASSWORD)) return err('密码错误', 401);

  const cookie = await setAdminCookie(ADMIN_SESSION_SECRET, 7200);
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8', 'set-cookie': cookie },
  });
}

function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
