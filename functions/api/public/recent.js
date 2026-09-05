/* GET /api/public/recent?limit=10&meta=1
 * 公开端点（不需要登录）：返回最近 N 条提交（仅展示字段）+ 公开 meta
 * 名字/电话在客户端脱敏，不在服务端脱敏以便前端灵活展示
 * 不返回 q1-q40 等评分细节
 */

import { env, err, json } from '../../_lib.js';

const MAX_LIMIT = 20;

export async function onRequestGet(context) {
  const DB = context.env.DB;
  if (!DB) return err('数据库未配置', 500);

  const url = new URL(context.request.url);
  const wantMeta = url.searchParams.get('meta') === '1';

  // 限制 limit
  let limit = parseInt(url.searchParams.get('limit') || '10', 10);
  if (!Number.isFinite(limit) || limit <= 0) limit = 10;
  if (limit > MAX_LIMIT) limit = MAX_LIMIT;

  try {
    if (wantMeta) {
      // 公开 meta：总数 + 整体均分 + 护理员数
      const r = await DB.prepare(`
        SELECT
          COUNT(*) as total,
          AVG(total_score) as overall,
          COUNT(DISTINCT caregiver_name) as caregivers
        FROM submissions
      `).all();
      const o = r.results?.[0] || {};
      return json({
        total: o.total || 0,
        overall: o.overall ? Math.round(o.overall * 100) / 100 : null,
        caregivers: o.caregivers || 0,
      });
    }

    // 最近 N 条
    const { results } = await DB.prepare(`
      SELECT
        customer_name, customer_phone, caregiver_name,
        total_score, created_at
      FROM submissions
      ORDER BY id DESC
      LIMIT ?
    `).bind(limit).all();

    return json({ items: results || [] });
  } catch (e) {
    console.error('public/recent error:', e);
    return err('查询失败', 500);
  }
}
