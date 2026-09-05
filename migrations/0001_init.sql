-- 调研提交主表
-- 20 道题每题 1-5 分
-- 4 个维度：专业性(q1-5)、服务态度(q6-10)、服务效率(q11-15)、情感体验(q16-20)
-- 维度得分和总均分在写入时计算并冗余存储，方便统计查询

CREATE TABLE IF NOT EXISTS submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  service_date TEXT NOT NULL,                -- YYYY-MM-DD
  caregiver_name TEXT NOT NULL,
  q1 INTEGER NOT NULL CHECK (q1 BETWEEN 1 AND 5),
  q2 INTEGER NOT NULL CHECK (q2 BETWEEN 1 AND 5),
  q3 INTEGER NOT NULL CHECK (q3 BETWEEN 1 AND 5),
  q4 INTEGER NOT NULL CHECK (q4 BETWEEN 1 AND 5),
  q5 INTEGER NOT NULL CHECK (q5 BETWEEN 1 AND 5),
  q6 INTEGER NOT NULL CHECK (q6 BETWEEN 1 AND 5),
  q7 INTEGER NOT NULL CHECK (q7 BETWEEN 1 AND 5),
  q8 INTEGER NOT NULL CHECK (q8 BETWEEN 1 AND 5),
  q9 INTEGER NOT NULL CHECK (q9 BETWEEN 1 AND 5),
  q10 INTEGER NOT NULL CHECK (q10 BETWEEN 1 AND 5),
  q11 INTEGER NOT NULL CHECK (q11 BETWEEN 1 AND 5),
  q12 INTEGER NOT NULL CHECK (q12 BETWEEN 1 AND 5),
  q13 INTEGER NOT NULL CHECK (q13 BETWEEN 1 AND 5),
  q14 INTEGER NOT NULL CHECK (q14 BETWEEN 1 AND 5),
  q15 INTEGER NOT NULL CHECK (q15 BETWEEN 1 AND 5),
  q16 INTEGER NOT NULL CHECK (q16 BETWEEN 1 AND 5),
  q17 INTEGER NOT NULL CHECK (q17 BETWEEN 1 AND 5),
  q18 INTEGER NOT NULL CHECK (q18 BETWEEN 1 AND 5),
  q19 INTEGER NOT NULL CHECK (q19 BETWEEN 1 AND 5),
  q20 INTEGER NOT NULL CHECK (q20 BETWEEN 1 AND 5),
  professionalism REAL NOT NULL,             -- 专业性 q1-5 均分
  attitude REAL NOT NULL,                    -- 服务态度 q6-10 均分
  efficiency REAL NOT NULL,                  -- 服务效率 q11-15 均分
  emotion REAL NOT NULL,                     -- 情感体验 q16-20 均分
  total_score REAL NOT NULL,                 -- 4 维度均值的均值
  user_agent TEXT,                           -- 提交时的 UA，便于排查
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_submissions_created_at ON submissions(created_at);
CREATE INDEX IF NOT EXISTS idx_submissions_caregiver ON submissions(caregiver_name);
CREATE INDEX IF NOT EXISTS idx_submissions_service_date ON submissions(service_date);
CREATE INDEX IF NOT EXISTS idx_submissions_phone ON submissions(customer_phone);
