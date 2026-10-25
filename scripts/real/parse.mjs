/**
 * 真题解析：从 PDF 提取的纯文本中解析题干、选项与答案。
 *
 * 支持两种版式：
 *  - blank：题干 + “（N） A. … B. …” 选项行，答案统一在文末“参考答案”
 *  - inline：题干 + “A. …” 选项行 + “参考答案：X”，答案紧随题目
 */

const NOISE = [
  /^手机端题库/,
  /^淘宝 APP/,
  /^唯一淘宝店/,
  /^或淘宝 APP/,
  /^软件设计师学习交流/,
  /^全国计算机技术与软件专业技术资格/,
  /^（考试时间/,
  /^请按下述要求/,
  /^\d\. 在答题卡/,
  /^\d\. 本试卷/,
  /^\d\. 每个空格/,
  /^\d\. 解答前/,
  /^例题$/,
  /^因为考试日期/,
  /^月（\d+）日/,
  /^下对 填涂/,
  /^\d+ \/ \d+$/,
  /^软件设计师 上午试卷 ?\d*$/,
  /^202\d 年(上|下)半年 软件设计师 上午试卷 ?\d*$/,
  /^下对/,
  /^富$/,
  /^88 C 89 B$/,
  /^\d+ C \d+ [A-D]$/,
  /^\d+ [A-D] \d+ [A-D]$/,
];

function isNoise(line) {
  return !line || NOISE.some((re) => re.test(line)) || /^[\s\d.]*$/.test(line);
}

/** 去掉选项文本中的多余空白与页码噪声。 */
function clean(s) {
  return s.replace(/\s+/g, ' ').trim();
}

function parseOptions(text) {
  const collect = (re) => {
    const marks = [];
    let m;
    while ((m = re.exec(text)) !== null) {
      marks.push({ letter: m[2], start: m.index + m[1].length, contentStart: re.lastIndex });
    }
    return marks;
  };
  let marks = collect(/(^|\n)([A-D])[.、．]\s*/g);
  if (marks.length < 4) marks = collect(/(^|\s)([A-D])[.、．]\s*/g);
  if (marks.length < 4) return null;
  const opts = [];
  for (let i = 0; i < 4; i += 1) {
    const cur = marks[i];
    const next = marks[i + 1];
    const end = next ? next.start : text.length;
    const value = text.slice(cur.contentStart, end).replace(/[.、．]\s*$/, '').trim();
    opts.push(clean(value));
  }
  return opts;
}

/** 版式 A：题干 + （N）选项行 + 文末答案表。 */
export function parseBlankPaper(text) {
  const lines = text.split('\n').map((s) => s.trim()).filter((l) => l && !isNoise(l));

  const keyIdx = lines.findIndex((l) => /^参考答案/.test(l));
  const keyLines = keyIdx >= 0 ? lines.slice(keyIdx, keyIdx + 12) : [];
  const answers = new Map();
  for (const m of keyLines.join(' ').matchAll(/(\d{1,2})[.、]\s*([A-D])/g)) {
    answers.set(Number(m[1]), m[2]);
  }

  const end = keyIdx >= 0 ? keyIdx : lines.length;
  const items = [];
  let buffer = [];
  let started = false;
  for (let i = 0; i < end; i += 1) {
    const line = lines[i];
    const m = line.match(/^[（(](\d{1,2})[）)]\s*A[.、．]/);
    if (m) {
      if (!started) {
        started = true;
        buffer = [];
      }
      let optText = line.replace(/^[（(]\d+[）)]\s*/, '');
      let j = i + 1;
      // 选项行以 A-D 字母开头；短续行（换行折断）并入上一个选项
      while (j < end) {
        const next = lines[j];
        if (/^[（(]\d{1,2}[）)]/.test(next)) break;
        if (/^[A-D][.、．]/.test(next)) {
          optText += '\n' + next;
          j += 1;
          continue;
        }
        const last = optText.slice(optText.lastIndexOf('\n') + 1);
        const lastMark = optText.match(/[A-D][.、．]\s*[^\n]*$/);
        if (lastMark && next.length <= 20 && !/[。？！]$/.test(lastMark[0])) {
          optText += next;
          j += 1;
          continue;
        }
        break;
      }
      items.push({ n: Number(m[1]), stem: buffer.join('').trim(), options: parseOptions(optText) });
      buffer = [];
      i = j - 1;
      continue;
    }
    if (started) buffer.push(line);
  }

  // 第二遍：多空题共用题干
  let lastStem = '';
  for (const it of items) {
    if (it.stem) lastStem = it.stem;
    else it.stem = lastStem;
  }
  return items
    .filter((it) => it.n >= 1 && it.n <= 75)
    .map((it) => ({ ...it, answer: answers.get(it.n) ?? null }));
}

/** 版式 B：题干 + A./B./C./D. 选项 + “参考答案：X”（含“4.5.”双空题）。 */
export function parseInlinePaper(text) {
  const lines = text.split('\n').map((s) => s.trim()).filter((l) => l && !isNoise(l));
  const isOption = (l) => /^[A-D][.、．]/.test(l);
  const items = [];
  let cur = null;

  const flush = () => {
    if (!cur) return;
    const joined = cur.optLines.join('\n');
    const options = parseOptions(joined);
    items.push({
      n: cur.n,
      extraN: cur.extraN,
      stem: cur.stem.trim(),
      options,
      answers: cur.answers ?? [],
      answer: (cur.answers ?? [])[0] ?? null,
      explanation: cur.explanation.trim(),
    });
    cur = null;
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const qm = line.match(/^(\d{1,2})(?:[.、](\d{1,2}))?[.、]\s*(.*)$/);
    let isQuestion = false;
    if (qm && qm[3].length >= 6) {
      // 题干之后几行内应出现选项行，否则视为解析/公式文本
      for (let k = i + 1; k < Math.min(lines.length, i + 10); k += 1) {
        if (isOption(lines[k])) {
          isQuestion = true;
          break;
        }
        if (/^参考答案/.test(lines[k])) break;
      }
    }
    if (isQuestion) {
      flush();
      cur = {
        n: Number(qm[1]),
        extraN: qm[2] ? Number(qm[2]) : null,
        stem: qm[3] || '',
        optLines: [],
        answers: null,
        explanation: '',
      };
      continue;
    }
    if (!cur) continue;
    if (/^参考答案[:：]/.test(line)) {
      const rest = line.replace(/^参考答案[:：]/, '');
      cur.answers = [...rest.matchAll(/[A-D]/g)].map((m) => m[0]);
      continue;
    }
    if (cur.answers === null) {
      if (isOption(line)) {
        cur.optLines.push(line);
        continue;
      }
      const last = cur.optLines[cur.optLines.length - 1] ?? '';
      if (cur.optLines.length && line.length <= 20 && !/[。？！]$/.test(last)) {
        cur.optLines[cur.optLines.length - 1] = last + line;
        continue;
      }
      if (cur.optLines.length === 0) {
        cur.stem += line;
      } else {
        // 选项之后的非选项文本视为解析
        cur.explanation += line + '\n';
      }
      continue;
    }
    cur.explanation += line + '\n';
  }
  flush();
  return items;
}
