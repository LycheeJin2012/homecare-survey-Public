/* GET /api/admin/session — 检查管理员是否已登录 */

import { env, err, json, readAdminSession } from '../../_lib.js';

export async function onRequestGet(context) {
  const { ADMIN_SESSION_SECRET } = env(context);
  if (!ADMIN_SESSION_SECRET) return err('服务端未配置', 500);
  const session = await readAdminSession(context.request, ADMIN_SESSION_SECRET);
  if (!session || !session.admin) return err('未登录', 401);
  return json({ ok: true, session });
}
