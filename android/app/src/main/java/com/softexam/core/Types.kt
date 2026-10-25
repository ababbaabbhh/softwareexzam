package com.softexam.core

/** 题目与考试领域模型（不依赖 Android，可在 JVM 单测中使用）。 */
data class Question(
    val id: Long,
    val type: String,
    val topic: String,
    val knowledge: String?,
    val stem: String,
    val options: List<String>?,
    val answer: List<String>,
    val rubric: List<String>?,
    val explanation: String?,
    val score: Double,
    val difficulty: Int = 2,
    val paper: String? = null,
    val paperTitle: String? = null,
    val seqNo: Int? = null,
) {
    val isSubjective: Boolean get() = type == "subjective"
    val blankCount: Int get() = if (type == "fill") answer.size else 0
}

data class NewItem(val qid: Long, val topic: String, val section: String, val score: Double)

data class BuiltPaper(val title: String, val mode: String, val durationSec: Int, val items: List<NewItem>)

data class ExamRow(
    val id: Long,
    val mode: String,
    val title: String,
    val durationSec: Int,
    val startedAt: Long,
    val deadlineAt: Long,
    val submittedAt: Long?,
    val status: String,
    val autoSubmitted: Boolean,
    val objectiveScore: Double?,
    val subjectiveScore: Double?,
    val totalScore: Double?,
    val maxScore: Double,
) {
    val inProgress: Boolean get() = status == "in_progress"
}

data class ExamQuestionRow(
    val seq: Int,
    val section: String,
    val score: Double,
    val rawAnswer: String?,
    val isCorrect: Boolean?,
    val awarded: Double?,
    val graded: Boolean,
    val question: Question,
)

/** 模式常量与展示名。 */
object Modes {
    const val MORNING = "morning"
    const val AFTERNOON = "afternoon"
    const val MIXED = "mixed"
    const val REAL = "real"

    fun name(mode: String): String = when (mode) {
        MORNING -> "上午卷 · 基础知识"
        AFTERNOON -> "下午卷 · 应用技术"
        MIXED -> "综合训练卷"
        REAL -> "历年真题"
        else -> mode
    }

    fun short(mode: String): String = when (mode) {
        MORNING -> "上午卷"
        AFTERNOON -> "下午卷"
        MIXED -> "综合训练"
        REAL -> "真题"
        else -> mode
    }
}

/** 题型中文名与标签颜色（ARGB）。 */
object QuestionType {
    fun name(type: String): String = when (type) {
        "single" -> "单选题"
        "multi" -> "多选题"
        "fill" -> "填空题"
        "tf" -> "判断题"
        "subjective" -> "主观题"
        else -> type
    }
}
