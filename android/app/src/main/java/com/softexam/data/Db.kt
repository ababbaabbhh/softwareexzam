package com.softexam.data

import android.content.Context
import android.database.Cursor
import android.database.sqlite.SQLiteDatabase
import com.softexam.core.BuiltPaper
import com.softexam.core.ExamQuestionRow
import com.softexam.core.ExamRow
import com.softexam.core.Grade
import com.softexam.core.MiniJson
import com.softexam.core.Question
import java.io.File

/** 本地 SQLite：首次启动时把内置题库复制到内部存储。 */
class Db(private val context: Context) {

    private var db: SQLiteDatabase? = null

    fun open(): SQLiteDatabase {
        db?.let { return it }
        val file = File(context.filesDir, "questions.db")
        if (!file.exists()) {
            context.assets.open("questions.db").use { input ->
                file.outputStream().use { output -> input.copyTo(output) }
            }
        }
        val d = SQLiteDatabase.openDatabase(file.absolutePath, null, SQLiteDatabase.OPEN_READWRITE)
        db = d
        return d
    }

    private fun q(cursor: Cursor): Question {
        fun str(name: String): String? = cursor.getColumnIndex(name).let { if (it < 0) null else cursor.getString(it) }
        return Question(
            id = cursor.getLong(cursor.getColumnIndexOrThrow("id")),
            type = str("type") ?: "single",
            topic = str("topic") ?: "",
            knowledge = str("knowledge"),
            stem = str("stem") ?: "",
            options = str("options")?.let { MiniJson.decodeStrings(it) },
            answer = MiniJson.decodeStrings(str("answer")),
            rubric = str("rubric")?.let { MiniJson.decodeStrings(it) },
            explanation = str("explanation"),
            score = cursor.getDouble(cursor.getColumnIndexOrThrow("score")),
            difficulty = str("difficulty")?.toIntOrNull() ?: 2,
            paper = str("paper"),
            paperTitle = str("paper_title"),
            seqNo = str("seq_no")?.toIntOrNull(),
        )
    }

    fun question(id: Long): Question? = open().rawQuery("SELECT * FROM questions WHERE id = ?", arrayOf(id.toString())).use {
        if (it.moveToFirst()) q(it) else null
    }

    fun pool(type: String, topic: String?): List<Question> {
        val sql = if (topic == null) "SELECT * FROM questions WHERE type = ?"
        else "SELECT * FROM questions WHERE type = ? AND topic = ?"
        val args = if (topic == null) arrayOf(type) else arrayOf(type, topic)
        val out = ArrayList<Question>()
        open().rawQuery(sql, args).use { c -> while (c.moveToNext()) out.add(q(c)) }
        return out
    }

    fun byKnowledge(type: String, knowledge: String): List<Question> {
        val out = ArrayList<Question>()
        open().rawQuery("SELECT * FROM questions WHERE type = ? AND knowledge = ?", arrayOf(type, knowledge)).use { c ->
            while (c.moveToNext()) out.add(q(c))
        }
        return out
    }

    fun byPaper(paper: String): List<Question> {
        val out = ArrayList<Question>()
        open().rawQuery("SELECT * FROM questions WHERE paper = ? ORDER BY seq_no", arrayOf(paper)).use { c ->
            while (c.moveToNext()) out.add(q(c))
        }
        return out
    }

    fun idsByTypes(types: List<String>): List<Long> {
        val marks = types.joinToString(",") { "?" }
        val out = ArrayList<Long>()
        open().rawQuery("SELECT id FROM questions WHERE type IN ($marks) ORDER BY id", types.toTypedArray()).use { c ->
            while (c.moveToNext()) out.add(c.getLong(0))
        }
        return out
    }

    fun countsByType(): Map<String, Int> {
        val out = LinkedHashMap<String, Int>()
        open().rawQuery("SELECT type, COUNT(*) FROM questions GROUP BY type", null).use { c ->
            while (c.moveToNext()) out[c.getString(0)] = c.getInt(1)
        }
        return out
    }

    fun paperList(): List<Pair<String, Pair<String, Int>>> {
        val out = ArrayList<Pair<String, Pair<String, Int>>>()
        open().rawQuery(
            "SELECT paper, paper_title, COUNT(*) FROM questions WHERE paper IS NOT NULL GROUP BY paper, paper_title ORDER BY paper DESC",
            null,
        ).use { c -> while (c.moveToNext()) out.add(c.getString(0) to (c.getString(1) to c.getInt(2))) }
        return out
    }

    private fun examRow(c: Cursor): ExamRow = ExamRow(
        id = c.getLong(c.getColumnIndexOrThrow("id")),
        mode = c.getString(c.getColumnIndexOrThrow("mode")),
        title = c.getString(c.getColumnIndexOrThrow("title")),
        durationSec = c.getInt(c.getColumnIndexOrThrow("duration_sec")),
        startedAt = c.getLong(c.getColumnIndexOrThrow("started_at")),
        deadlineAt = c.getLong(c.getColumnIndexOrThrow("deadline_at")),
        submittedAt = c.getColumnIndex("submitted_at").let { if (c.isNull(it)) null else c.getLong(it) },
        status = c.getString(c.getColumnIndexOrThrow("status")),
        autoSubmitted = c.getInt(c.getColumnIndexOrThrow("auto_submitted")) == 1,
        objectiveScore = c.getColumnIndex("objective_score").let { if (c.isNull(it)) null else c.getDouble(it) },
        subjectiveScore = c.getColumnIndex("subjective_score").let { if (c.isNull(it)) null else c.getDouble(it) },
        totalScore = c.getColumnIndex("total_score").let { if (c.isNull(it)) null else c.getDouble(it) },
        maxScore = c.getDouble(c.getColumnIndexOrThrow("max_score")),
    )

    fun exam(id: Long): ExamRow? = open().rawQuery("SELECT * FROM exams WHERE id = ?", arrayOf(id.toString())).use {
        if (it.moveToFirst()) examRow(it) else null
    }

    fun activeExam(): ExamRow? = open().rawQuery(
        "SELECT * FROM exams WHERE status = 'in_progress' ORDER BY id DESC LIMIT 1", null,
    ).use { if (it.moveToFirst()) examRow(it) else null }

    fun listExams(limit: Int): List<ExamRow> {
        val out = ArrayList<ExamRow>()
        open().rawQuery("SELECT * FROM exams ORDER BY id DESC LIMIT ?", arrayOf(limit.toString())).use { c ->
            while (c.moveToNext()) out.add(examRow(c))
        }
        return out
    }

    fun examItems(examId: Long): List<ExamQuestionRow> {
        val out = ArrayList<ExamQuestionRow>()
        open().rawQuery(
            "SELECT eq.seq, eq.section, eq.score, eq.user_answer, eq.is_correct, eq.awarded, eq.graded, q.* " +
                "FROM exam_questions eq JOIN questions q ON q.id = eq.qid WHERE eq.exam_id = ? ORDER BY eq.seq",
            arrayOf(examId.toString()),
        ).use { c ->
            while (c.moveToNext()) {
                val correctIdx = c.getColumnIndexOrThrow("is_correct")
                val awardIdx = c.getColumnIndexOrThrow("awarded")
                out.add(
                    ExamQuestionRow(
                        seq = c.getInt(c.getColumnIndexOrThrow("seq")),
                        section = c.getString(c.getColumnIndexOrThrow("section")),
                        score = c.getDouble(c.getColumnIndexOrThrow("score")),
                        rawAnswer = c.getColumnIndex("user_answer").let { if (c.isNull(it)) null else c.getString(it) },
                        isCorrect = if (c.isNull(correctIdx)) null else c.getInt(correctIdx) == 1,
                        awarded = if (c.isNull(awardIdx)) null else c.getDouble(awardIdx),
                        graded = c.getInt(c.getColumnIndexOrThrow("graded")) == 1,
                        question = q(c),
                    ),
                )
            }
        }
        return out
    }

    fun createExam(paper: BuiltPaper, now: Long): Long {
        val db = open()
        val deadline = now + paper.durationSec * 1000L
        val maxScore = paper.items.sumOf { it.score }
        db.execSQL(
            "INSERT INTO exams (mode,title,duration_sec,started_at,deadline_at,status,max_score) VALUES (?,?,?,?,?,'in_progress',?)",
            arrayOf(paper.mode, paper.title, paper.durationSec, now, deadline, maxScore),
        )
        val examId = db.rawQuery("SELECT last_insert_rowid()", null).use { if (it.moveToFirst()) it.getLong(0) else 0L }
        paper.items.forEachIndexed { index, item ->
            db.execSQL(
                "INSERT INTO exam_questions (exam_id,seq,qid,section,score) VALUES (?,?,?,?,?)",
                arrayOf(examId, index + 1, item.qid, item.section, item.score),
            )
        }
        return examId
    }

    fun saveAnswer(examId: Long, seq: Int, raw: String?) {
        open().execSQL("UPDATE exam_questions SET user_answer = ? WHERE exam_id = ? AND seq = ?", arrayOf(raw, examId, seq))
    }

    fun updateItem(examId: Long, seq: Int, correct: Boolean?, awarded: Double?, graded: Boolean) {
        open().execSQL(
            "UPDATE exam_questions SET is_correct = ?, awarded = ?, graded = ? WHERE exam_id = ? AND seq = ?",
            arrayOf(if (correct == null) null else if (correct) 1 else 0, awarded, if (graded) 1 else 0, examId, seq),
        )
    }

    fun finishExam(examId: Long, objective: Double, subjective: Double, total: Double, auto: Boolean) {
        open().execSQL(
            "UPDATE exams SET status='submitted', submitted_at=?, auto_submitted=?, objective_score=?, subjective_score=?, total_score=? WHERE id=?",
            arrayOf(System.currentTimeMillis(), if (auto) 1 else 0, Grade.round2(objective), Grade.round2(subjective), Grade.round2(total), examId),
        )
    }

    fun updateScores(examId: Long, objective: Double, subjective: Double, total: Double) {
        open().execSQL(
            "UPDATE exams SET objective_score=?, subjective_score=?, total_score=? WHERE id=?",
            arrayOf(Grade.round2(objective), Grade.round2(subjective), Grade.round2(total), examId),
        )
    }

    fun abortExam(examId: Long) {
        open().execSQL("UPDATE exams SET status='aborted', submitted_at=? WHERE id=?", arrayOf(System.currentTimeMillis(), examId))
    }

    fun deleteExam(examId: Long) {
        open().execSQL("DELETE FROM exam_questions WHERE exam_id = ?", arrayOf(examId))
        open().execSQL("DELETE FROM exams WHERE id = ?", arrayOf(examId))
    }

    fun setting(key: String): String? = open().rawQuery("SELECT v FROM settings WHERE k = ?", arrayOf(key)).use {
        if (it.moveToFirst()) it.getString(0) else null
    }

    fun setSetting(key: String, value: String) {
        open().execSQL("INSERT OR REPLACE INTO settings (k,v) VALUES (?,?)", arrayOf(key, value))
    }
}
