package com.softexam.core

/** 评分规则，与 Web 版保持一致。 */
object Grade {
    data class Result(
        val correct: Boolean?,
        val awarded: Double?,
        val matchedBlanks: Int = 0,
        val totalBlanks: Int = 0,
    )

    fun normalize(value: String?): String {
        if (value == null) return ""
        val sb = StringBuilder()
        for (ch in value) {
            var c = ch
            if (c in '\uFF01'..'\uFF5E') c = (c.code - 0xFEE0).toChar()
            if (c == '\u3000') c = ' '
            if (!c.isWhitespace()) sb.append(c.lowercaseChar())
        }
        return sb.toString()
    }

    fun answerText(answer: List<String>): String = answer.joinToString(" ")

    fun isAnswered(type: String, answer: List<String>?): Boolean {
        if (type == "subjective") return false
        return !answer.isNullOrEmpty() && answer.any { it.trim().isNotEmpty() }
    }

    private fun judge(value: String?): String {
        val v = normalize(value)
        return when (v) {
            "对", "正确", "t", "true", "√", "y", "yes", "是" -> "对"
            "错", "错误", "f", "false", "×", "x", "n", "no", "否" -> "错"
            else -> v
        }
    }

    fun grade(question: Question, userAnswer: List<String>?): Result {
        if (question.isSubjective) return Result(null, null)
        if (userAnswer.isNullOrEmpty() || userAnswer.all { it.isBlank() }) {
            return Result(false, 0.0)
        }
        return when (question.type) {
            "single" -> {
                val ok = normalize(userAnswer[0]) == normalize(question.answer[0])
                Result(ok, if (ok) question.score else 0.0)
            }
            "multi" -> {
                val a = userAnswer.map { it.uppercase() }.sorted()
                val b = question.answer.map { it.uppercase() }.sorted()
                val ok = a == b
                Result(ok, if (ok) question.score else 0.0)
            }
            "tf" -> {
                val ok = judge(userAnswer[0]) == judge(question.answer[0])
                Result(ok, if (ok) question.score else 0.0)
            }
            "fill" -> {
                val blanks = question.answer.size
                var matched = 0
                for (i in 0 until blanks) {
                    val candidates = (question.answer.getOrNull(i) ?: "")
                        .split("|")
                        .map { normalize(it) }
                        .filter { it.isNotEmpty() }
                    val got = normalize(userAnswer.getOrNull(i) ?: "")
                    if (got.isNotEmpty() && got in candidates) matched += 1
                }
                val awarded = if (blanks == 0) 0.0 else question.score * matched / blanks
                Result(matched == blanks, round2(awarded), matched, blanks)
            }
            else -> Result(null, null)
        }
    }

    fun awarded(question: Question, result: Result): Double =
        result.awarded ?: if (result.correct == true) question.score else 0.0

    fun passLine(mode: String, maxScore: Double): Double =
        if (mode == Modes.MORNING || mode == Modes.AFTERNOON) 45.0 else round2(maxScore * 0.6)

    fun round2(v: Double): Double = Math.round(v * 100.0) / 100.0
}
