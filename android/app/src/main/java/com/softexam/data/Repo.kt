package com.softexam.data

import android.content.Context
import com.softexam.core.BuiltPaper
import com.softexam.core.ExamQuestionRow
import com.softexam.core.ExamRow
import com.softexam.core.Grade
import com.softexam.core.MiniJson
import com.softexam.core.Modes
import com.softexam.core.Paper
import com.softexam.core.Practice
import com.softexam.core.Question
import com.softexam.core.QuestionSource
import kotlin.random.Random

/** 业务仓储：组卷、考试、练习、历史。 */
class Repo(context: Context) : QuestionSource {

    val db = Db(context)

    data class Meta(
        val total: Int,
        val byType: Map<String, Int>,
        val papers: List<Triple<String, String, Int>>,
        val activeExam: ExamRow?,
    )

    data class PracticeNext(val question: Question, val done: Int, val total: Int)
    data class PracticeCheck(
        val question: Question,
        val correct: Boolean?,
        val awarded: Double?,
        val matchedBlanks: Int,
        val totalBlanks: Int,
    )

    override fun pool(type: String, topic: String?): List<Question> = db.pool(type, topic)
    override fun byKnowledge(type: String, knowledge: String): List<Question> = db.byKnowledge(type, knowledge)
    override fun byPaper(paper: String): List<Question> = db.byPaper(paper)

    fun meta(): Meta {
        val counts = db.countsByType()
        val papers = db.paperList().map { Triple(it.first, it.second.first, it.second.second) }
        val active = db.activeExam()?.let { ensureFresh(it) }
        return Meta(counts.values.sum(), counts, papers, active)
    }

    /** 到期自动交卷。 */
    fun ensureFresh(exam: ExamRow): ExamRow {
        if (!exam.inProgress) return exam
        if (System.currentTimeMillis() < exam.deadlineAt) return exam
        submitExam(exam.id, auto = true)
        return db.exam(exam.id) ?: exam
    }

    fun exam(examId: Long): ExamRow? = db.exam(examId)?.let { ensureFresh(it) }

    fun items(examId: Long): List<ExamQuestionRow> = db.examItems(examId)

    /** 开始考试；已有进行中的考试时抛出异常并携带 examId。 */
    class ActiveExamException(val examId: Long) : Exception("已有进行中的考试")

    fun startExam(mode: String, paperId: String? = null): Long {
        val active = db.activeExam()
        if (active != null && ensureFresh(active).inProgress) throw ActiveExamException(active.id)
        val built: BuiltPaper = try {
            Paper.build(this, mode, paperId)
        } catch (e: Exception) {
            throw IllegalStateException(e.message ?: "组卷失败")
        }
        return db.createExam(built, System.currentTimeMillis())
    }

    fun saveAnswer(examId: Long, seq: Int, question: Question, answer: List<String>?, subjectiveText: String?) {
        val raw = if (question.isSubjective) {
            if (subjectiveText.isNullOrBlank()) null else MiniJson.encodeString(subjectiveText)
        } else {
            if (answer == null || answer.isEmpty()) null else MiniJson.encodeStrings(answer)
        }
        db.saveAnswer(examId, seq, raw)
    }

    fun progress(examId: Long): Pair<Int, Int> {
        val items = items(examId)
        val done = items.count { row ->
            if (row.question.isSubjective) row.rawAnswer != null && MiniJson.decodeString(row.rawAnswer).isNotBlank()
            else row.rawAnswer != null && MiniJson.decodeStrings(row.rawAnswer).any { it.isNotBlank() }
        }
        return done to items.size
    }

    fun unansweredSeqs(examId: Long): List<Int> = items(examId).filter { row ->
        if (row.question.isSubjective) row.rawAnswer == null || MiniJson.decodeString(row.rawAnswer).isBlank()
        else row.rawAnswer == null || MiniJson.decodeStrings(row.rawAnswer).none { it.isNotBlank() }
    }.map { it.seq }

    fun submitExam(examId: Long, auto: Boolean): Boolean {
        val exam = db.exam(examId) ?: return false
        if (!exam.inProgress) return false
        val items = items(examId)
        var objective = 0.0
        for (row in items) {
            if (row.question.isSubjective) continue
            val user = MiniJson.decodeStrings(row.rawAnswer)
            val r = Grade.grade(row.question, user)
            val awarded = Grade.awarded(row.question, r)
            db.updateItem(examId, row.seq, r.correct, awarded, false)
            objective += awarded
        }
        db.finishExam(examId, objective, 0.0, objective, auto)
        return true
    }

    fun gradeSubjective(examId: Long, scores: Map<Int, Double>) {
        val exam = db.exam(examId) ?: return
        if (exam.status != "submitted") return
        val items = items(examId)
        for ((seq, score) in scores) {
            val row = items.firstOrNull { it.seq == seq && it.question.isSubjective } ?: continue
            val fixed = score.coerceIn(0.0, row.score)
            db.updateItem(examId, seq, null, fixed, true)
        }
        val fresh = items(examId)
        val subjective = Grade.round2(fresh.filter { it.question.isSubjective }.sumOf { it.awarded ?: 0.0 })
        val objective = Grade.round2(fresh.filter { !it.question.isSubjective }.sumOf { it.awarded ?: 0.0 })
        db.updateScores(examId, objective, subjective, objective + subjective)
    }

    fun retake(examId: Long): Long {
        val exam = db.exam(examId) ?: throw IllegalStateException("试卷不存在")
        val active = db.activeExam()
        if (active != null && ensureFresh(active).inProgress) throw ActiveExamException(active.id)
        val built = Paper.retake(exam.title, exam.mode, exam.durationSec, items(examId))
        return db.createExam(built, System.currentTimeMillis())
    }

    fun abort(examId: Long) = db.abortExam(examId)
    fun delete(examId: Long) = db.deleteExam(examId)
    fun history(limit: Int = 100): List<ExamRow> = db.listExams(limit)

    /* ───────── 练习 ───────── */

    private fun practiceOrderKey(mode: String) = "practice-order:$mode"
    private fun practicePosKey(mode: String) = "practice-pos:$mode"

    fun practiceNext(mode: String, rng: Random = Random.Default): PracticeNext {
        val types = Practice.types(mode)
        var ids = db.setting(practiceOrderKey(mode))?.split(",")?.mapNotNull { it.toLongOrNull() }?.takeIf { it.isNotEmpty() }
        var pos = db.setting(practicePosKey(mode))?.toIntOrNull() ?: 0
        if (ids == null) {
            ids = Practice.shuffledIds(db.idsByTypes(types), rng)
            pos = 0
            db.setSetting(practiceOrderKey(mode), ids.joinToString(","))
        }
        if (pos >= ids.size) {
            ids = Practice.shuffledIds(db.idsByTypes(types), rng)
            pos = 0
            db.setSetting(practiceOrderKey(mode), ids.joinToString(","))
        }
        var idx = pos
        var q: Question? = null
        while (idx < ids.size) {
            q = db.question(ids[idx])
            if (q != null) break
            idx += 1
        }
        if (q == null) {
            ids = Practice.shuffledIds(db.idsByTypes(types), rng)
            db.setSetting(practiceOrderKey(mode), ids.joinToString(","))
            idx = 0
            for (id in ids) {
                val cand = db.question(id)
                if (cand != null) { q = cand; break }
                idx += 1
            }
        }
        val question = q ?: throw IllegalStateException("题库为空")
        db.setSetting(practicePosKey(mode), (idx + 1).toString())
        return PracticeNext(question, idx + 1, ids.size)
    }

    fun practiceCheck(qid: Long, answer: List<String>?): PracticeCheck {
        val q = db.question(qid) ?: throw IllegalStateException("题目不存在")
        val r = Grade.grade(q, answer)
        return PracticeCheck(q, r.correct, r.awarded, r.matchedBlanks, r.totalBlanks)
    }
}
