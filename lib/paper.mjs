/**
 * 组卷策略。
 *
 * 上午卷：按真题知识点权重抽取 75 道单选题（每模块按难度分层随机）。
 * 下午卷：5 道主观题，分别对应数据流图、数据库设计、UML 建模、算法设计、程序设计（C++/Java 随机）。
 * 综合训练卷：单选 40 + 多选 15 + 填空 15 + 判断 15，按模块权重分散抽取。
 */
import { randomInt } from 'node:crypto';
import { pool, poolByKnowledge, getExam, getExamItems } from './db.mjs';

export const MODES = {
  morning: {
    key: 'morning',
    name: '上午卷 · 基础知识',
    short: '上午卷',
    desc: '75 道单选题 · 150 分钟 · 满分 75 分 · 45 分合格',
    durationSec: 150 * 60,
  },
  afternoon: {
    key: 'afternoon',
    name: '下午卷 · 应用技术',
    short: '下午卷',
    desc: '5 道案例分析题 · 150 分钟 · 满分 75 分 · 45 分合格（主观题自评）',
    durationSec: 150 * 60,
  },
  mixed: {
    key: 'mixed',
    name: '综合训练卷',
    short: '综合训练',
    desc: '单选 40 + 多选 15 + 填空 15 + 判断 15 · 120 分钟 · 满分 100 分',
    durationSec: 120 * 60,
  },
  real: {
    key: 'real',
    name: '历年真题',
    short: '真题',
    desc: '按年份抽取完整上午真题 · 75 题 · 150 分钟 · 满分 75 分',
    durationSec: 150 * 60,
  },
};

/** 上午卷各模块抽题数（合计 75，与真题分布一致）。 */
const MORNING_WEIGHTS = {
  DS_ALGO: 17,
  SE: 14,
  OO: 11,
  DB: 10,
  OS: 8,
  NET: 6,
  PL: 5,
  CO: 2,
  SEC: 1,
  MULTI: 1,
};

/** 综合训练卷各题型题量与各模块权重。 */
const MIXED_PLAN = [
  { type: 'single', count: 40, score: 1 },
  { type: 'multi', count: 15, score: 2 },
  { type: 'fill', count: 15, score: 1 },
  { type: 'tf', count: 15, score: 1 },
];
const MIXED_TOPIC_WEIGHT = {
  DS_ALGO: 22,
  SE: 18,
  OO: 14,
  DB: 14,
  OS: 10,
  NET: 9,
  PL: 6,
  CO: 4,
  SEC: 2,
  MULTI: 1,
};

/** 下午卷五大题型。 */
const AFTERNOON_SLOTS = [
  { knowledge: '数据流图', label: '试题一 · 数据流图', desc: '数据流图补全与平衡性分析' },
  { knowledge: '数据库设计', label: '试题二 · 数据库设计', desc: 'E-R 图转关系模式、SQL 与范式' },
  { knowledge: 'UML建模', label: '试题三 · UML 建模', desc: '类图、用例图与状态图建模' },
  { knowledge: '算法设计', label: '试题四 · 算法设计', desc: '算法补全与时间复杂度分析' },
];

function shuffle(arr, rng = randomInt) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = rng(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * 从题目池中按难度分层抽取 count 道。
 * 难度目标比例 易:中:难 = 3.5 : 4.5 : 2，不足时用其它难度补齐。
 */
function sample(poolItems, count, used, rng) {
  const avail = shuffle(poolItems.filter((q) => !used.has(q.id)), rng);
  if (avail.length < count) return null;
  const easy = avail.filter((q) => q.difficulty <= 1);
  const mid = avail.filter((q) => q.difficulty === 2);
  const hard = avail.filter((q) => q.difficulty >= 3);
  const wantEasy = Math.round(count * 0.35);
  const wantHard = Math.round(count * 0.2);
  const wantMid = count - wantEasy - wantHard;
  const picked = [];
  const take = (list, n) => {
    for (const q of list) {
      if (picked.length >= count - (count - wantEasy - wantMid - wantHard)) break;
      if (n <= 0) break;
      if (picked.includes(q)) continue;
      picked.push(q);
      n -= 1;
    }
  };
  take(easy, wantEasy);
  take(mid, wantMid);
  take(hard, wantHard);
  for (const q of avail) {
    if (picked.length >= count) break;
    if (!picked.includes(q)) picked.push(q);
  }
  if (picked.length < count) return null;
  for (const q of picked) used.add(q.id);
  return picked;
}

/**
 * 按权重把 count 道题分配到各模块。
 * @returns {Array<{topic: string, n: number}>}
 */
function splitByWeight(weights, count) {
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  const entries = Object.entries(weights).map(([topic, w]) => ({
    topic,
    exact: (w * count) / total,
  }));
  const base = entries.map((e) => ({ topic: e.topic, n: Math.floor(e.exact) }));
  let rest = count - base.reduce((a, b) => a + b.n, 0);
  const byFrac = [...entries].sort(
    (a, b) => b.exact - Math.floor(b.exact) - (a.exact - Math.floor(a.exact)),
  );
  for (const e of byFrac) {
    if (rest <= 0) break;
    const item = base.find((b) => b.topic === e.topic);
    item.n += 1;
    rest -= 1;
  }
  return base;
}

/** 打乱顺序并修复"连续 3 题同模块"的情况。 */
function interleave(items, rng) {
  const a = shuffle(items, rng);
  for (let i = 2; i < a.length; i += 1) {
    if (a[i].topic === a[i - 1].topic && a[i].topic === a[i - 2].topic) {
      const j = a.findIndex((x, k) => k > i && x.topic !== a[i].topic);
      if (j > -1) [a[i], a[j]] = [a[j], a[i]];
    }
  }
  return a;
}

function buildMorning(db, rng) {
  const used = new Set();
  const items = [];
  for (const { topic, n } of splitByWeight(MORNING_WEIGHTS, 75)) {
    if (n === 0) continue;
    const picked = sample(pool(db, 'single', topic), n, used, rng);
    if (!picked) {
      throw new Error(`题库不足：模块 ${topic} 的单选题不足以抽取 ${n} 道，请先扩充题库`);
    }
    items.push(...picked.map((q) => ({ q, section: '上午卷 · 单项选择题' })));
  }
  // 若某模块题库不足导致的缺口，用全局池补齐（正常情况下不会走到）。
  if (items.length < 75) {
    const rest = sample(pool(db, 'single'), 75 - items.length, used, rng);
    if (rest) items.push(...rest.map((q) => ({ q, section: '上午卷 · 单项选择题' })));
  }
  if (items.length !== 75) throw new Error('题库不足：无法凑齐 75 道上午卷单选题');
  return {
    title: '软件设计师 · 上午卷（基础知识）模拟',
    durationSec: MODES.morning.durationSec,
    items: interleave(
      items.map((it) => ({ qid: it.q.id, topic: it.q.topic, section: it.section, score: 1 })),
      rng,
    ),
  };
}

function buildMixed(db, rng) {
  const used = new Set();
  const items = [];
  for (const { type, count, score } of MIXED_PLAN) {
    const pickedAll = [];
    for (const { topic, n } of splitByWeight(MIXED_TOPIC_WEIGHT, count)) {
      if (n === 0) continue;
      const picked = sample(pool(db, type, topic), n, used, rng);
      if (!picked) {
        const global = sample(pool(db, type), n, used, rng);
        if (!global) throw new Error(`题库不足：${type} 题型不足以抽取 ${count} 道`);
        pickedAll.push(...global);
        continue;
      }
      pickedAll.push(...picked);
    }
    if (pickedAll.length < count) {
      const rest = sample(pool(db, type), count - pickedAll.length, used, rng);
      if (!rest) throw new Error(`题库不足：${type} 题型不足以抽取 ${count} 道`);
      pickedAll.push(...rest);
    }
    const section = {
      single: '一、单项选择题',
      multi: '二、多项选择题',
      fill: '三、填空题',
      tf: '四、判断题',
    }[type];
    items.push(
      ...pickedAll.map((q) => ({ qid: q.id, topic: q.topic, section, score })),
    );
  }
  return {
    title: '软件设计师 · 综合训练模拟卷',
    durationSec: MODES.mixed.durationSec,
    items,
  };
}

function buildAfternoon(db, rng) {
  const used = new Set();
  const items = [];
  for (const slot of AFTERNOON_SLOTS) {
    const picked = sample(poolByKnowledge(db, 'subjective', slot.knowledge), 1, used, rng);
    if (!picked) throw new Error(`题库不足：缺少"${slot.knowledge}"主观题`);
    const q = picked[0];
    items.push({ qid: q.id, topic: q.topic, section: slot.label, score: 15 });
  }
  const lang = rng(2) === 0 ? '程序设计-C++' : '程序设计-Java';
  const picked = sample(poolByKnowledge(db, 'subjective', lang), 1, used, rng);
  if (!picked) throw new Error(`题库不足：缺少"${lang}"主观题`);
  items.push({
    qid: picked[0].id,
    topic: picked[0].topic,
    section: `试题五 · 程序设计（${lang.replace('程序设计-', '')}）`,
    score: 15,
  });
  return { title: '软件设计师 · 下午卷（应用技术）模拟', durationSec: MODES.afternoon.durationSec, items };
}

/** 复制一份试卷（题目、顺序、分值完全相同），用于“重做这套试卷”。 */
export function retakePaper(db, sourceExamId) {
  const src = getExam(db, sourceExamId);
  if (!src) throw new Error('原试卷不存在');
  const items = getExamItems(db, sourceExamId);
  if (!items.length) throw new Error('原试卷没有题目');
  return {
    title: `${src.title}（重做）`,
    durationSec: src.duration_sec,
    mode: src.mode,
    items: items.map((it) => ({ qid: it.id, topic: it.topic, section: it.section, score: it.score })),
  };
}

function buildRealPaper(db, paperId) {
  const rows = db
    .prepare('SELECT * FROM questions WHERE paper = ? ORDER BY seq_no')
    .all(paperId);
  if (rows.length === 0) throw new Error(`真题套「${paperId}」不存在，请先导入`);
  if (rows.length !== 75) throw new Error(`真题套「${paperId}」题量为 ${rows.length}，应为 75 题`);
  const title = rows[0].paper_title || paperId;
  return {
    title: `${title}`,
    durationSec: MODES.real.durationSec,
    items: rows.map((r, i) => ({
      qid: r.id,
      topic: r.topic,
      section: '上午卷 · 单项选择题',
      score: 1,
      seqNo: i + 1,
    })),
  };
}

/** 组卷入口。返回 {title, durationSec, items}。 */
export function buildPaper(db, mode, rng = randomInt, paperId = null) {
  switch (mode) {
    case 'morning':
      return buildMorning(db, rng);
    case 'afternoon':
      return buildAfternoon(db, rng);
    case 'mixed':
      return buildMixed(db, rng);
    case 'real':
      if (!paperId) throw new Error('真题模考需要指定真题套');
      return buildRealPaper(db, paperId);
    default:
      throw new Error(`未知考试模式：${mode}`);
  }
}
