#!/usr/bin/env node
/**
 * 自测脚本：评分单元测试 + 组卷质量测试 + 接口全链路测试。
 * 使用临时数据库与随机端口，不污染正式数据。
 *
 * 运行：node tests/selftest.mjs
 */
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb, insertQuestions } from '../lib/db.mjs';
import { gradeItem, awardedOf, normalize, isAnswered } from '../lib/grade.mjs';
import { buildPaper, MODES } from '../lib/paper.mjs';
import { startServer } from '../server.mjs';
import { TOPICS } from '../lib/bank.mjs';

const results = [];
async function check(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  ✅ ${name}`);
  } catch (err) {
    results.push({ name, ok: false, err });
    console.log(`  ❌ ${name}\n     ${err.message}`);
  }
}

/* ─────────────── 1. 评分单元测试 ─────────────── */
console.log('\n[1] 评分规则');

const Q = {
  single: { type: 'single', answer: ['B'], score: 1 },
  multi: { type: 'multi', answer: ['A', 'C'], score: 2 },
  tf: { type: 'tf', answer: ['对'], score: 1 },
  fill: { type: 'fill', answer: ['O(nlogn)|O(n log n)', '快速排序'], score: 2 },
  subjective: { type: 'subjective', answer: ['参考答案'], score: 15, rubric: ['要点一'] },
};

await check('单选题答对得满分', () => {
  const r = gradeItem(Q.single, ['B']);
  assert.equal(r.correct, true);
  assert.equal(awardedOf(Q.single, r), 1);
});

await check('单选题答错不得分', () => {
  const r = gradeItem(Q.single, ['A']);
  assert.equal(r.correct, false);
  assert.equal(awardedOf(Q.single, r), 0);
});

await check('多选题全对得满分', () => {
  const r = gradeItem(Q.multi, ['C', 'A']);
  assert.equal(r.correct, true);
  assert.equal(awardedOf(Q.multi, r), 2);
});

await check('多选题少选/多选/错选均不得分', () => {
  for (const ans of [['A'], ['A', 'B', 'C'], ['B', 'D'], ['A', 'B']]) {
    const r = gradeItem(Q.multi, ans);
    assert.equal(r.correct, false);
  }
});

await check('判断题支持 对/错 与 正确/错误', () => {
  assert.equal(gradeItem(Q.tf, ['对']).correct, true);
  assert.equal(gradeItem(Q.tf, ['正确']).correct, true);
  assert.equal(gradeItem(Q.tf, ['错']).correct, false);
});

await check('填空题忽略大小写、全角、空格', () => {
  assert.equal(gradeItem(Q.fill, ['O(n log n)', '快速排序']).correct, true);
  assert.equal(gradeItem(Q.fill, ['ｏ（ｎｌｏｇｎ）', ' 快速排序 ']).correct, true);
});

await check('填空题按空给分（部分正确）', () => {
  const r = gradeItem(Q.fill, ['O(nlogn)', '冒泡排序']);
  assert.equal(r.awarded, 1);
  assert.equal(r.matchedBlanks, 1);
});

await check('未作答判定为未答且 0 分', () => {
  assert.equal(isAnswered('single', null), false);
  assert.equal(isAnswered('fill', ['', '']), false);
  assert.equal(isAnswered('subjective', '  '), false);
  assert.equal(gradeItem(Q.single, null).awarded, 0);
});

await check('主观题不自动判分', () => {
  const r = gradeItem(Q.subjective, '我的作答');
  assert.equal(r.correct, null);
  assert.equal(r.awarded, null);
});

await check('归一化函数处理全角与空白', () => {
  assert.equal(normalize(' Ａ Ｂ\t'), 'ab');
});

/* ─────────────── 2. 构造测试题库 ─────────────── */
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'softexam-'));
const dbFile = path.join(tmpDir, 'test.db');
console.log(`\n[2] 构造测试题库（临时库：${dbFile}）`);

const topicList = Object.keys(TOPICS);
const rows = [];
let n = 0;
for (const topic of topicList) {
  for (let i = 0; i < 30; i += 1) {
    n += 1;
    rows.push({
      ext_id: `t-${topic}-single-${i}`,
      type: 'single',
      topic,
      knowledge: `${topic}考点${i}`,
      difficulty: (i % 3) + 1,
      stem: `【${topic}】单选题 ${i}：下列关于知识点的描述中，正确的是（ ）。`,
      options: ['选项甲', '选项乙', '选项丙', '选项丁'],
      answer: ['ABCD'[i % 4]],
      rubric: null,
      explanation: '测试用解析。',
      score: 1,
    });
  }
  for (let i = 0; i < 15; i += 1) {
    n += 1;
    rows.push({
      ext_id: `t-${topic}-multi-${i}`,
      type: 'multi',
      topic,
      knowledge: `${topic}多选${i}`,
      difficulty: 2,
      stem: `【${topic}】多选题 ${i}：下列说法正确的有（ ）。`,
      options: ['甲', '乙', '丙', '丁'],
      answer: ['A', 'C'],
      rubric: null,
      explanation: '测试用解析。',
      score: 2,
    });
  }
  for (let i = 0; i < 15; i += 1) {
    n += 1;
    rows.push({
      ext_id: `t-${topic}-fill-${i}`,
      type: 'fill',
      topic,
      knowledge: `${topic}填空${i}`,
      difficulty: 2,
      stem: `【${topic}】填空题 ${i}：____ 是本题的答案。`,
      options: null,
      answer: ['答案'],
      rubric: null,
      explanation: '测试用解析。',
      score: 1,
    });
  }
  for (let i = 0; i < 15; i += 1) {
    n += 1;
    rows.push({
      ext_id: `t-${topic}-tf-${i}`,
      type: 'tf',
      topic,
      knowledge: `${topic}判断${i}`,
      difficulty: 1,
      stem: `【${topic}】判断题 ${i}：这是一条陈述。`,
      options: null,
      answer: ['对'],
      rubric: null,
      explanation: '测试用解析。',
      score: 1,
    });
  }
}

// 模拟一套 75 题的真题
for (let i = 0; i < 75; i += 1) {
  n += 1;
  rows.push({
    ext_id: `t-real-${i + 1}`,
    type: 'single',
    topic: 'DS_ALGO',
    knowledge: `测试下·第${i + 1}题`,
    difficulty: 2,
    stem: `【真题】测试第 ${i + 1} 题：下列关于考点的描述中，正确的是（ ）。`,
    options: ['甲', '乙', '丙', '丁'],
    answer: ['ABCD'[i % 4]],
    rubric: null,
    explanation: '真题解析。',
    score: 1,
    paper: 'TEST下',
    paper_title: '测试真题（上午卷）',
    source: '测试真题',
    seq_no: i + 1,
  });
}

const subjectKnowledge = ['数据流图', '数据库设计', 'UML建模', '算法设计', '程序设计-C++', '程序设计-Java'];
for (const k of subjectKnowledge) {
  for (let i = 0; i < 8; i += 1) {
    n += 1;
    rows.push({
      ext_id: `t-sub-${k}-${i}`,
      type: 'subjective',
      topic: k === '数据库设计' ? 'DB' : k === '数据流图' ? 'SE' : 'OO',
      knowledge: k,
      difficulty: 3,
      stem: `【${k}】案例题 ${i}：某系统需求如下……（问题 1）（问题 2）`,
      options: null,
      answer: ['参考答案：问题 1 答……；问题 2 答……'],
      rubric: ['答出要点一得 5 分', '答出要点二得 5 分', '答出要点三得 5 分'],
      explanation: null,
      score: 15,
    });
  }
}
const seedDb = openDb(dbFile);
insertQuestions(seedDb, rows);
seedDb.close();
console.log(`  已写入测试题 ${rows.length} 道`);

/* ─────────────── 3. 组卷质量测试 ─────────────── */
console.log('\n[3] 组卷质量');

const app = await startServer({ dbFile, port: 0, host: '127.0.0.1' });
const base = app.url;
const db = app.db;

const morningWeights = { DS_ALGO: 17, SE: 14, OO: 11, DB: 10, OS: 8, NET: 6, PL: 5, CO: 2, SEC: 1, MULTI: 1 };

await check('上午卷：75 题、无重复、模块分布符合权重', () => {
  for (let round = 0; round < 10; round += 1) {
    const paper = buildPaper(db, 'morning');
    assert.equal(paper.items.length, 75);
    const qids = new Set(paper.items.map((i) => i.qid));
    assert.equal(qids.size, 75);
    const counts = {};
    for (const it of paper.items) counts[it.topic] = (counts[it.topic] || 0) + 1;
    for (const [topic, want] of Object.entries(morningWeights)) {
      assert.equal(counts[topic], want, `${topic} 应为 ${want} 题，实际 ${counts[topic]}`);
    }
  }
});

await check('上午卷：连续 3 题不同模块', () => {
  const paper = buildPaper(db, 'morning');
  for (let i = 2; i < paper.items.length; i += 1) {
    const a = paper.items[i].topic;
    assert.ok(
      !(a === paper.items[i - 1].topic && a === paper.items[i - 2].topic),
      `第 ${i + 1} 题出现连续 3 题同模块 ${a}`,
    );
  }
});

await check('上午卷：多次组卷题目不同（随机性）', () => {
  const a = buildPaper(db, 'morning').items.map((i) => i.qid).sort().join(',');
  const b = buildPaper(db, 'morning').items.map((i) => i.qid).sort().join(',');
  assert.notEqual(a, b);
});

await check('综合卷：85 题、满分 100、题型齐全', () => {
  const paper = buildPaper(db, 'mixed');
  assert.equal(paper.items.length, 85);
  assert.equal(paper.items.reduce((s, i) => s + i.score, 0), 100);
  const types = new Set(paper.items.map((i) => i.section));
  assert.equal(types.size, 4);
});

await check('真题卷：按套抽取 75 题、顺序为 1-75、标题正确', () => {
  const paper = buildPaper(db, 'real', undefined, 'TEST下');
  assert.equal(paper.items.length, 75);
  assert.equal(paper.title, '测试真题（上午卷）');
  assert.ok(paper.items.every((i) => i.score === 1));
});

check('下午卷：5 道主观题、每题 15 分、题型不重复', () => {
  const paper = buildPaper(db, 'afternoon');
  assert.equal(paper.items.length, 5);
  assert.ok(paper.items.every((i) => i.score === 15));
  assert.equal(new Set(paper.items.map((i) => i.section)).size, 5);
});

/* ─────────────── 4. 接口全链路 ─────────────── */
console.log('\n[4] 接口全链路');

async function call(pathname, opts = {}) {
  const res = await fetch(base + pathname, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

function correctAnswerOf(qid) {
  const row = db.prepare('SELECT type, answer FROM questions WHERE id = ?').get(qid);
  const ans = JSON.parse(row.answer);
  if (row.type === 'fill') return ans.map((a) => String(a).split('|')[0]);
  return ans;
}

async function fillAllAnswers(examId, { onlyCorrect = true } = {}) {
  const items = db
    .prepare('SELECT seq, qid FROM exam_questions WHERE exam_id = ? ORDER BY seq')
    .all(examId);
  const qtypes = new Map(
    db.prepare('SELECT id, type FROM questions').all().map((r) => [r.id, r.type]),
  );
  for (const it of items) {
    const type = qtypes.get(it.qid);
    let answer;
    if (onlyCorrect) answer = correctAnswerOf(it.qid);
    else answer = type === 'subjective' ? '随便写点' : type === 'multi' ? ['A'] : type === 'fill' ? ['乱写'] : ['A'];
    await call(`/api/exams/${examId}/answers`, {
      method: 'PATCH',
      body: JSON.stringify({ seq: it.seq, answer }),
    });
  }
}

let morningId;
await check('健康检查与元信息', async () => {
  const h = await call('/api/health');
  assert.equal(h.status, 200);
  assert.equal(h.data.ok, true);
  const meta = await call('/api/meta');
  assert.equal(meta.status, 200);
  assert.equal(meta.data.total, rows.length);
  assert.ok(meta.data.byType.single >= 300);
  assert.equal(meta.data.modes.length, 4);
});

await check('开始上午卷考试', async () => {
  const r = await call('/api/exams', { method: 'POST', body: JSON.stringify({ mode: 'morning' }) });
  assert.equal(r.status, 201);
  morningId = r.data.examId;
});

await check('进行中重复开考返回 409', async () => {
  const r = await call('/api/exams', { method: 'POST', body: JSON.stringify({ mode: 'morning' }) });
  assert.equal(r.status, 409);
  assert.equal(r.data.examId, morningId);
});

await check('取卷：75 题、不泄露答案、剩余时间正确', async () => {
  const r = await call(`/api/exams/${morningId}`);
  assert.equal(r.status, 200);
  assert.equal(r.data.questions.length, 75);
  assert.equal(r.data.status, 'in_progress');
  assert.ok(r.data.remainingSec > 8900);
  assert.equal(r.data.questions[0].answer, undefined);
  assert.equal(r.data.progress.answered, 0);
});

await check('未答完交卷被拒绝并返回未答题号', async () => {
  const r = await call(`/api/exams/${morningId}/submit`, { method: 'POST' });
  assert.equal(r.status, 422);
  assert.equal(r.data.unanswered.length, 75);
});

await check('逐题作答并保存', async () => {
  const items = db.prepare('SELECT seq FROM exam_questions WHERE exam_id = ?').all(morningId);
  await call(`/api/exams/${morningId}/answers`, {
    method: 'PATCH',
    body: JSON.stringify({ seq: 1, answer: ['A'] }),
  });
  const r = await call(`/api/exams/${morningId}`);
  assert.equal(r.data.progress.answered, 1);
  assert.deepEqual(r.data.questions[0].userAnswer, ['A']);
  assert.equal(items.length, 75);
});

await check('全部答对后交卷满分', async () => {
  await fillAllAnswers(morningId, { onlyCorrect: true });
  const sub = await call(`/api/exams/${morningId}/submit`, { method: 'POST' });
  assert.equal(sub.status, 200);
  const r = await call(`/api/exams/${morningId}/result`);
  assert.equal(r.data.status, 'submitted');
  assert.equal(r.data.exam.totalScore, 75);
  assert.equal(r.data.exam.objectiveScore, 75);
  assert.ok(r.data.questions.every((q) => q.answer !== undefined));
});

await check('历史记录包含本场考试', async () => {
  const r = await call('/api/exams');
  assert.ok(r.data.exams.some((e) => e.id === morningId && e.status === 'submitted'));
});

await check('客观题部分错误时按标准扣分', async () => {
  const created = await call('/api/exams', { method: 'POST', body: JSON.stringify({ mode: 'morning' }) });
  const examId = created.data.examId;
  await fillAllAnswers(examId, { onlyCorrect: false });
  const sub = await call(`/api/exams/${examId}/submit`, { method: 'POST' });
  assert.equal(sub.status, 200);
  const r = await call(`/api/exams/${examId}/result`);
  assert.ok(r.data.exam.totalScore < 75);
  assert.ok(r.data.exam.totalScore >= 0);
});

await check('放弃考试后可重新开考', async () => {
  const created = await call('/api/exams', { method: 'POST', body: JSON.stringify({ mode: 'morning' }) });
  const id = created.data.examId;
  const ab = await call(`/api/exams/${id}/abort`, { method: 'POST' });
  assert.equal(ab.status, 200);
  const again = await call('/api/exams', { method: 'POST', body: JSON.stringify({ mode: 'morning' }) });
  assert.equal(again.status, 201);
  await call(`/api/exams/${again.data.examId}/abort`, { method: 'POST' });
});

await check('倒计时到期自动强制交卷', async () => {
  const created = await call('/api/exams', { method: 'POST', body: JSON.stringify({ mode: 'morning' }) });
  const id = created.data.examId;
  await call(`/api/exams/${id}/answers`, {
    method: 'PATCH',
    body: JSON.stringify({ seq: 1, answer: ['A'] }),
  });
  db.prepare('UPDATE exams SET deadline_at = ? WHERE id = ?').run(Date.now() - 1000, id);
  const r = await call(`/api/exams/${id}`);
  assert.equal(r.data.status, 'submitted');
  assert.equal(r.data.exam.autoSubmitted, 1);
  const result = await call(`/api/exams/${id}/result`);
  assert.equal(result.data.status, 'submitted');
  assert.ok(result.data.exam.totalScore >= 0);
  await call(`/api/exams/${id}`, { method: 'DELETE' });
});

await check('下午卷：交卷后展示参考答案并支持主观题自评', async () => {
  const created = await call('/api/exams', { method: 'POST', body: JSON.stringify({ mode: 'afternoon' }) });
  assert.equal(created.status, 201);
  const id = created.data.examId;
  await fillAllAnswers(id, { onlyCorrect: false });
  const sub = await call(`/api/exams/${id}/submit`, { method: 'POST' });
  assert.equal(sub.status, 200);
  const result = await call(`/api/exams/${id}/result`);
  assert.equal(result.data.questions.length, 5);
  assert.ok(result.data.questions.every((q) => q.type === 'subjective'));
  assert.ok(result.data.questions.every((q) => q.answer?.length > 0));
  assert.ok(result.data.questions.every((q) => q.rubric?.length > 0));

  const scores = result.data.questions.map((q, i) => ({ seq: q.seq, score: 12 - i }));
  const g = await call(`/api/exams/${id}/grade-subjective`, {
    method: 'POST',
    body: JSON.stringify({ scores }),
  });
  assert.equal(g.status, 200);
  assert.equal(g.data.subjectiveScore, 12 + 11 + 10 + 9 + 8);
  const r2 = await call(`/api/exams/${id}/result`);
  assert.equal(r2.data.subjective.graded, 5);
  assert.equal(r2.data.exam.totalScore, r2.data.exam.objectiveScore + r2.data.exam.subjectiveScore);

  const bad = await call(`/api/exams/${id}/grade-subjective`, {
    method: 'POST',
    body: JSON.stringify({ scores: [{ seq: result.data.questions[0].seq, score: 99 }] }),
  });
  assert.equal(bad.status, 400);
});

await check('真题模考：创建、作答、交卷满分、删除', async () => {
  const meta = await call('/api/meta');
  assert.ok(meta.data.papers.some((p) => p.paper === 'TEST下' && p.n === 75));
  const created = await call('/api/exams', {
    method: 'POST',
    body: JSON.stringify({ mode: 'real', paper: 'TEST下' }),
  });
  assert.equal(created.status, 201);
  const id = created.data.examId;
  const paper = await call('/api/exams/' + id);
  assert.equal(paper.data.questions.length, 75);
  assert.ok(paper.data.exam.title.includes('测试真题'));
  await fillAllAnswers(id, { onlyCorrect: true });
  const sub = await call('/api/exams/' + id + '/submit', { method: 'POST' });
  assert.equal(sub.status, 200);
  const result = await call('/api/exams/' + id + '/result');
  assert.equal(result.data.exam.totalScore, 75);
  await call('/api/exams/' + id, { method: 'DELETE' });
});

check('真题模考：不存在的真题套返回 400', async () => {
  const r = await call('/api/exams', { method: 'POST', body: JSON.stringify({ mode: 'real', paper: '不存在' }) });
  assert.equal(r.status, 400);
});

await check('练习模式：整库循环、循环内不重复', async () => {
  const first = await call('/api/practice/next?mode=basic&pos=0');
  assert.equal(first.status, 200);
  assert.equal(first.data.question.answer, undefined);
  const total = first.data.progress.total;
  const ids = [first.data.question.id];
  for (let i = 1; i < total; i += 1) {
    const r = await call('/api/practice/next?mode=basic&pos=' + i);
    assert.equal(r.status, 200);
    assert.equal(r.data.progress.pos, i);
    ids.push(r.data.question.id);
  }
  assert.equal(new Set(ids).size, total, '一轮内不应重复');
  const nextCycle = await call('/api/practice/next?mode=basic&pos=' + total);
  assert.equal(nextCycle.data.progress.pos, 0, '整库抽完后应开启新一轮');
  assert.equal(nextCycle.data.progress.total, total);
});

await check('练习模式：查看答案解析', async () => {
  const r = await call('/api/practice/next?mode=basic');
  const check = await call('/api/practice/check', {
    method: 'POST',
    body: JSON.stringify({ mode: 'basic', qid: r.data.question.id, answer: ['A'] }),
  });
  assert.equal(check.status, 200);
  assert.ok(Array.isArray(check.data.answer) && check.data.answer.length > 0);
  assert.ok('correct' in check.data);
});

await check('练习模式：应用技术主观题返回参考答案与评分要点', async () => {
  const r = await call('/api/practice/next?mode=application');
  assert.equal(r.data.question.type, 'subjective');
  assert.equal(r.data.question.answer, undefined);
  const check = await call('/api/practice/check', {
    method: 'POST',
    body: JSON.stringify({ mode: 'application', qid: r.data.question.id, answer: '测试作答' }),
  });
  assert.equal(check.status, 200);
  assert.ok(check.data.answer.join('').length > 10);
  assert.ok(check.data.rubric.length > 0);
});

await check('重做试卷：题目与顺序完全一致', async () => {
  const created = await call('/api/exams', { method: 'POST', body: JSON.stringify({ mode: 'afternoon' }) });
  const id = created.data.examId;
  await fillAllAnswers(id, { onlyCorrect: false });
  await call('/api/exams/' + id + '/submit', { method: 'POST' });
  const retake = await call('/api/exams/' + id + '/retake', { method: 'POST' });
  assert.equal(retake.status, 201);
  const fresh = await call('/api/exams/' + retake.data.examId);
  const before = await call('/api/exams/' + id);
  assert.equal(fresh.data.questions.length, before.data.questions.length);
  assert.deepEqual(
    fresh.data.questions.map((q) => q.stem),
    before.data.questions.map((q) => q.stem),
  );
  await call('/api/exams/' + retake.data.examId + '/abort', { method: 'POST' });
  await call('/api/exams/' + id, { method: 'DELETE' });
  await call('/api/exams/' + retake.data.examId, { method: 'DELETE' });
});

check('删除考试记录', async () => {
  const r = await call(`/api/exams/${morningId}`, { method: 'DELETE' });
  assert.equal(r.status, 200);
  const list = await call('/api/exams');
  assert.ok(!list.data.exams.some((e) => e.id === morningId));
});

await check('静态页面可访问', async () => {
  const res = await fetch(base + '/');
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.ok(html.includes('软件设计师'));
});

app.server.close();
app.db.close();
fs.rmSync(tmpDir, { recursive: true, force: true });

/* ─────────────── 汇总 ─────────────── */
const failed = results.filter((r) => !r.ok);
console.log('');
console.log('════════ 自测结果 ════════');
console.log(`用例 ${results.length} 个，通过 ${results.length - failed.length} 个，失败 ${failed.length} 个`);
if (failed.length) {
  console.log('失败用例：');
  for (const f of failed) console.log(`  - ${f.name}: ${f.err.message}`);
  process.exit(1);
}
