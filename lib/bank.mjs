/**
 * 题库读取、规范化与校验。
 *
 * 原始题库位于 data/raw/*.json，规范见 data/raw/QUESTION_SPEC.md。
 * 校验通过后由 scripts/seed.mjs 写入 SQLite。
 */
import fs from 'node:fs';
import path from 'node:path';

export const TOPICS = {
  DS_ALGO: '数据结构与算法',
  SE: '软件工程',
  OO: '面向对象技术',
  DB: '数据库系统',
  OS: '操作系统',
  NET: '计算机网络',
  PL: '程序设计语言与编译原理',
  CO: '计算机组成与体系结构',
  SEC: '信息安全与法律法规',
  MULTI: '多媒体技术',
};

export const TYPES = ['single', 'multi', 'fill', 'tf', 'subjective'];

const LETTERS = 'ABCDE';

/** 去掉可能存在的 Markdown 代码围栏。 */
function stripFence(text) {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

/** 转义 JSON 字符串内部出现的裸换行/制表符（部分生成文件存在此问题）。 */
function escapeRawControlChars(text) {
  let out = '';
  let inString = false;
  let escaped = false;
  for (const ch of text) {
    if (!inString) {
      if (ch === '"') inString = true;
      out += ch;
      continue;
    }
    if (escaped) {
      out += ch;
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      out += ch;
      escaped = true;
      continue;
    }
    if (ch === '"') {
      out += ch;
      inString = false;
      continue;
    }
    if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\t') out += '\\t';
    else out += ch;
  }
  return out;
}

/** 读取一个 JSON 题库文件，返回 { questions, errors }。 */
export function readBankFile(file) {
  const errors = [];
  let raw;
  const text = stripFence(fs.readFileSync(file, 'utf8'));
  try {
    raw = JSON.parse(text);
  } catch (err) {
    try {
      raw = JSON.parse(escapeRawControlChars(text));
    } catch {
      return { questions: [], errors: [`JSON 解析失败：${err.message}`] };
    }
  }
  const list = Array.isArray(raw) ? raw : raw.questions;
  if (!Array.isArray(list)) {
    return { questions: [], errors: ['缺少 questions 数组'] };
  }
  return { questions: list, errors, meta: Array.isArray(raw) ? {} : raw };
}

/** 归一化并校验单题；返回 { q, warnings }，无法修复时抛错。 */
export function normalizeQuestion(item, extId, hintTopic) {
  const warnings = [];
  const must = (cond, msg) => {
    if (!cond) throw new Error(msg);
  };
  must(item && typeof item === 'object', '题目不是对象');
  const type = String(item.type || '').toLowerCase();
  must(TYPES.includes(type), `未知题型 ${item.type}`);
  let topic = String(item.topic || '').toUpperCase();
  if (!TOPICS[topic] && hintTopic && TOPICS[hintTopic]) {
    if (!item.knowledge) item.knowledge = String(item.topic || '').slice(0, 40);
    topic = hintTopic;
  }
  must(TOPICS[topic], `未知模块 ${item.topic}`);
  const stem = String(item.stem || item.question || '').trim();
  must(stem.length >= 8, '题干过短');

  let answer = item.answer;
  let options = item.options;
  let rubric = item.rubric;
  let score = Number(item.score);

  if (type === 'single' || type === 'multi') {
    must(Array.isArray(options) && options.length >= 4 && options.length <= 5, '单选/多选需要 4-5 个选项');
    options = options.map((o) => String(o).trim());
    if (typeof answer === 'string') answer = [answer];
    must(Array.isArray(answer), '答案格式错误');
    answer = [...new Set(answer.map((a) => String(a).toUpperCase().replace(/[^A-E]/g, '')))]
      .filter(Boolean)
      .sort();
    must(answer.length >= 1, '答案不能为空');
    if (type === 'single') must(answer.length === 1, '单选题答案只能有 1 个');
    if (type === 'multi') must(answer.length >= 2, '多选题答案至少 2 个');
    for (const a of answer) {
      must(LETTERS.includes(a) && LETTERS.indexOf(a) < options.length, `答案字母 ${a} 超出选项范围`);
    }
    score = Number.isFinite(score) && score > 0 ? score : 1;
  } else if (type === 'tf') {
    const v = Array.isArray(answer) ? answer[0] : answer;
    const s = String(v ?? '').trim();
    const yes = ['对', '正确', 'true', 't', '√', 'T', 'Y'];
    const no = ['错', '错误', 'false', 'f', '×', 'F', 'N'];
    if (yes.includes(s)) answer = ['对'];
    else if (no.includes(s)) answer = ['错'];
    else throw new Error(`判断题答案非法：${s}`);
    options = null;
    score = Number.isFinite(score) && score > 0 ? score : 1;
  } else if (type === 'fill') {
    if (typeof answer === 'string' || typeof answer === 'number') answer = [String(answer)];
    must(Array.isArray(answer) && answer.length >= 1, '填空题答案不能为空');
    answer = answer.map((a) => String(a).trim());
    const blanks = (stem.match(/_{3,}/g) || []).length;
    if (blanks <= 1 && answer.length !== 1) {
      // 部分生成题用数组元素表示同一个空的多种可接受答案
      answer = [answer.join('|')];
    } else if (blanks > 1 && blanks !== answer.length) {
      throw new Error(`空数(${blanks})与答案数(${answer.length})不一致`);
    }
    options = null;
    score = Number.isFinite(score) && score > 0 ? score : 1;
  } else if (type === 'subjective') {
    if (typeof answer === 'string' || typeof answer === 'number') answer = [String(answer)];
    must(Array.isArray(answer) && answer.join('').trim().length > 0, '主观题缺少标准答案');
    answer = answer.map((a) => String(a));
    if (typeof rubric === 'string') rubric = [rubric];
    rubric = Array.isArray(rubric) ? rubric.map((r) => String(r)).filter(Boolean) : [];
    if (!rubric.length) warnings.push('主观题缺少评分要点');
    options = null;
    score = Number.isFinite(score) && score > 0 ? score : 15;
  }

  return {
    q: {
      ext_id: extId,
      type,
      topic,
      knowledge: String(item.knowledge || '').trim().slice(0, 40) || null,
      difficulty: [1, 2, 3].includes(Number(item.difficulty)) ? Number(item.difficulty) : 2,
      stem,
      options,
      answer,
      rubric: rubric ?? null,
      explanation: String(item.explanation || '').trim() || null,
      score,
      paper: item.paper ? String(item.paper) : null,
      paper_title: item.paper_title ? String(item.paper_title) : null,
      source: item.source ? String(item.source) : null,
      seq_no: Number.isFinite(Number(item.seq_no)) ? Number(item.seq_no) : null,
    },
    warnings,
  };
}

/** 根据文件名推断模块（部分批次的 topic 字段写成了中文考点名）。 */
function topicHintFor(name) {
  const base = name.replace(/\.json$/, '');
  const explicit = { ft6: 'OO', ft7: 'OS', ft8: 'NET' };
  if (explicit[base]) return explicit[base];
  const prefixes = { ds: 'DS_ALGO', se: 'SE', oo: 'OO', db: 'DB', os: 'OS', net: 'NET', pl: 'PL', co: 'CO', sec: 'SEC', multi: 'MULTI' };
  for (const [pre, code] of Object.entries(prefixes)) if (base.startsWith(pre)) return code;
  return null;
}

/** 读取目录下全部题库文件并校验、去重。 */
export function collectBank(dir) {
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json') && !f.startsWith('.'))
    .sort((a, b) => {
      // 真题优先入库：与生成题重复时保留真题、丢弃生成题
      const ra = a.startsWith('real_') ? 0 : 1;
      const rb = b.startsWith('real_') ? 0 : 1;
      return ra - rb || a.localeCompare(b);
    });
  const accepted = [];
  const seen = new Set();
  const stats = {
    files: 0,
    total: 0,
    accepted: 0,
    rejected: 0,
    duplicates: 0,
    warnings: [],
    errors: [],
  };
  const byType = {};
  const byTopic = {};

  for (const name of files) {
    const file = path.join(dir, name);
    const { questions, errors, meta } = readBankFile(file);
    stats.files += 1;
    if (errors.length) {
      stats.errors.push(`${name}: ${errors.join('; ')}`);
      continue;
    }
    const fileMeta = meta ?? {};
    questions.forEach((item, idx) => {
      stats.total += 1;
      try {
        if (!item.paper_title && fileMeta.title) item.paper_title = fileMeta.title;
        if (!item.paper && fileMeta.paper) item.paper = fileMeta.paper;
        const { q, warnings } = normalizeQuestion(
          item,
          `${name.replace(/\.json$/, '')}#${idx + 1}`,
          topicHintFor(name),
        );
        const key = q.paper
          ? `${q.paper}#${q.seq_no}#${q.stem}`
          : q.stem.replace(/[\s，,。.、；;：:（）()【】\[\]"'“”‘’]/g, '').toLowerCase();
        if (seen.has(key)) {
          stats.duplicates += 1;
          return;
        }
        seen.add(key);
        for (const w of warnings) stats.warnings.push(`${name}#${idx + 1}: ${w}`);
        accepted.push(q);
        stats.accepted += 1;
        byType[q.type] = (byType[q.type] || 0) + 1;
        byTopic[q.topic] = byTopic[q.topic] || {};
        byTopic[q.topic][q.type] = (byTopic[q.topic][q.type] || 0) + 1;
      } catch (err) {
        stats.rejected += 1;
        stats.errors.push(`${name}#${idx + 1}: ${err.message}`);
      }
    });
  }

  return { questions: accepted, stats, byType, byTopic };
}

/** 配额验收线（见开发文档 6.3）。 */
export const QUOTAS = {
  objective: { label: '单选题+多选题', min: 1000 },
  filltf: { label: '填空题+判断题', min: 500 },
  subjective: { label: '主观题', min: 200 },
};

/** 检查配额，返回 { ok, checks }。 */
export function checkQuotas(byType) {
  const single = byType.single || 0;
  const multi = byType.multi || 0;
  const fill = byType.fill || 0;
  const tf = byType.tf || 0;
  const subjective = byType.subjective || 0;
  const checks = [
    { ...QUOTAS.objective, actual: single + multi },
    { ...QUOTAS.filltf, actual: fill + tf },
    { ...QUOTAS.subjective, actual: subjective },
  ];
  return { ok: checks.every((c) => c.actual >= c.min), checks };
}
