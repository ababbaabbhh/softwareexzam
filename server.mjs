/**
 * 软考软件设计师模拟考试系统 · HTTP 服务。
 *
 * 零依赖：node:http 路由 + node:sqlite 持久化 + 原生静态前端。
 * 启动：node server.mjs（默认 0.0.0.0:8787）
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';
import {
  openDb, bankStats, getExam, getActiveExam, getExamItems, createExam,
  saveAnswer, finishExam, abortExam, updateItemGrade, updateExamScores,
  listExams, deleteExam, answerProgress, listPapers,
  getQuestion, getSetting, setSetting, idsByTypes,
} from './lib/db.mjs';
import { buildPaper, retakePaper, MODES } from './lib/paper.mjs';
import { gradeItem, awardedOf, isAnswered, passLine } from './lib/grade.mjs';
import { randomInt } from 'node:crypto';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT, 'public');
const DEFAULT_DB = path.join(ROOT, 'data', 'questions.db');
const DEFAULT_PORT = Number(process.env.PORT || 8787);
const DEFAULT_HOST = process.env.HOST || '0.0.0.0';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function json(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
  res.end(JSON.stringify(body));
}

function fail(res, status, message, extra = {}) {
  json(res, status, { error: message, ...extra });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 4 * 1024 * 1024) {
        reject(new Error('请求体过大'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('请求体不是合法 JSON'));
      }
    });
    req.on('error', reject);
  });
}

function lanUrl(port) {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const it of list ?? []) {
      if (it.family === 'IPv4' && !it.internal) return `http://${it.address}:${port}`;
    }
  }
  return `http://127.0.0.1:${port}`;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function shuffleIds(ids) {
  for (let i = ids.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  return ids;
}

/** 应用对象：持有数据库与业务方法，便于测试时注入临时数据库。 */
export function createApp({ dbFile = DEFAULT_DB, port = DEFAULT_PORT } = {}) {
  const db = openDb(dbFile);

  function submitExam(examId, { auto = false } = {}) {
    const exam = getExam(db, examId);
    if (!exam || exam.status !== 'in_progress') return;
    const items = getExamItems(db, examId);
    let objective = 0;
    for (const it of items) {
      if (it.type === 'subjective') continue;
      const result = gradeItem(it, it.userAnswer);
      const awarded = awardedOf(it, result);
      updateItemGrade(db, examId, it.seq, {
        isCorrect: result.correct ? 1 : 0,
        awarded,
        graded: false,
      });
      objective += awarded;
    }
    finishExam(db, examId, {
      objectiveScore: round2(objective),
      subjectiveScore: 0,
      totalScore: round2(objective),
      auto,
    });
  }

  /** 到期自动交卷（服务端权威计时）。 */
  function autoSubmitIfExpired(exam) {
    if (!exam || exam.status !== 'in_progress') return exam;
    if (Date.now() < exam.deadline_at) return exam;
    submitExam(exam.id, { auto: true });
    return getExam(db, exam.id);
  }

  function examSummary(e) {
    return {
      id: e.id,
      mode: e.mode,
      title: e.title,
      status: e.status,
      startedAt: e.started_at,
      submittedAt: e.submitted_at,
      deadlineAt: e.deadline_at,
      autoSubmitted: e.auto_submitted,
      objectiveScore: e.objective_score,
      subjectiveScore: e.subjective_score,
      totalScore: e.total_score,
      maxScore: e.max_score,
      durationSec: e.duration_sec,
      passLine: passLine(e.mode, e.max_score),
      modeName: MODES[e.mode]?.name ?? e.mode,
    };
  }

  function publicQuestion(it, { reveal }) {
    const base = {
      seq: it.seq,
      type: it.type,
      topic: it.topic,
      knowledge: it.knowledge,
      difficulty: it.difficulty,
      stem: it.stem,
      options: it.options,
      score: it.score,
      section: it.section,
      userAnswer: it.userAnswer,
      blankCount: it.type === 'fill' ? it.answer.length : undefined,
    };
    if (!reveal) return base;
    return {
      ...base,
      answer: it.answer,
      rubric: it.rubric,
      explanation: it.explanation,
      isCorrect: it.isCorrect,
      awarded: it.awarded,
      graded: it.graded,
    };
  }

  async function handleApi(req, res, pathname, url) {
    const method = req.method;

    if (method === 'GET' && pathname === '/api/health') {
      return json(res, 200, { ok: true, time: Date.now() });
    }

    if (method === 'GET' && pathname === '/api/meta') {
      const stats = bankStats(db);
      const active = autoSubmitIfExpired(getActiveExam(db));
      const byType = Object.fromEntries(stats.byType.map((r) => [r.type, r.n]));
      const byTopic = {};
      for (const r of stats.byTopic) {
        byTopic[r.topic] ??= {};
        byTopic[r.topic][r.type] = r.n;
      }
      return json(res, 200, {
        total: stats.total,
        byType,
        byTopic,
        papers: listPapers(db),
        modes: Object.values(MODES),
        activeExam: active ? examSummary(active) : null,
        lanUrl: lanUrl(port),
        port,
      });
    }

    if (method === 'POST' && pathname === '/api/exams') {
      const body = await readBody(req);
      const mode = body.mode;
      if (!MODES[mode]) return fail(res, 400, '未知考试模式');
      const paperId = mode === 'real' ? String(body.paper || '') : null;
      if (mode === 'real' && !paperId) return fail(res, 400, '真题模考需要选择真题套');
      const active = autoSubmitIfExpired(getActiveExam(db));
      if (active && active.status === 'in_progress') {
        return fail(res, 409, '已有进行中的考试，请先交卷或放弃', { examId: active.id });
      }
      let paper;
      try {
        paper = buildPaper(db, mode, undefined, paperId);
      } catch (err) {
        return fail(res, 400, err.message);
      }
      const examId = createExam(db, {
        mode,
        title: paper.title,
        durationSec: paper.durationSec,
        startedAt: Date.now(),
        items: paper.items,
      });
      return json(res, 201, {
        examId,
        mode,
        title: paper.title,
        durationSec: paper.durationSec,
      });
    }

    if (method === 'GET' && pathname === '/api/practice/next') {
      const mode = url.searchParams.get('mode') === 'application' ? 'application' : 'basic';
      const types = mode === 'basic' ? ['single', 'multi', 'fill', 'tf'] : ['subjective'];
      const key = 'practice-order:' + mode;
      const pos = Math.max(0, Math.floor(Number(url.searchParams.get('pos')) || 0));

      let order = null;
      try {
        order = JSON.parse(getSetting(db, key) || 'null');
      } catch {
        order = null;
      }
      if (!Array.isArray(order) || order.length === 0) {
        order = shuffleIds(idsByTypes(db, types));
        setSetting(db, key, JSON.stringify(order));
      }

      // 一轮抽完后重新洗牌，开启下一轮（题目在下一轮才会再次出现）
      if (pos >= order.length) {
        order = shuffleIds(idsByTypes(db, types));
        setSetting(db, key, JSON.stringify(order));
      }
      const startAt = pos >= order.length ? 0 : pos;

      let idx = startAt;
      let q = null;
      while (idx < order.length) {
        q = getQuestion(db, order[idx]);
        if (q) break;
        idx += 1;
      }
      if (!q) {
        order = shuffleIds(idsByTypes(db, types));
        setSetting(db, key, JSON.stringify(order));
        idx = 0;
        while (idx < order.length && !getQuestion(db, order[idx])) idx += 1;
        q = getQuestion(db, order[idx]);
      }
      if (!q) return fail(res, 500, '题库为空，无法练习');

      return json(res, 200, {
        mode,
        progress: { pos: idx, total: order.length },
        nextPos: idx + 1,
        question: {
          id: q.id,
          type: q.type,
          topic: q.topic,
          knowledge: q.knowledge,
          stem: q.stem,
          options: q.options,
          score: q.score,
          blankCount: q.type === 'fill' ? q.answer.length : undefined,
        },
      });
    }

    if (method === 'POST' && pathname === '/api/practice/check') {
      const body = await readBody(req);
      const q = getQuestion(db, Number(body.qid));
      if (!q) return fail(res, 404, '题目不存在');
      const result = gradeItem(q, body.answer ?? null);
      return json(res, 200, {
        type: q.type,
        correct: result.correct,
        awarded: result.awarded,
        score: q.score,
        matchedBlanks: result.matchedBlanks,
        totalBlanks: result.totalBlanks,
        answer: q.answer,
        explanation: q.explanation,
        rubric: q.rubric,
      });
    }

    if (method === 'GET' && pathname === '/api/papers') {
      return json(res, 200, { papers: listPapers(db) });
    }

    if (method === 'GET' && pathname === '/api/exams') {
      const rows = listExams(db, Number(url.searchParams.get('limit')) || 100).map(examSummary);
      return json(res, 200, { exams: rows });
    }

    const m = pathname.match(/^\/api\/exams\/(\d+)(\/[a-z-]+)?$/);
    if (m) {
      const examId = Number(m[1]);
      const action = m[2] || '';
      const exam = getExam(db, examId);
      if (!exam) return fail(res, 404, '考试不存在');

      if (method === 'GET' && action === '') {
        const current = autoSubmitIfExpired(exam);
        const items = getExamItems(db, examId);
        const revealed = current.status === 'submitted';
        return json(res, 200, {
          exam: examSummary(current),
          status: current.status,
          remainingSec: Math.max(0, Math.floor((current.deadline_at - Date.now()) / 1000)),
          progress: answerProgress(items),
          questions: items.map((it) => publicQuestion(it, { reveal: revealed })),
          passLine: passLine(current.mode, current.max_score),
        });
      }

      if (method === 'PATCH' && action === '/answers') {
        const body = await readBody(req);
        const current = autoSubmitIfExpired(exam);
        if (current.status !== 'in_progress') return fail(res, 409, '考试已结束，无法继续作答');
        const items = getExamItems(db, examId);
        const item = items.find((it) => it.seq === body.seq);
        if (!item) return fail(res, 400, '题号不存在');
        saveAnswer(db, examId, body.seq, body.answer ?? null);
        return json(res, 200, { ok: true });
      }

      if (method === 'POST' && action === '/submit') {
        const current = autoSubmitIfExpired(exam);
        if (current.status === 'submitted') return fail(res, 409, '考试已交卷');
        if (current.status !== 'in_progress') return fail(res, 409, '考试已结束');
        const items = getExamItems(db, examId);
        const unanswered = items
          .filter((it) => !isAnswered(it.type, it.userAnswer))
          .map((it) => it.seq);
        if (unanswered.length > 0) {
          return fail(res, 422, `还有 ${unanswered.length} 题未作答，不能交卷`, { unanswered });
        }
        submitExam(examId, { auto: false });
        return json(res, 200, { ok: true, examId });
      }

      if (method === 'POST' && action === '/abort') {
        if (exam.status === 'in_progress') abortExam(db, examId);
        return json(res, 200, { ok: true });
      }

      if (method === 'GET' && action === '/result') {
        const current = autoSubmitIfExpired(exam);
        const items = getExamItems(db, examId);
        const submitted = current.status === 'submitted';
        const subjective = items.filter((it) => it.type === 'subjective');
        return json(res, 200, {
          exam: examSummary(current),
          status: current.status,
          passLine: passLine(current.mode, current.max_score),
          questions: items.map((it) => publicQuestion(it, { reveal: submitted })),
          subjective: {
            total: subjective.length,
            graded: subjective.filter((it) => it.graded).length,
            score: current.subjective_score ?? 0,
          },
        });
      }

      if (method === 'POST' && action === '/grade-subjective') {
        const body = await readBody(req);
        const current = autoSubmitIfExpired(exam);
        if (current.status !== 'submitted') return fail(res, 409, '请先交卷再评分');
        const items = getExamItems(db, examId);
        const scores = Array.isArray(body.scores) ? body.scores : [];
        for (const s of scores) {
          const item = items.find((it) => it.seq === s.seq && it.type === 'subjective');
          if (!item) return fail(res, 400, `题号 ${s.seq} 不是主观题`);
          const value = Number(s.score);
          if (!Number.isFinite(value) || value < 0 || value > item.score) {
            return fail(res, 400, `题号 ${s.seq} 的分数应在 0-${item.score} 之间`);
          }
          updateItemGrade(db, examId, s.seq, { isCorrect: null, awarded: value, graded: true });
        }
        const fresh = getExamItems(db, examId);
        const subjectiveScore = round2(
          fresh
            .filter((it) => it.type === 'subjective')
            .reduce((sum, it) => sum + (it.awarded ?? 0), 0),
        );
        const objectiveScore = round2(
          fresh
            .filter((it) => it.type !== 'subjective')
            .reduce((sum, it) => sum + (it.awarded ?? 0), 0),
        );
        updateExamScores(db, examId, {
          objectiveScore,
          subjectiveScore,
          totalScore: round2(objectiveScore + subjectiveScore),
        });
        return json(res, 200, {
          ok: true,
          objectiveScore,
          subjectiveScore,
          totalScore: round2(objectiveScore + subjectiveScore),
        });
      }

      if (method === 'POST' && action === '/retake') {
        const active = autoSubmitIfExpired(getActiveExam(db));
        if (active && active.status === 'in_progress') {
          return fail(res, 409, '已有进行中的考试，请先交卷或放弃', { examId: active.id });
        }
        let paper;
        try {
          paper = retakePaper(db, examId);
        } catch (err) {
          return fail(res, 400, err.message);
        }
        const newId = createExam(db, {
          mode: paper.mode,
          title: paper.title,
          durationSec: paper.durationSec,
          startedAt: Date.now(),
          items: paper.items,
        });
        return json(res, 201, { examId: newId, title: paper.title });
      }

      if (method === 'DELETE' && action === '') {
        deleteExam(db, examId);
        return json(res, 200, { ok: true });
      }
    }

    return fail(res, 404, '接口不存在');
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = decodeURIComponent(url.pathname);
    try {
      if (pathname.startsWith('/api/')) {
        await handleApi(req, res, pathname, url);
        return;
      }
      const rel = pathname === '/' ? '/index.html' : pathname;
      const file = path.join(PUBLIC_DIR, rel);
      if (!file.startsWith(PUBLIC_DIR)) return fail(res, 403, '禁止访问');
      fs.readFile(file, (err, data) => {
        if (err) return fail(res, 404, '资源不存在');
        res.writeHead(200, {
          'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
          'Cache-Control': 'no-cache',
        });
        res.end(data);
      });
    } catch (err) {
      console.error('[error]', err);
      fail(res, 500, err.message || '服务器内部错误');
    }
  });

  return { server, db, submitExam, autoSubmitIfExpired };
}

/** 启动服务，返回 { server, db, port, url }。 */
export function startServer({ port = DEFAULT_PORT, host = DEFAULT_HOST, dbFile = DEFAULT_DB } = {}) {
  const app = createApp({ dbFile, port });
  return new Promise((resolve) => {
    app.server.listen(port, host, () => {
      const actualPort = app.server.address().port;
      resolve({ ...app, port: actualPort, url: `http://127.0.0.1:${actualPort}` });
    });
  });
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const { port } = await startServer();
  const dbFile = process.env.DB_FILE || DEFAULT_DB;
  console.log('');
  console.log('  软件设计师 · 全真模拟考试系统');
  console.log('  ─────────────────────────────────────────────');
  console.log(`  本机访问   http://127.0.0.1:${port}`);
  console.log(`  局域网访问 ${lanUrl(port)}`);
  console.log(`  数据库     ${dbFile}`);
  console.log('');
}
