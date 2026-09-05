/* GET /api/debug — 临时调试端点，看 context.env 有什么
 * 部署成功后会从 Cloudflare Pages dashboard 删除
 */

export async function onRequestGet(context) {
  return new Response(JSON.stringify({
    envKeys: Object.keys(context.env || {}),
    hasSURVEY: !!(context.env && context.env.SURVEY_PASSWORD),
    hasADMIN: !!(context.env && context.env.ADMIN_PASSWORD),
    hasSESSION: !!(context.env && context.env.ADMIN_SESSION_SECRET),
    hasDB: !!(context.env && context.env.DB),
    requestUrl: context.request.url,
  }, null, 2), {
    headers: { 'content-type': 'application/json' },
  });
}
