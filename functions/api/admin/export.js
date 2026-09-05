/* GET /api/admin/export?start=&end=&caregiver=
 * 导出 CSV（带 BOM，Excel 打开中文不乱码）
 */

import { env, err, readAdminSession } from '../../_lib.js';

const COLUMNS = [
  ['id', 'ID'],
  ['created_at', '提交时间'],
  ['customer_name', '客户姓名'],
  ['customer_phone', '联系电话'],
  ['service_date', '服务日期'],
  ['caregiver_name', '护理员'],
  ...Array.from({ length: 40 }, (_, i) => [`q${i + 1}`, `Q${i + 1}`]),
  ['professionalism', '专业性'],
  ['attitude', '服务态度'],
  ['efficiency', '服务效率'],
  ['emotion', '情感体验'],
  ['total_score', '总均分'],
  ['user_agent', 'User-Agent'],
];

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

  const where = [];
  const binds = [];
  if (/^\d{4}-\d{2}-\d{2}$/.test(start)) { where.push('service_date >= ?'); binds.push(start); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(end))   { where.push('service_date <= ?'); binds.push(end); }
  if (caregiver) { where.push('caregiver_name = ?'); binds.push(caregiver); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  try {
    const { results } = await DB.prepare(`
      SELECT * FROM submissions ${whereSql} ORDER BY id ASC
    `).bind(...binds).all();

    const header = COLUMNS.map((c) => csvCell(c[1])).join(',');
    const rows = (results || []).map((row) => {
      return COLUMNS.map(([k]) => csvCell(row[k])).join(',');
    });
    // \uFEFF BOM 让 Excel 正确识别 UTF-8
    const body = '\uFEFF' + header + '\n' + rows.join('\n');

    const ts = new Date().toISOString().slice(0, 10);
    return new Response(body, {
      status: 200,
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="survey-${ts}.csv"`,
        'cache-control': 'no-store',
      },
    });
  } catch (e) {
    console.error('export error:', e);
    return err('导出失败', 500);
  }
}

function csvCell(v) {
  if (v == null) return '';
  const s = String(v);
  if (/[",\n\r]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}
