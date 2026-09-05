/* POST /api/admin/logout — 清除 session */

import { err, clearAdminCookie } from '../../_lib.js';

export async function onRequestPost() {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8', 'set-cookie': clearAdminCookie() },
  });
}
