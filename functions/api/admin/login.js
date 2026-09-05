/* POST /api/admin/login
 * 管理员登录：
 *   - ADMIN_PASSWORD_HASH 存的是 10000 轮 SHA-256(password + ":" + PASSWORD_SALT) 哈希
 *   - PASSWORD_SALT 从环境变量读（不在代码里）
 *   - ADMIN_SESSION_SECRET 是 HMAC 签名密钥，必须明文读（hash 会让签名失效）
 */

import { env, err, setAdminCookie, hashPassword, timingSafeHexEqual } from '../../_lib.js';

export async function onRequestPost(context) {
  const { ADMIN_PASSWORD_HASH, PASSWORD_SALT, ADMIN_SESSION_SECRET } = env(context);
  if (!ADMIN_PASSWORD_HASH || !PASSWORD_SALT || !ADMIN_SESSION_SECRET) {
    return err('服务端未配置管理员密码', 500);
  }
  let body;
  try { body = await context.request.json(); } catch (_) { return err('请求格式错误'); }
  const password = (body && body.password) || '';
  if (!password) return err('请输入密码', 400);

  // 计算用户输入的哈希，与存储的哈希对比（恒定时间）
  const inputHash = await hashPassword(password, PASSWORD_SALT);
  if (!timingSafeHexEqual(inputHash, ADMIN_PASSWORD_HASH)) return err('密码错误', 401);

  const cookie = await setAdminCookie(ADMIN_SESSION_SECRET, 7200);
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8', 'set-cookie': cookie },
  });
}
