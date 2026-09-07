/* GET /api/admin/export?start=&end=&caregiver=&format=csv|xlsx
 * 导出调研数据
 *   format=csv  (默认)  CSV + UTF-8 BOM，Excel 双击不乱码
 *   format=xlsx         Excel 2003 XML（SpreadsheetML），纯字符串拼接
 *                        无需 zip 库；Excel / WPS / Numbers 全支持；中文完美
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
  const format = (url.searchParams.get('format') || 'csv').toLowerCase();

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

    const ts = new Date().toISOString().slice(0, 10);
    if (format === 'xlsx' || format === 'xls') {
      return xlsxResponse(results || [], ts);
    }
    return csvResponse(results || [], ts);
  } catch (e) {
    console.error('export error:', e);
    return err('导出失败', 500);
  }
}

// ===== CSV 导出 =====
function csvResponse(rows, ts) {
  const header = COLUMNS.map((c) => csvCell(c[1])).join(',');
  const body = rows.map((row) => COLUMNS.map(([k]) => csvCell(row[k])).join(',')).join('\n');
  // \uFEFF BOM 让 Excel 正确识别 UTF-8
  return new Response('\uFEFF' + header + '\n' + body, {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="survey-${ts}.csv"`,
      'cache-control': 'no-store',
    },
  });
}

function csvCell(v) {
  if (v == null) return '';
  const s = String(v);
  if (/[",\n\r]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

// ===== Excel 2003 XML 导出（SpreadsheetML）=====
// 这种格式 Excel 2003+ / WPS / Numbers 全能打开，UTF-8 中文完美
// 不是 OOXML (.xlsx zip)，但兼容性足够，纯字符串拼接
function xlsxResponse(rows, ts) {
  const xmlRows = [];
  // 表头
  xmlRows.push('<Row>' + COLUMNS.map((c) => xlsxCell(c[1], 'String', true)).join('') + '</Row>');
  // 数据
  for (const r of rows) {
    xmlRows.push('<Row>' + COLUMNS.map(([k]) => {
      const v = r[k];
      // 数字列直接用 Number，节省空间
      const numCols = new Set(['id', 'professionalism', 'attitude', 'efficiency', 'emotion', 'total_score']);
      for (let i = 1; i <= 40; i++) numCols.add(`q${i}`);
      if (v == null || v === '') return '<Cell><Data ss:Type="String"></Data></Cell>';
      if (numCols.has(k) && Number.isFinite(Number(v))) {
        return xlsxCell(Number(v), 'Number', false);
      }
      return xlsxCell(String(v), 'String', false);
    }).join('') + '</Row>');
  }

  const body = `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
 <Styles>
  <Style ss:ID="Default" ss:Name="Normal">
   <Font ss:FontName="宋体" ss:Size="11"/>
   <Alignment ss:Vertical="Center" ss:WrapText="1"/>
  </Style>
  <Style ss:ID="Header">
   <Font ss:FontName="微软雅黑" ss:Size="11" ss:Bold="1" ss:Color="#FFFFFF"/>
   <Interior ss:Color="#3B82F6" ss:Pattern="Solid"/>
   <Alignment ss:Horizontal="Center" ss:Vertical="Center" ss:WrapText="1"/>
  </Style>
 </Styles>
 <Worksheet ss:Name="调研数据">
  <Table>
${xmlRows.join('\n')}
  </Table>
 </Worksheet>
</Workbook>`;

  return new Response(body, {
    status: 200,
    headers: {
      'content-type': 'application/vnd.ms-excel; charset=utf-8',
      'content-disposition': `attachment; filename="survey-${ts}.xls"`,
      'cache-control': 'no-store',
    },
  });
}

function xlsxCell(value, type, isHeader) {
  // 简单的 XML 转义
  const escaped = String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
  const style = isHeader ? ' ss:StyleID="Header"' : '';
  return `<Cell${style}><Data ss:Type="${type}">${escaped}</Data></Cell>`;
}
