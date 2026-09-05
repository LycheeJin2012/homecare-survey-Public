/* GET /api/admin/stats?start=YYYY-MM-DD&end=YYYY-MM-DD&caregiver=xxx
 * 聚合统计：总览 + 4 维度 + 趋势 + 护理员排名 + 各题均分
 * 需要 admin session
 */

import { env, err, json, readAdminSession, round2 } from '../../_lib.js';

const QUESTION_COLS = Array.from({ length: 40 }, (_, i) => `q${i + 1}`).join(', ');

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

  // 动态 WHERE + 参数
  const where = [];
  const binds = [];
  if (/^\d{4}-\d{2}-\d{2}$/.test(start)) { where.push('service_date >= ?'); binds.push(start); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(end))   { where.push('service_date <= ?'); binds.push(end); }
  if (caregiver) { where.push('caregiver_name = ?'); binds.push(caregiver); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  try {
    const batch = await DB.batch([
      // 1) 总览
      DB.prepare(`
        SELECT
          COUNT(*) as total,
          AVG(professionalism) as professionalism,
          AVG(attitude)        as attitude,
          AVG(efficiency)      as efficiency,
          AVG(emotion)         as emotion,
          AVG(total_score)     as overall
        FROM submissions
        ${whereSql}
      `).bind(...binds),

      // 2) 每日趋势
      DB.prepare(`
        SELECT
          service_date as date,
          AVG(professionalism) as professionalism,
          AVG(attitude)        as attitude,
          AVG(efficiency)      as efficiency,
          AVG(emotion)         as emotion,
          COUNT(*)             as count
        FROM submissions
        ${whereSql}
        GROUP BY service_date
        ORDER BY service_date
      `).bind(...binds),

      // 3) 护理员排名
      DB.prepare(`
        SELECT
          caregiver_name as name,
          AVG(total_score)     as overall,
          AVG(professionalism) as professionalism,
          AVG(attitude)        as attitude,
          AVG(efficiency)      as efficiency,
          AVG(emotion)         as emotion,
          COUNT(*)             as count
        FROM submissions
        ${whereSql}
        GROUP BY caregiver_name
        ORDER BY overall DESC
        LIMIT 50
      `).bind(...binds),

      // 4) 护理员列表（去重）
      DB.prepare(`
        SELECT DISTINCT caregiver_name as name
        FROM submissions
        ${whereSql}
        ORDER BY caregiver_name
      `).bind(...binds),

      // 5) 各题均分
      DB.prepare(`
        SELECT ${QUESTION_COLS}
        FROM submissions
        ${whereSql}
      `).bind(...binds),
    ]);

    const [overview, trend, ranking, caregivers, qRow] = batch.map((r) => r.results || []);
    const o = overview[0] || {};
    const qAvg = qRow[0] || {};
    const questionAverages = QUESTION_COLS.split(',').map((col) => {
      const v = qAvg[col.trim()];
      return v == null ? 0 : round2(v);
    });

    return json({
      total: o.total || 0,
      professionalism: round2(o.professionalism || 0),
      attitude: round2(o.attitude || 0),
      efficiency: round2(o.efficiency || 0),
      emotion: round2(o.emotion || 0),
      overall: round2(o.overall || 0),
      trend: (trend || []).map((r) => ({
        date: r.date,
        professionalism: round2(r.professionalism || 0),
        attitude: round2(r.attitude || 0),
        efficiency: round2(r.efficiency || 0),
        emotion: round2(r.emotion || 0),
        count: r.count,
      })),
      caregiverRanking: (ranking || []).map((r) => ({
        name: r.name,
        overall: round2(r.overall || 0),
        professionalism: round2(r.professionalism || 0),
        attitude: round2(r.attitude || 0),
        efficiency: round2(r.efficiency || 0),
        emotion: round2(r.emotion || 0),
        count: r.count,
      })),
      caregivers: (caregivers || []).map((r) => r.name).filter(Boolean),
      questionAverages,
    });
  } catch (e) {
    console.error('stats error:', e);
    return err('统计查询失败', 500);
  }
}
