/* 共享工具：密码校验、session 签名、维度计算、CORS、JSON 响应
 * Pages Functions 不会把 _lib.js 当作路由，可以被其它 handler import
 */

const COOKIE_SURVEY = 'survey_gate';
const COOKIE_ADMIN  = 'admin_session';
const COOKIE_OPTS_BASE = 'Path=/; HttpOnly; SameSite=Strict; Secure';

// ===== JSON 响应 =====
export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...extraHeaders },
  });
}

// ===== 错误响应 =====
export function err(message, status = 400) {
  return json({ error: message }, status);
}

// ===== 读环境变量（兼容 Pages env 与 wrangler .dev.vars） =====
export function env(context) {
  // Pages Functions 兼容：env 在 context.env；wrangler pages dev 下 .dev.vars 也会被注入
  return context.env || {};
}

// ===== 通用：校验字符串非空 =====
export function need(value, name) {
  if (value == null || (typeof value === 'string' && value.trim() === '')) {
    throw new Error(`缺少参数：${name}`);
  }
  return typeof value === 'string' ? value.trim() : value;
}

// ===== HMAC 签名（用于 session token） =====
async function hmacKey(secret) {
  const enc = new TextEncoder();
  return crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']
  );
}

export async function signToken(payload, secret) {
  const body = btoa(JSON.stringify(payload)).replace(/=+$/, '');
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/=+$/, '');
  return `${body}.${sigB64}`;
}

export async function verifyToken(token, secret) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  try {
    const key = await hmacKey(secret);
    const sigBytes = Uint8Array.from(atob(sig + '==='.slice((sig + '===').length % 4)), (c) => c.charCodeAt(0));
    const ok = await crypto.subtle.verify('HMAC', key, sigBytes, new TextEncoder().encode(body));
    if (!ok) return null;
    return JSON.parse(atob(body));
  } catch (_) {
    return null;
  }
}

// ===== Cookie 解析 =====
function parseCookies(cookieHeader) {
  const out = {};
  if (!cookieHeader) return out;
  for (const part of cookieHeader.split(/;\s*/)) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    out[part.slice(0, idx)] = decodeURIComponent(part.slice(idx + 1));
  }
  return out;
}

export function readCookie(request, name) {
  const cookies = parseCookies(request.headers.get('cookie'));
  return cookies[name];
}

// ===== 问卷密码门 =====
export function setSurveyCookie(maxAge = 1800) {
  return `${COOKIE_SURVEY}=1; Max-Age=${maxAge}; ${COOKIE_OPTS_BASE}`;
}
export function clearSurveyCookie() {
  return `${COOKIE_SURVEY}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;
}
export function hasSurveyCookie(request) {
  return readCookie(request, COOKIE_SURVEY) === '1';
}

// ===== Admin session =====
export async function setAdminCookie(secret, maxAge = 7200) {
  const token = await signToken({ admin: true, iat: Date.now() }, secret);
  return `${COOKIE_ADMIN}=${encodeURIComponent(token)}; Max-Age=${maxAge}; ${COOKIE_OPTS_BASE}`;
}
export async function readAdminSession(request, secret) {
  const raw = readCookie(request, COOKIE_ADMIN);
  if (!raw) return null;
  return await verifyToken(decodeURIComponent(raw), secret);
}
export function clearAdminCookie() {
  return `${COOKIE_ADMIN}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;
}

// ===== 维度计算 =====
// 4 维度 × 10 题 = 40 题
//   Q1-Q10  专业性
//   Q11-Q20 服务态度
//   Q21-Q30 服务效率
//   Q31-Q40 情感体验
export function calcDimensions(scores) {
  // scores: 长度 40 的数组
  const avg = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
  const p = avg(scores.slice(0, 10));
  const a = avg(scores.slice(10, 20));
  const e = avg(scores.slice(20, 30));
  const m = avg(scores.slice(30, 40));
  const t = (p + a + e + m) / 4;
  return {
    professionalism: round2(p),
    attitude: round2(a),
    efficiency: round2(e),
    emotion: round2(m),
    total_score: round2(t),
  };
}

export function round2(n) {
  return Math.round(n * 100) / 100;
}

// ===== 评分等级 =====
export function gradeLevel(v) {
  if (v >= 4.5) return '优秀';
  if (v >= 4.0) return '良好';
  if (v >= 3.5) return '基本满意';
  if (v >= 3.0) return '需要改进';
  return '重点关注';
}

// ===== 评分校验 =====
export function validateScores(scores) {
  if (!Array.isArray(scores) || scores.length !== 40) {
    throw new Error('评分数据不完整（需 40 题）');
  }
  for (let i = 0; i < 40; i++) {
    const v = scores[i];
    if (!Number.isInteger(v) || v < 1 || v > 5) {
      throw new Error(`第 ${i + 1} 题评分无效`);
    }
  }
  return scores;
}

// ===== 字符串字段清洗 =====
export function cleanString(s, maxLen = 100) {
  if (typeof s !== 'string') return '';
  return s.trim().slice(0, maxLen);
}
