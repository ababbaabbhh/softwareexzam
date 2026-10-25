#!/usr/bin/env node
/**
 * 浏览器端到端测试（Playwright + Chromium）。
 * 覆盖：首页 → 开始考试 → 答题 → 未答拦截 → 交卷 → 成绩 → 历史；手机视口布局与交互。
 *
 * 前置：先启动服务（node server.mjs），再运行本脚本。
 */
import { chromium } from 'playwright';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8787';
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.join(ROOT, 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
function ok(name, cond, detail = '') {
  results.push({ name, ok: !!cond });
  console.log(`  ${cond ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!cond) process.exitCode = 1;
}

const browser = await chromium.launch();

async function newPage(viewport, isMobile = false) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: isMobile ? 2 : 1,
    isMobile,
    hasTouch: isMobile,
    locale: 'zh-CN',
  });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  return { page, context, errors };
}

/* ───────────── 桌面端 ───────────── */
console.log('\n[桌面端 1440×900]');
const { page, context, errors } = await newPage({ width: 1440, height: 900 });
await page.goto(BASE + '/', { waitUntil: 'networkidle' });
await page.waitForSelector('.mode-card');

ok('首页标题与题库统计渲染', await page.locator('.hero h1').textContent().then((t) => t.includes('软件设计师')));
const chips = await page.locator('.hero-stats .chip').allTextContents();
ok('首页显示题型题量统计', chips.length >= 6, chips.join(' | '));
await page.screenshot({ path: path.join(SHOTS, '01-home-desktop.png'), fullPage: true });

// 练习模式
await page.goto(BASE + '/#/practice/basic');
await page.waitForSelector('#practice-card .q-stem');
const ptype = (await page.locator('.q-head .tag').nth(0).textContent()).trim();
if (ptype === '多选题') {
  await page.locator('.q-options .option').nth(0).click();
  await page.locator('.q-options .option').nth(1).click();
} else if (ptype === '填空题') {
  await page.locator('input[data-blank]').first().fill('测试答案');
} else {
  await page.locator('.q-options .option').first().click();
}
await page.locator('#btn-practice-next').click();
await page.waitForSelector('#practice-answer .review-item', { timeout: 10000 });
ok('练习模式：下一题后显示答案', (await page.locator('#practice-answer').textContent()).includes('正确答案') || (await page.locator('#practice-answer').textContent()).includes('参考答案'));
ok('练习模式：显示解析', (await page.locator('#practice-answer .explain').count()) > 0);
const progBefore = (await page.locator('#practice-progress').textContent()).trim();
await page.locator('#btn-practice-next').click();
await page.waitForTimeout(600);
const progAfter = (await page.locator('#practice-progress').textContent()).trim();
ok('练习模式：继续下一题进度递增', progBefore !== progAfter, progBefore + ' → ' + progAfter);
await page.screenshot({ path: path.join(SHOTS, '15-practice.png') });

await page.goto(BASE + '/#/');
await page.waitForSelector('.mode-card');
await page.locator('[data-start="morning"]').click();
await page.waitForSelector('.question-card .q-stem');

const clock1 = await page.locator('#clock').textContent();
ok('考试页显示倒计时', /^\d{1,2}:\d{2}(:\d{2})?$/.test(clock1.trim()), clock1);
ok('上午卷共 75 题', (await page.locator('.sheet-btn').count()) === 75);
ok('答题卡显示题号与状态', (await page.locator('.sheet-btn.answered').count()) === 0, '初始全部未答');
await page.screenshot({ path: path.join(SHOTS, '02-exam-desktop.png'), fullPage: false });

// 作答第 1 题
await page.locator('.q-options .option').first().click();
await page.waitForTimeout(300);
ok('作答后进度更新为 1/75', (await page.locator('#progress').textContent()).includes('1'));
ok('答题卡第 1 题变为已答', (await page.locator('.sheet-btn.answered').count()) === 1);

// 未答拦截
await page.locator('#btn-submit').click();
await page.waitForSelector('.modal');
const modalText = await page.locator('.modal').textContent();
ok('未答完交卷被拦截并提示剩余题数', modalText.includes('74') && modalText.includes('未作答'), modalText.slice(0, 40));
const goBtns = await page.locator('.unanswered-list button').count();
ok('弹窗列出未答题号', goBtns === 74);
await page.screenshot({ path: path.join(SHOTS, '03-unanswered-modal.png') });
await page.locator('[data-m="close"]').click();

// 通过接口补全所有答案（模拟用户连续作答）
await page.evaluate(async () => {
  const id = location.hash.match(/exam\/(\d+)/)[1];
  const paper = await fetch('/api/exams/' + id).then((r) => r.json());
  for (const q of paper.questions) {
    if (q.seq === 1) continue;
    const answer =
      q.type === 'subjective'
        ? '测试作答内容'
        : q.type === 'fill'
          ? Array.from({ length: q.blankCount || 1 }, () => '测试答案')
          : q.type === 'multi'
            ? ['A', 'C']
            : ['A'];
    await fetch(`/api/exams/${id}/answers`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seq: q.seq, answer }),
    });
  }
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('.question-card .q-stem');
ok('刷新后断点续考，作答进度保留', (await page.locator('#progress').textContent()).includes('75'));
ok('答题卡 75 题全部已答', (await page.locator('.sheet-btn.answered').count()) === 75);

// 交卷
await page.locator('#btn-submit').click();
await page.waitForSelector('.modal');
await page.locator('[data-m="yes"]').click();
await page.waitForURL(/#\/result\//, { timeout: 10000 });
await page.waitForSelector('.result-hero');
const morningExamId = Number(page.url().match(/result\/(\d+)/)[1]);

const total = await page.locator('.result-score b').textContent();
ok('交卷后展示成绩', /^\d+(\.\d+)?$/.test(total.trim()), `总分 ${total}`);
ok('成绩页展示合格判定', (await page.locator('.pass-badge').count()) === 1);
ok('成绩页逐题解析数量为 75', (await page.locator('.review-item').count()) === 75);
ok('成绩页展示正确答案与解析', (await page.locator('.explain').count()) > 0);
await page.screenshot({ path: path.join(SHOTS, '04-result-desktop.png'), fullPage: false });

// 历史记录
await page.goto(BASE + '/#/history');
await page.waitForSelector('.history-item');
ok('历史记录包含本场考试', (await page.locator('.history-item').count()) >= 1);
await page.screenshot({ path: path.join(SHOTS, '05-history-desktop.png'), fullPage: true });

ok('桌面端无 JS 控制台错误', errors.length === 0, errors.join('; ').slice(0, 120));

/* ───────────── 下午卷：主观题作答与自评 ───────────── */
console.log('\n[下午卷 主观题]');
await page.goto(BASE + '/#/');
await page.waitForSelector('.mode-card');
await page.locator('[data-start="afternoon"]').click();
await page.waitForSelector('.question-card .q-stem');
ok('下午卷显示主观题答题区', (await page.locator('.subjective-input').count()) === 1);
ok('下午卷共 5 题', (await page.locator('.sheet-btn').count()) === 5);
ok('主观题头部标注题型', (await page.locator('.q-head').textContent()).includes('主观题'));
await page.locator('.subjective-input').fill('问题1：外部实体包括读者、借阅台、财务处。\n问题2：缺失数据流为读者→借阅处理：借书请求。');
await page.waitForTimeout(600);
ok('主观题输入后为已答', (await page.locator('#progress').textContent()).includes('1'));
await page.screenshot({ path: path.join(SHOTS, '10-afternoon-desktop.png') });

await page.evaluate(async () => {
  const id = location.hash.match(/exam\/(\d+)/)[1];
  const paper = await fetch('/api/exams/' + id).then((r) => r.json());
  for (const q of paper.questions) {
    if (q.userAnswer) continue;
    await fetch(`/api/exams/${id}/answers`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seq: q.seq, answer: '测试作答：按小问分别作答。' }),
    });
  }
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('.question-card .q-stem');
ok('下午卷 5 题全部已答', (await page.locator('.sheet-btn.answered').count()) === 5);
await page.locator('#btn-submit').click();
await page.waitForSelector('.modal');
await page.locator('[data-m="yes"]').click();
await page.waitForURL(/#\/result\//, { timeout: 10000 });
await page.waitForSelector('.result-hero');
ok('主观题结果页展示参考答案', (await page.locator('.ref-answer').count()) >= 5);
ok('主观题结果页展示评分要点', (await page.locator('.rubric').count()) >= 5);
ok('主观题自评输入框数量为 5', (await page.locator('[data-grade]').count()) === 5);

const gradeInputs = page.locator('[data-grade]');
const values = [12, 11, 10, 9, 8];
for (let i = 0; i < values.length; i += 1) await gradeInputs.nth(i).fill(String(values[i]));
await page.locator('#btn-save-grade').click();
await page.waitForTimeout(1200);
const subjBox = await page.locator('.score-box').filter({ hasText: '主观题得分' }).textContent();
ok('自评后主观题得分写入（50）', subjBox.includes('50'), subjBox.replace(/\s+/g, ' ').trim());
await page.screenshot({ path: path.join(SHOTS, '11-subjective-graded.png') });

await page.goto(BASE + '/#/history');
await page.waitForSelector('.history-item');
const historyText = await page.locator('.history-item').first().textContent();
ok('历史记录显示主观题得分', historyText.includes('主观 50'), historyText.replace(/\s+/g, ' ').trim().slice(0, 80));

/* ───────────── 历年真题 ───────────── */
console.log('\n[历年真题]');
await page.goto(BASE + '/#/');
await page.waitForSelector('.mode-card');
ok('首页展示历年真题入口', (await page.locator('[data-start-real]').count()) >= 1);
const realTitle = (await page.locator('.paper-item .p-title').first().textContent()).trim();
await page.locator('[data-start-real]').first().click();
await page.waitForSelector('.question-card .q-stem');
ok('真题试卷为 75 题', (await page.locator('.sheet-btn').count()) === 75);
ok('真题考试标题正确', (await page.locator('.exam-title').textContent()).includes('真题'), realTitle);
ok('真题第 1 题来自 2022 下', (await page.locator('.q-head').textContent()).includes('2022下'), '');
await page.screenshot({ path: path.join(SHOTS, '13-real-paper.png') });
await page.evaluate(async () => {
  const id = location.hash.match(/exam\/(\d+)/)[1];
  await fetch(`/api/exams/${id}/abort`, { method: 'POST' });
});

/* ───────────── 重做试卷 ───────────── */
console.log('\n[重做试卷]');
await page.goto(BASE + '/#/result/' + morningExamId);
await page.waitForSelector('#btn-retake');
await page.locator('#btn-retake').click();
await page.waitForSelector('.question-card .q-stem', { timeout: 10000 });
ok('重做试卷：生成新试卷', (await page.locator('.exam-title').textContent()).includes('重做'));
ok('重做试卷：题量与原卷一致', (await page.locator('.sheet-btn').count()) === 75);
await page.screenshot({ path: path.join(SHOTS, '16-retake.png') });
await page.evaluate(async () => {
  const id = location.hash.match(/exam\/(\d+)/)[1];
  await fetch(`/api/exams/${id}/abort`, { method: 'POST' });
});

await context.close();

/* ───────────── 手机端 ───────────── */
console.log('\n[手机端 390×844]');
const mob = await newPage({ width: 390, height: 844 }, true);
const mp = mob.page;
await mp.goto(BASE + '/', { waitUntil: 'networkidle' });
await mp.waitForSelector('.mode-card');
const homeWidth = await mp.evaluate(() => document.documentElement.scrollWidth);
ok('手机端首页无横向滚动', homeWidth <= 391, `scrollWidth=${homeWidth}`);
await mp.screenshot({ path: path.join(SHOTS, '06-home-mobile.png'), fullPage: true });

await mp.locator('[data-start="mixed"]').click();
await mp.waitForSelector('.question-card .q-stem');
ok('手机端考试页显示悬浮答题卡按钮', await mp.locator('#sheet-toggle').isVisible());
ok('手机端顶栏倒计时可见', await mp.locator('#clock').isVisible());
const examWidth = await mp.evaluate(() => document.documentElement.scrollWidth);
ok('手机端考试页无横向滚动', examWidth <= 391, `scrollWidth=${examWidth}`);
await mp.screenshot({ path: path.join(SHOTS, '07-exam-mobile.png') });

await mp.locator('#sheet-toggle').click();
await mp.waitForSelector('.sheet-drawer');
ok('手机端答题卡抽屉可打开', await mp.locator('.sheet-drawer .sheet-btn').count() === 85);
await mp.screenshot({ path: path.join(SHOTS, '08-sheet-mobile.png') });
await mp.locator('.sheet-drawer [data-close]').click();

// 作答一道题并触发未答拦截
await mp.locator('.q-options .option').first().click();
await mp.locator('#btn-submit').click();
await mp.waitForSelector('.modal');
ok('手机端未答拦截弹窗正常', (await mp.locator('.modal').textContent()).includes('未作答'));
await mp.screenshot({ path: path.join(SHOTS, '09-unanswered-mobile.png') });
await mp.locator('[data-m="close"]').click();

ok('手机端无 JS 控制台错误', mob.errors.length === 0, mob.errors.join('; ').slice(0, 120));

// 清理：放弃本场综合卷
await mp.evaluate(async () => {
  const id = location.hash.match(/exam\/(\d+)/)[1];
  await fetch(`/api/exams/${id}/abort`, { method: 'POST' });
});
await mob.context.close();

await browser.close();

const failed = results.filter((r) => !r.ok);
console.log('');
console.log('════════ 浏览器自测结果 ════════');
console.log(`用例 ${results.length} 个，通过 ${results.length - failed.length} 个，失败 ${failed.length} 个`);
console.log(`截图目录：${SHOTS}`);
if (failed.length) {
  for (const f of failed) console.log(`  - ${f.name}`);
  process.exit(1);
}
