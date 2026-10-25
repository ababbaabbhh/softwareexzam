#!/usr/bin/env node
/**
 * 题库导入脚本：校验 data/raw 后写入 SQLite（data/questions.db）。
 *
 * 用法：
 *   node scripts/seed.mjs            # 增量导入（ext_id 去重，可重复执行）
 *   node scripts/seed.mjs --reset    # 清空题库后重新导入（会一并删除考试记录！）
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectBank, checkQuotas } from '../lib/bank.mjs';
import { openDb, insertQuestions, bankStats } from '../lib/db.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW = path.join(ROOT, 'data', 'raw');
const DB = process.env.DB_FILE || path.join(ROOT, 'data', 'questions.db');
const reset = process.argv.includes('--reset');

const { questions, stats, byType, byTopic } = collectBank(RAW);
const quota = checkQuotas(byType);

if (!questions.length) {
  console.error('没有可导入的题目，请检查 data/raw/*.json');
  process.exit(1);
}

const db = openDb(DB);
if (reset) {
  db.exec('DELETE FROM exam_questions; DELETE FROM exams; DELETE FROM questions;');
  console.log('已清空旧题库与考试记录。');
}

const added = insertQuestions(db, questions);
const after = bankStats(db);

console.log('');
console.log('════════ 题库导入完成 ════════');
console.log(`本次新增      ${added} 题`);
console.log(`数据库总题量  ${after.total} 题`);
console.log('');
console.log('按题型：');
for (const r of after.byType.sort((a, b) => b.n - a.n)) console.log(`  ${r.type.padEnd(12)} ${r.n}`);
console.log('');
console.log('按模块：');
const map = {};
for (const r of after.byTopic) {
  map[r.topic] ??= {};
  map[r.topic][r.type] = r.n;
}
for (const [topic, m] of Object.entries(map)) {
  console.log(`  ${topic.padEnd(9)} ${Object.entries(m).map(([t, n]) => `${t}:${n}`).join('  ')}`);
}
console.log('');
for (const c of quota.checks) {
  console.log(`  ${c.actual >= c.min ? '✅' : '❌'} ${c.label}: ${c.actual}（要求 ≥ ${c.min}）`);
}
console.log('');
if (stats.duplicates) console.log(`去重跳过 ${stats.duplicates} 题`);
if (stats.rejected) console.log(`无效跳过 ${stats.rejected} 题`);
