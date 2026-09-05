/* GET /api/admin/submission-detail?id=123
 * 单条提交详情：返回全部字段（不含 user_agent）
 * 需要 admin session
 *
 * 没用 [id].js 动态路由是因为 Pages Functions 对动态段支持不一致，
 * 用 query string 更兼容。
 */

import { env, err, json, readAdminSession } from '../../_lib.js';

export async function onRequestGet(context) {
  const { ADMIN_SESSION_SECRET } = env(context);
  if (!ADMIN_SESSION_SECRET) return err('服务端未配置', 500);
  const session = await readAdminSession(context.request, ADMIN_SESSION_SECRET);
  if (!session || !session.admin) return err('未登录', 401);

  const DB = context.env.DB;
  if (!DB) return err('数据库未配置', 500);

  const id = parseInt(new URL(context.request.url).searchParams.get('id') || '', 10);
  if (!Number.isInteger(id) || id <= 0) return err('无效的 ID', 400);

  try {
    const { results } = await DB.prepare(`SELECT * FROM submissions WHERE id = ?`).bind(id).all();
    if (!results || results.length === 0) return err('记录不存在', 404);
    const row = results[0];
    delete row.user_agent; // 详情页不需要 UA
    return json({ item: row });
  } catch (e) {
    console.error('submission-detail error:', e);
    return err('查询失败', 500);
  }
}
