/**
 * 评分逻辑：客观题自动判分（单选/多选/判断/填空）。
 *
 * 多选采用"全对得分"标准；填空按空给分（部分正确按比例）。
 * 主观题不自动判分，交卷后由用户依据标准答案与评分要点自评。
 */

const FULLWIDTH_OFFSET = 0xfee0;

/** 归一化：全角转半角、去空白、去全角空格、统一小写。 */
export function normalize(value) {
  if (value == null) return '';
  let s = String(value);
  s = s
    .replace(/[\uff01-\uff5e]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - FULLWIDTH_OFFSET))
    .replace(/\u3000/g, ' ')
    .toLowerCase();
  return s.replace(/\s+/g, '');
}

/** 判断用户是否已作答。 */
export function isAnswered(type, answer) {
  if (type === 'subjective') return typeof answer === 'string' && answer.trim() !== '';
  return Array.isArray(answer) && answer.filter((a) => String(a ?? '').trim() !== '').length > 0;
}

/** 顺序无关地比较两个字母数组。 */
function sameSet(a = [], b = []) {
  const x = [...a].map((s) => String(s).toUpperCase()).sort();
  const y = [...b].map((s) => String(s).toUpperCase()).sort();
  return x.length === y.length && x.every((v, i) => v === y[i]);
}

/** 判断题答案归一：对/错、正确/错误、T/F、√/× 归一为 对/错。 */
function normalizeJudge(v) {
  const s = normalize(v);
  if (['对', '正确', 't', 'true', '√', 'y', 'yes', '是'].includes(s)) return '对';
  if (['错', '错误', 'f', 'false', '×', 'x', 'n', 'no', '否'].includes(s)) return '错';
  return s;
}

/**
 * 给一道客观题判分。
 * @returns {{correct: boolean|null, awarded: number|null, matchedBlanks?: number, totalBlanks?: number}}
 * 主观题返回 {correct: null, awarded: null}。
 */
export function gradeItem(question, userAnswer) {
  const score = Number(question.score) || 0;
  if (question.type === 'subjective') return { correct: null, awarded: null };

  if (!isAnswered(question.type, userAnswer)) return { correct: false, awarded: 0 };

  switch (question.type) {
    case 'single':
      return { correct: normalize(userAnswer[0]) === normalize(question.answer[0]), awarded: null };
    case 'multi':
      return { correct: sameSet(userAnswer, question.answer), awarded: null };
    case 'tf':
      return {
        correct: normalizeJudge(userAnswer[0]) === normalizeJudge(question.answer[0]),
        awarded: null,
      };
    case 'fill': {
      const blanks = question.answer.length;
      let matched = 0;
      for (let i = 0; i < blanks; i += 1) {
        const candidates = String(question.answer[i] ?? '')
          .split('|')
          .map(normalize)
          .filter(Boolean);
        const got = normalize(userAnswer[i] ?? '');
        if (got && candidates.includes(got)) matched += 1;
      }
      const awarded = Math.round((score * matched * 100) / blanks) / 100;
      return { correct: matched === blanks, awarded, matchedBlanks: matched, totalBlanks: blanks };
    }
    default:
      return { correct: null, awarded: null };
  }
}

/** 把判分结果换算成实际得分。 */
export function awardedOf(question, result) {
  if (result.awarded != null) return result.awarded;
  return result.correct ? Number(question.score) || 0 : 0;
}

/** 试卷合格线：上午/下午卷 45 分（满分 75），综合卷 60%。 */
export function passLine(mode, maxScore) {
  if (mode === 'morning' || mode === 'afternoon') return 45;
  return Math.round(maxScore * 0.6 * 100) / 100;
}
