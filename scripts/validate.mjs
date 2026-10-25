#!/usr/bin/env node
/**
 * 题库校验脚本：读取 data/raw/*.json，校验字段、答案合法性、去重，输出统计与配额检查。
 * 用法：node scripts/validate.mjs [--strict]
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectBank, checkQuotas, TOPICS } from '../lib/bank.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW = path.join(ROOT, 'data', 'raw');
const strict = process.argv.includes('--strict');

const { questions, stats, byType, byTopic } = collectBank(RAW);
const quota = checkQuotas(byType);

console.log('');
console.log('════════ 题库校验报告 ════════');
console.log(`文件数        ${stats.files}`);
console.log(`原始题目      ${stats.total}`);
console.log(`有效题目      ${stats.accepted}`);
console.log(`重复题目      ${stats.duplicates}`);
console.log(`无效题目      ${stats.rejected}`);
console.log('');
console.log('按题型：');
for (const [type, n] of Object.entries(byType).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${type.padEnd(12)} ${n}`);
}
console.log('');
console.log('按模块（题型:数量）：');
for (const [topic, map] of Object.entries(byTopic).sort((a, b) => b[1].single ?? 0 - (a[1].single ?? 0))) {
  const parts = Object.entries(map)
    .map(([t, n]) => `${t}:${n}`)
    .join('  ');
  console.log(`  ${(TOPICS[topic] || topic).padEnd(18)} ${parts}`);
}
console.log('');
console.log('配额检查：');
for (const c of quota.checks) {
  const mark = c.actual >= c.min ? '✅' : '❌';
  console.log(`  ${mark} ${c.label}: ${c.actual} / 要求 ≥ ${c.min}`);
}
if (stats.errors.length) {
  console.log('');
  console.log(`⚠ 无效题目明细（前 30 条，共 ${stats.errors.length} 条）：`);
  for (const e of stats.errors.slice(0, 30)) console.log(`  - ${e}`);
}
if (stats.warnings.length) {
  console.log('');
  console.log(`⚠ 警告（前 20 条，共 ${stats.warnings.length} 条）：`);
  for (const w of stats.warnings.slice(0, 20)) console.log(`  - ${w}`);
}
console.log('');

const ok = quota.ok && stats.accepted > 0 && (strict ? stats.errors.length === 0 : true);
process.exit(ok ? 0 : 1);
