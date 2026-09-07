/* GET /api/admin/submissions?start=&end=&caregiver=&limit=50
 * 提交明细列表，按提交时间倒序
 */

import { env, err, json, readAdminSession } from '../../_lib.js';

export async function onRequestGet(context) {
  const { ADMIN_SESSION_SECRET } = env(context);
  if (!ADMIN_SESSION_SECRET) return err('服务端未配置', 500);
  const session = await readAdminSession(context.request, ADMIN_SESSION_SECRET);
  if (!session || !session.admin) return err('未登录', 401);

  const DB = context.env.DB;
  if (!DB) return err('数据库未配置', 500);

  const url = new URL(context.request.url);
  const start = (url.searchParams.get('start') || '').trim();
  const end   = (url.searchParams.get('end') || '').trim();
  const caregiver = (url.searchParams.get('caregiver') || '').trim();
  let limit = parseInt(url.searchParams.get('limit') || '50', 10);
  if (!Number.isFinite(limit) || limit <= 0) limit = 50;
  if (limit > 500) limit = 500;
  let offset = parseInt(url.searchParams.get('offset') || '0', 10);
  if (!Number.isFinite(offset) || offset < 0) offset = 0;

  const where = [];
  const binds = [];
  if (/^\d{4}-\d{2}-\d{2}$/.test(start)) { where.push('service_date >= ?'); binds.push(start); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(end))   { where.push('service_date <= ?'); binds.push(end); }
  if (caregiver) { where.push('caregiver_name = ?'); binds.push(caregiver); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  try {
    // 同时拿总数（用于前端显示"共 N 条"和分页）
    const countRow = (await DB.prepare(
      `SELECT COUNT(*) as total FROM submissions ${whereSql}`
    ).bind(...binds).all()).results?.[0] || { total: 0 };

    const { results } = await DB.prepare(`
      SELECT
        id, customer_name, customer_phone, service_date, caregiver_name,
        professionalism, attitude, efficiency, emotion, total_score,
        created_at
      FROM submissions
      ${whereSql}
      ORDER BY id DESC
      LIMIT ? OFFSET ?
    `).bind(...binds, limit, offset).all();

    return json({
      items: results || [],
      total: countRow.total,
      limit,
      offset,
    });
  } catch (e) {
    console.error('submissions error:', e);
    return err('查询失败', 500);
  }
}
