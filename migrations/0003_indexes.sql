-- 复合索引 + 额外索引（按实际查询模式）
-- 1) (service_date, caregiver_name)：stats.js 按月 + 护理员查
-- 2) (caregiver_name, service_date)：排名 + 月份对比
CREATE INDEX IF NOT EXISTS idx_submissions_date_caregiver
  ON submissions(service_date, caregiver_name);

CREATE INDEX IF NOT EXISTS idx_submissions_caregiver_date
  ON submissions(caregiver_name, service_date);

-- 按 total_score 排序（admin 排名）
CREATE INDEX IF NOT EXISTS idx_submissions_total_score
  ON submissions(total_score);
