# 居家护理服务满意度调研

> 静态前端 + Cloudflare Pages Functions + D1 + GitHub 自动化部署

## 功能

- **问卷端**（`/`）：密码门 → 收集客户信息（姓名/电话/服务日期/护理员）→ 20 道评分题（4 维度）→ 提交
- **管理后台**（`/admin`）：登录后查看总览 KPI、4 个 Chart.js 图表（雷达/趋势/各题/护理员排名）、明细表、CSV 导出、日期/护理员筛选

## 项目结构

```
.
├── public/                 # 静态前端（会被 Pages 直接托管）
│   ├── index.html          # 问卷提交页
│   ├── admin.html          # 管理后台
│   └── css|js/
├── functions/              # Pages Functions（API）
│   ├── _lib.js             # 共享：密码/session/维度计算
│   ├── api/
│   │   ├── survey-gate.js  # 密码门
│   │   ├── submit.js       # 提交
│   │   └── admin/
│   │       ├── login.js, logout.js, session.js
│   │       ├── stats.js, submissions.js, export.js
├── migrations/0001_init.sql
├── wrangler.toml
└── package.json
```

## 本地开发

```bash
# 1. 装 wrangler
npm install

# 2. 复制环境变量
cp .dev.vars.example .dev.vars
# 编辑 .dev.vars，填入 SURVEY_PASSWORD / ADMIN_PASSWORD / ADMIN_SESSION_SECRET

# 3. 本地起 D1 + Pages 模拟
npm run db:init:local    # 一次性建表
npm run dev              # http://localhost:8788
```

## 部署到 Cloudflare Pages

### 1. 创建 D1 数据库

```bash
npx wrangler d1 create homecare-survey-db
```

把输出里的 `database_id` 填到 `wrangler.toml` 的 `[[d1_databases]]` 段。

### 2. 推送到远程 D1

```bash
npx wrangler d1 execute homecare-survey-db --file=migrations/0001_init.sql --remote
```

### 3. 创建 Pages 项目

```bash
npx wrangler pages project create homecare-survey
```

### 4. 配置环境变量

在 Cloudflare Dashboard → Pages → homecare-survey → Settings → Environment variables 添加（**Production 和 Preview 都加**）：

| 变量 | 示例 |
| --- | --- |
| `SURVEY_PASSWORD` | 问卷端访问密码 |
| `ADMIN_PASSWORD` | 后台登录密码 |
| `ADMIN_SESSION_SECRET` | 任意 32+ 字符随机串 |

### 5. 推到 GitHub，绑定 Pages

```bash
git init && git add . && git commit -m "init"
gh repo create homecare-survey --public --source=. --push
# 或手动 push 到 GitHub 后，在 Pages Dashboard 选仓库、Build command 留空、Build output = public
```

每次 push main → Pages 自动部署。

## API 一览

| Method | Path | 用途 |
| --- | --- | --- |
| `GET`  | `/api/survey-gate` | 检查问卷 cookie |
| `POST` | `/api/survey-gate` | 验证问卷密码、种 cookie |
| `POST` | `/api/submit` | 提交问卷 |
| `POST` | `/api/admin/login` | 管理员登录 |
| `POST` | `/api/admin/logout` | 退出 |
| `GET`  | `/api/admin/session` | 检查 session |
| `GET`  | `/api/admin/stats` | 聚合统计 |
| `GET`  | `/api/admin/submissions?limit=50` | 明细列表 |
| `GET`  | `/api/admin/export` | CSV 导出 |

所有 `/api/admin/*` 都需要登录后的 `admin_session` cookie；`/api/submit` 需要 `survey_gate` cookie。

## 评分标准

| 维度 | 题号 |
| --- | --- |
| 专业性 | Q1–Q5 |
| 服务态度 | Q6–Q10 |
| 服务效率 | Q11–Q15 |
| 情感体验 | Q16–Q20 |

均分 4.5–5.0 优秀 / 4.0–4.49 良好 / 3.5–3.99 基本满意 / 3.0–3.49 需要改进 / <3.0 重点关注。
# triggered CF Pages deploy at 2026-09-05T08:10:19Z
# env vars PATCH


