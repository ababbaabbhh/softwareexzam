/**
 * SQLite 数据访问层。
 *
 * 使用 Node 22 内置的 node:sqlite（DatabaseSync），无需原生编译依赖。
 * 表结构见 docs/开发文档.md 第 5 章。
 */
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS questions (
  id          INTEGER PRIMARY KEY,
  ext_id      TEXT UNIQUE,
  type        TEXT NOT NULL,
  topic       TEXT NOT NULL,
  knowledge   TEXT,
  difficulty  INTEGER DEFAULT 2,
  stem        TEXT NOT NULL,
  options     TEXT,
  answer      TEXT NOT NULL,
  rubric      TEXT,
  explanation TEXT,
  score       REAL NOT NULL DEFAULT 1,
  paper       TEXT,
  paper_title TEXT,
  source      TEXT,
  seq_no      INTEGER
);
CREATE INDEX IF NOT EXISTS idx_questions_type_topic ON questions(type, topic);

CREATE TABLE IF NOT EXISTS exams (
  id              INTEGER PRIMARY KEY,
  mode            TEXT NOT NULL,
  title           TEXT,
  duration_sec    INTEGER NOT NULL,
  started_at      INTEGER NOT NULL,
  deadline_at     INTEGER NOT NULL,
  submitted_at    INTEGER,
  status          TEXT NOT NULL DEFAULT 'in_progress',
  auto_submitted  INTEGER DEFAULT 0,
  objective_score REAL,
  subjective_score REAL,
  total_score     REAL,
  max_score       REAL
);

CREATE TABLE IF NOT EXISTS exam_questions (
  exam_id     INTEGER NOT NULL,
  seq         INTEGER NOT NULL,
  qid         INTEGER NOT NULL,
  section     TEXT NOT NULL,
  score       REAL NOT NULL,
  user_answer TEXT,
  is_correct  INTEGER,
  awarded     REAL,
  graded      INTEGER DEFAULT 0,
  PRIMARY KEY (exam_id, seq)
);

CREATE TABLE IF NOT EXISTS settings (
  k TEXT PRIMARY KEY,
  v TEXT
);
`;

/** 打开（必要时创建）数据库并初始化表结构。 */
export function openDb(file) {
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

/** 为旧库补充真题相关列。 */
function migrate(conn) {
  const cols = new Set(conn.prepare('PRAGMA table_info(questions)').all().map((c) => c.name));
  for (const [col, type] of [['paper', 'TEXT'], ['paper_title', 'TEXT'], ['source', 'TEXT'], ['seq_no', 'INTEGER']]) {
    if (!cols.has(col)) conn.exec(`ALTER TABLE questions ADD COLUMN ${col} ${type}`);
  }
}

/** 批量写入题目，ext_id 冲突时忽略。返回新增条数。 */
export function insertQuestions(db, rows) {
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO questions
      (ext_id, type, topic, knowledge, difficulty, stem, options, answer, rubric, explanation, score, paper, paper_title, source, seq_no)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  let added = 0;
  db.exec('BEGIN');
  try {
    for (const q of rows) {
      const r = stmt.run(
        q.ext_id,
        q.type,
        q.topic,
        q.knowledge ?? null,
        q.difficulty ?? 2,
        q.stem,
        q.options ? JSON.stringify(q.options) : null,
        JSON.stringify(q.answer),
        q.rubric ? JSON.stringify(q.rubric) : null,
        q.explanation ?? null,
        q.score ?? (q.type === 'subjective' ? 15 : 1),
        q.paper ?? null,
        q.paper_title ?? null,
        q.source ?? null,
        q.seq_no ?? null,
      );
      if (r.changes > 0) added += 1;
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return added;
}

export function getSetting(db, k) {
  const row = db.prepare('SELECT v FROM settings WHERE k = ?').get(k);
  return row ? row.v : null;
}

export function setSetting(db, k, v) {
  db.prepare('INSERT INTO settings (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v').run(
    k,
    v,
  );
}

/** 按题型集合取题目 ID 列表（练习模式抽题池）。 */
export function idsByTypes(db, types) {
  const marks = types.map(() => '?').join(',');
  return db
    .prepare(`SELECT id FROM questions WHERE type IN (${marks}) ORDER BY id`)
    .all(...types)
    .map((r) => r.id);
}

/** 可用真题套（按 paper 分组）。 */
export function listPapers(db) {
  return db
    .prepare(
      `SELECT paper, paper_title, COUNT(*) AS n, MIN(seq_no) AS first_no
       FROM questions WHERE paper IS NOT NULL GROUP BY paper, paper_title ORDER BY paper DESC`,
    )
    .all();
}

/** 题库统计：按题型、按模块。 */
export function bankStats(db) {
  const byType = db.prepare('SELECT type, COUNT(*) AS n FROM questions GROUP BY type').all();
  const byTopic = db
    .prepare('SELECT topic, type, COUNT(*) AS n FROM questions GROUP BY topic, type')
    .all();
  const total = db.prepare('SELECT COUNT(*) AS n FROM questions').get().n;
  return { total, byType, byTopic };
}

/** 取某类型、某模块全部题目（组卷池）。 */
export function pool(db, type, topic) {
  const rows = topic
    ? db.prepare('SELECT * FROM questions WHERE type = ? AND topic = ?').all(type, topic)
    : db.prepare('SELECT * FROM questions WHERE type = ?').all(type);
  return rows.map(hydrate);
}

/** 取某类型、指定 knowledge 的题目（下午卷分类用）。 */
export function poolByKnowledge(db, type, knowledge) {
  return db
    .prepare('SELECT * FROM questions WHERE type = ? AND knowledge = ?')
    .all(type, knowledge)
    .map(hydrate);
}

export function getQuestion(db, id) {
  const row = db.prepare('SELECT * FROM questions WHERE id = ?').get(id);
  return row ? hydrate(row) : null;
}

function hydrate(row) {
  return {
    ...row,
    options: row.options ? JSON.parse(row.options) : null,
    answer: JSON.parse(row.answer),
    rubric: row.rubric ? JSON.parse(row.rubric) : null,
  };
}

/** 创建试卷：写入 exams 与 exam_questions。 */
export function createExam(db, { mode, title, durationSec, startedAt, items }) {
  const deadline = startedAt + durationSec * 1000;
  db.exec('BEGIN');
  try {
    const info = db
      .prepare(
        `INSERT INTO exams (mode, title, duration_sec, started_at, deadline_at, status, max_score)
         VALUES (?, ?, ?, ?, ?, 'in_progress', ?)`,
      )
      .run(mode, title, durationSec, startedAt, deadline, items.reduce((s, it) => s + it.score, 0));
    const examId = Number(info.lastInsertRowid);
    const stmt = db.prepare(
      'INSERT INTO exam_questions (exam_id, seq, qid, section, score) VALUES (?, ?, ?, ?, ?)',
    );
    items.forEach((it, i) => stmt.run(examId, i + 1, it.qid, it.section, it.score));
    db.exec('COMMIT');
    return examId;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function getExam(db, id) {
  return db.prepare('SELECT * FROM exams WHERE id = ?').get(id) ?? null;
}

export function getActiveExam(db) {
  return db
    .prepare("SELECT * FROM exams WHERE status = 'in_progress' ORDER BY id DESC LIMIT 1")
    .get() ?? null;
}

/** 试卷题目 + 题目内容。 */
export function getExamItems(db, examId) {
  const rows = db
    .prepare(
      `SELECT eq.seq, eq.section, eq.score, eq.user_answer, eq.is_correct, eq.awarded, eq.graded,
              q.*
       FROM exam_questions eq JOIN questions q ON q.id = eq.qid
       WHERE eq.exam_id = ? ORDER BY eq.seq`,
    )
    .all(examId);
  return rows.map((r) => ({
    ...hydrate({
      ...r,
      options: r.options,
      answer: r.answer,
      rubric: r.rubric,
    }),
    seq: r.seq,
    section: r.section,
    score: r.score,
    userAnswer: r.user_answer ? JSON.parse(r.user_answer) : null,
    isCorrect: r.is_correct,
    awarded: r.awarded,
    graded: r.graded,
  }));
}

export function saveAnswer(db, examId, seq, answer) {
  db.prepare('UPDATE exam_questions SET user_answer = ? WHERE exam_id = ? AND seq = ?').run(
    answer == null ? null : JSON.stringify(answer),
    examId,
    seq,
  );
}

/** 交卷：写入客观分与状态。 */
export function finishExam(db, examId, { objectiveScore, subjectiveScore, totalScore, auto }) {
  db.prepare(
    `UPDATE exams
     SET status = 'submitted', submitted_at = ?, auto_submitted = ?,
         objective_score = ?, subjective_score = ?, total_score = ?
     WHERE id = ?`,
  ).run(Date.now(), auto ? 1 : 0, objectiveScore, subjectiveScore, totalScore, examId);
}

export function abortExam(db, examId) {
  db.prepare("UPDATE exams SET status = 'aborted', submitted_at = ? WHERE id = ?").run(
    Date.now(),
    examId,
  );
}

export function updateItemGrade(db, examId, seq, { isCorrect, awarded, graded }) {
  db.prepare(
    'UPDATE exam_questions SET is_correct = ?, awarded = ?, graded = ? WHERE exam_id = ? AND seq = ?',
  ).run(isCorrect ?? null, awarded ?? null, graded ? 1 : 0, examId, seq);
}

export function updateExamScores(db, examId, { objectiveScore, subjectiveScore, totalScore }) {
  db.prepare(
    'UPDATE exams SET objective_score = ?, subjective_score = ?, total_score = ? WHERE id = ?',
  ).run(objectiveScore, subjectiveScore, totalScore, examId);
}

export function listExams(db, limit = 100) {
  return db
    .prepare(
      `SELECT id, mode, title, started_at, submitted_at, status, auto_submitted,
              objective_score, subjective_score, total_score, max_score, duration_sec
       FROM exams ORDER BY id DESC LIMIT ?`,
    )
    .all(limit);
}

export function deleteExam(db, id) {
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM exam_questions WHERE exam_id = ?').run(id);
    db.prepare('DELETE FROM exams WHERE id = ?').run(id);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/** 统计已答/未答（客观题：有非空作答即算已答）。 */
export function answerProgress(items) {
  const answered = items.filter((it) => it.type === 'subjective'
    ? typeof it.userAnswer === 'string' && it.userAnswer.trim() !== ''
    : Array.isArray(it.userAnswer) && it.userAnswer.length > 0).length;
  return { answered, total: items.length };
}
