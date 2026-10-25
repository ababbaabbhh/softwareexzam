package com.softexam

import android.app.AlertDialog
import android.graphics.Color
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import com.softexam.core.ExamQuestionRow
import com.softexam.core.ExamRow
import com.softexam.core.Grade
import com.softexam.core.MiniJson
import com.softexam.core.Modes
import com.softexam.core.Question
import com.softexam.core.QuestionType
import com.softexam.data.Repo
import com.softexam.ui.U

/** 成绩页：总分、逐题解析、主观题自评、重做。 */
class ResultScreen(
    private val act: MainActivity,
    private val repo: Repo,
    private val examId: Long,
) : MainActivity.Screen {

    private var exam: ExamRow? = null
    private var items: List<ExamQuestionRow> = emptyList()
    private var wrongOnly = false
    private val gradeInputs = LinkedHashMap<Int, EditText>()

    override val root: View = build()

    private fun build(): View {
        exam = repo.exam(examId)
        items = repo.items(examId)
        val ctx = act
        val e = exam
        if (e == null) {
            return U.text(ctx, "考试不存在", 15f, U.TEXT2).apply {
                gravity = Gravity.CENTER; setPadding(0, U.dp(ctx, 60f), 0, 0)
            }
        }

        val root = LinearLayout(ctx).apply { orientation = LinearLayout.VERTICAL; setBackgroundColor(U.BG) }
        root.addView(topBar(ctx, e))

        val content = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(U.dp(ctx, 16f), U.dp(ctx, 12f), U.dp(ctx, 16f), U.dp(ctx, 30f))
        }

        // 成绩卡
        val pass = (e.totalScore ?: 0.0) >= Grade.passLine(e.mode, e.maxScore)
        val hero = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            background = U.round(U.DARK, 14f)
            setPadding(U.dp(ctx, 18f), U.dp(ctx, 18f), U.dp(ctx, 18f), U.dp(ctx, 18f))
        }
        hero.addView(U.text(ctx, "${e.totalScore ?: 0.0}", 44f, Color.WHITE, true))
        hero.addView(U.text(ctx, "总分 / 满分 ${e.maxScore.toInt()}", 12f, 0xFFC9D8EA.toInt()))
        hero.addView(U.text(ctx, e.title, 15f, Color.WHITE, true).apply { setPadding(0, U.dp(ctx, 10f), 0, 0) })
        val metaLine = "${Modes.name(e.mode)} · ${HomeScreen.fmtDate(e.submittedAt ?: e.startedAt)}" +
            (if (e.autoSubmitted) " · 超时自动交卷" else "")
        hero.addView(U.text(ctx, metaLine, 11.5f, 0xFFC9D8EA.toInt()).apply { setPadding(0, U.dp(ctx, 4f), 0, 0) })
        val badge = U.text(
            ctx,
            if (pass) "✓ 达到合格线（${Grade.passLine(e.mode, e.maxScore)} 分）" else "未达到合格线（${Grade.passLine(e.mode, e.maxScore)} 分）",
            13f,
            if (pass) 0xFFD9F2E3.toInt() else 0xFFFFDEDE.toInt(),
            true,
        ).apply {
            setPadding(U.dp(ctx, 12f), U.dp(ctx, 5f), U.dp(ctx, 12f), U.dp(ctx, 5f))
            background = U.round(if (pass) 0xFF147A45.toInt() else 0xFFA52020.toInt(), 20f)
        }
        hero.addView(badge, LinearLayout.LayoutParams(-2, -2).apply { topMargin = U.dp(ctx, 10f) })
        content.addView(hero)

        // 分数盒子
        val boxes = LinearLayout(ctx).apply { orientation = LinearLayout.HORIZONTAL }
        fun box(label: String, value: String) {
            val b = LinearLayout(ctx).apply {
                orientation = LinearLayout.VERTICAL
                gravity = Gravity.CENTER
                background = U.round(U.CARD, 12f, U.LINE, 1f)
                setPadding(U.dp(ctx, 10f), U.dp(ctx, 12f), U.dp(ctx, 10f), U.dp(ctx, 12f))
            }
            b.addView(U.text(ctx, value, 20f, U.PRIMARY, true))
            b.addView(U.text(ctx, label, 11f, U.TEXT3))
            boxes.addView(b, LinearLayout.LayoutParams(0, -2, 1f).apply { leftMargin = U.dp(ctx, 3f); rightMargin = U.dp(ctx, 3f) })
        }
        box("客观题得分", "${e.objectiveScore ?: 0.0}")
        box("主观题得分", "${e.subjectiveScore ?: 0.0}")
        box("答对题数", "${items.count { it.isCorrect == true }}")
        box("总题数", "${items.size}")
        content.addView(boxes, LinearLayout.LayoutParams(-1, -2).apply { topMargin = U.dp(ctx, 12f) })

        // 操作
        val toolbar = LinearLayout(ctx).apply { orientation = LinearLayout.HORIZONTAL }
        toolbar.addView(U.button(ctx, "重做这套试卷", U.PRIMARY) { retake(e.id) }, LinearLayout.LayoutParams(0, -2, 1f))
        toolbar.addView(U.ghostButton(ctx, if (wrongOnly) "显示全部" else "只看错题") {
            wrongOnly = !wrongOnly
            act.showResult(examId)
        }, LinearLayout.LayoutParams(0, -2, 1f).apply { leftMargin = U.dp(ctx, 8f) })
        content.addView(toolbar, LinearLayout.LayoutParams(-1, -2).apply { topMargin = U.dp(ctx, 12f) })

        // 主观题提示
        val subjective = items.filter { it.question.isSubjective }
        if (subjective.isNotEmpty()) {
            val graded = subjective.count { it.graded }
            content.addView(U.text(
                ctx,
                if (graded == subjective.size) "✅ 主观题已全部自评" else "📝 主观题需对照参考答案自评（已评 $graded/${subjective.size}）",
                12.5f, U.TEXT2,
            ).apply { setPadding(0, U.dp(ctx, 12f), 0, 0) })
        }

        // 逐题
        items.forEach { row ->
            if (wrongOnly && row.isCorrect != false && !row.question.isSubjective) return@forEach
            content.addView(reviewCard(ctx, row, e))
        }

        // 主观题保存
        if (subjective.isNotEmpty()) {
            content.addView(U.button(ctx, "保存主观题评分", U.SUCCESS) { saveGrades() }, LinearLayout.LayoutParams(-1, -2).apply {
                topMargin = U.dp(ctx, 6f)
            })
        }

        root.addView(ScrollView(ctx).apply { addView(content) }, LinearLayout.LayoutParams(-1, 0, 1f))
        return root
    }

    private fun topBar(ctx: android.content.Context, e: ExamRow): View = LinearLayout(ctx).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        setBackgroundColor(U.DARK)
        setPadding(U.dp(ctx, 12f), U.dp(ctx, 10f), U.dp(ctx, 12f), U.dp(ctx, 10f))
        addView(U.button(ctx, "← 返回", 0x00000000, Color.WHITE) { act.showHome() })
        addView(U.text(ctx, "成绩详情", 15f, Color.WHITE, true).apply { gravity = Gravity.CENTER }, LinearLayout.LayoutParams(0, -2, 1f))
        addView(U.button(ctx, "历史", 0x00000000, Color.WHITE) { act.showHistory() })
    }

    private fun reviewCard(ctx: android.content.Context, row: ExamQuestionRow, e: ExamRow): View {
        val q = row.question
        val card = U.card(ctx).apply { layoutParams = LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = U.dp(ctx, 10f) } }
        val head = LinearLayout(ctx).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        head.addView(U.text(ctx, "第 ${row.seq} 题", 14.5f, U.DARK, true))
        head.addView(U.tag(ctx, QuestionType.name(q.type)).apply { val lp = LinearLayout.LayoutParams(-2, -2); lp.leftMargin = U.dp(ctx, 6f); layoutParams = lp })
        head.addView(U.text(ctx, "${row.score} 分", 11.5f, U.TEXT3))
        head.addView(View(ctx).apply { layoutParams = LinearLayout.LayoutParams(0, 1, 1f) })
        if (q.isSubjective) {
            head.addView(U.tag(ctx, if (row.graded) "已评 ${row.awarded} 分" else "待自评", if (row.graded) U.GREEN_BG else U.ORANGE_BG, if (row.graded) U.SUCCESS else 0xFFB96A12.toInt()))
        } else {
            head.addView(U.tag(ctx, if (row.isCorrect == true) "答对" else "答错", if (row.isCorrect == true) U.GREEN_BG else U.RED_BG, if (row.isCorrect == true) U.SUCCESS else U.DANGER))
        }
        card.addView(head)
        card.addView(U.text(ctx, q.stem, 14.5f, U.TEXT).apply { setPadding(0, U.dp(ctx, 8f), 0, 0) })

        if (q.type == "single" || q.type == "multi") {
            val correct = q.answer.map { it.uppercase() }.toSet()
            val user = MiniJson.decodeStrings(row.rawAnswer).map { it.uppercase() }.toSet()
            q.options?.forEachIndexed { i, text ->
                val key = "ABCDE"[i].toString()
                val isCorrect = key in correct
                val isUser = key in user
                val bg = when {
                    isCorrect -> 0xFFEEFAF3.toInt()
                    isUser -> 0xFFFDF1F1.toInt()
                    else -> Color.WHITE
                }
                val stroke = when {
                    isCorrect -> U.SUCCESS
                    isUser -> U.DANGER
                    else -> U.LINE
                }
                val line = LinearLayout(ctx).apply {
                    orientation = LinearLayout.HORIZONTAL
                    setPadding(U.dp(ctx, 10f), U.dp(ctx, 8f), U.dp(ctx, 10f), U.dp(ctx, 8f))
                    background = U.round(bg, 8f, stroke, 1.1f)
                }
                line.addView(U.text(ctx, "$key.", 13f, if (isCorrect) U.SUCCESS else if (isUser) U.DANGER else U.PRIMARY, true).apply { setPadding(0, 0, U.dp(ctx, 6f), 0) })
                line.addView(U.text(ctx, text, 13.5f, U.TEXT), LinearLayout.LayoutParams(0, -2, 1f))
                card.addView(line, LinearLayout.LayoutParams(-1, -2).apply { topMargin = U.dp(ctx, 6f) })
            }
        } else if (q.type == "tf") {
            val correct = (q.answer.firstOrNull() ?: "").trim()
            val user = MiniJson.decodeStrings(row.rawAnswer).firstOrNull() ?: "未作答"
            card.addView(U.text(ctx, "正确答案：$correct    你的答案：$user", 13.5f, if (row.isCorrect == true) U.SUCCESS else U.DANGER))
        } else if (q.type == "fill") {
            val answers = q.answer
            val user = MiniJson.decodeStrings(row.rawAnswer)
            answers.forEachIndexed { i, ans ->
                val mine = user.getOrNull(i) ?: "未作答"
                val ok = Grade.normalize(mine) in ans.split("|").map { Grade.normalize(it) }
                card.addView(U.text(ctx, "第 ${i + 1} 空：$mine（参考答案：${ans.split("|").joinToString(" / ")}）", 12.5f, if (ok) U.SUCCESS else U.DANGER))
            }
        }

        if (!q.explanation.isNullOrBlank()) {
            val exp = LinearLayout(ctx).apply {
                orientation = LinearLayout.VERTICAL
                background = U.round(0xFFF7F9FC.toInt(), 6f)
                setPadding(U.dp(ctx, 10f), U.dp(ctx, 8f), U.dp(ctx, 10f), U.dp(ctx, 8f))
            }
            exp.addView(U.text(ctx, "解析", 12.5f, U.DARK, true))
            exp.addView(U.text(ctx, q.explanation ?: "", 12.5f, U.TEXT2))
            card.addView(exp, LinearLayout.LayoutParams(-1, -2).apply { topMargin = U.dp(ctx, 8f) })
        }

        if (q.isSubjective) {
            val mine = MiniJson.decodeString(row.rawAnswer)
            card.addView(U.text(ctx, "你的作答", 13f, U.DARK, true).apply { setPadding(0, U.dp(ctx, 10f), 0, U.dp(ctx, 4f)) })
            card.addView(U.text(ctx, mine.ifBlank { "（未作答）" }, 13f, U.TEXT2).apply {
                background = U.round(0xFFF7F9FC.toInt(), 6f); setPadding(U.dp(ctx, 10f), U.dp(ctx, 8f), U.dp(ctx, 10f), U.dp(ctx, 8f))
            })
            card.addView(U.text(ctx, "参考答案", 13f, U.DARK, true).apply { setPadding(0, U.dp(ctx, 10f), 0, U.dp(ctx, 4f)) })
            card.addView(U.text(ctx, q.answer.joinToString("\n"), 13f, U.TEXT2).apply {
                background = U.round(0xFFF7F9FC.toInt(), 6f); setPadding(U.dp(ctx, 10f), U.dp(ctx, 8f), U.dp(ctx, 10f), U.dp(ctx, 8f))
            })
            if (!q.rubric.isNullOrEmpty()) {
                card.addView(U.text(ctx, "评分要点", 13f, U.DARK, true).apply { setPadding(0, U.dp(ctx, 10f), 0, U.dp(ctx, 4f)) })
                q.rubric.forEach { r -> card.addView(U.text(ctx, "· $r", 12.5f, U.TEXT2)) }
            }
            val rowLayout = LinearLayout(ctx).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                background = U.round(0xFFFFFAF0.toInt(), 8f, 0xFFF3DFB8.toInt(), 1f)
                setPadding(U.dp(ctx, 10f), U.dp(ctx, 8f), U.dp(ctx, 10f), U.dp(ctx, 8f))
            }
            rowLayout.addView(U.text(ctx, "自评得分（0-${row.score.toInt()}）：", 13f, U.TEXT2))
            val input = EditText(ctx).apply {
                inputType = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_FLAG_DECIMAL
                setText(row.awarded?.let { if (it == it.toLong().toDouble()) it.toInt().toString() else it.toString() } ?: "")
                setTextSize(android.util.TypedValue.COMPLEX_UNIT_SP, 14f)
                setPadding(U.dp(ctx, 8f), U.dp(ctx, 4f), U.dp(ctx, 8f), U.dp(ctx, 4f))
                background = U.round(Color.WHITE, 6f, 0xFFE4CFA4.toInt(), 1f)
            }
            gradeInputs[row.seq] = input
            rowLayout.addView(input, LinearLayout.LayoutParams(U.dp(ctx, 70f), -2))
            card.addView(rowLayout, LinearLayout.LayoutParams(-1, -2).apply { topMargin = U.dp(ctx, 10f) })
        }
        return card
    }

    private fun saveGrades() {
        val scores = LinkedHashMap<Int, Double>()
        for ((seq, input) in gradeInputs) {
            val v = input.text.toString().toDoubleOrNull() ?: continue
            scores[seq] = v
        }
        if (scores.isEmpty()) {
            Toast.makeText(act, "请至少填写一道主观题分数", Toast.LENGTH_SHORT).show()
            return
        }
        try {
            repo.gradeSubjective(examId, scores)
            Toast.makeText(act, "已保存评分", Toast.LENGTH_SHORT).show()
            act.showResult(examId)
        } catch (e: Exception) {
            Toast.makeText(act, e.message ?: "保存失败", Toast.LENGTH_SHORT).show()
        }
    }

    private fun retake(examId: Long) {
        try {
            val newId = repo.retake(examId)
            act.showExam(newId)
        } catch (e: Repo.ActiveExamException) {
            AlertDialog.Builder(act)
                .setTitle("已有进行中的考试")
                .setMessage("同一时间只允许一场考试。继续上次考试，或放弃后重做本套试卷。")
                .setPositiveButton("继续上次") { _, _ -> act.showExam(e.examId) }
                .setNegativeButton("放弃并重做") { _, _ ->
                    repo.abort(e.examId)
                    retake(examId)
                }
                .setNeutralButton("取消", null)
                .show()
        } catch (e: Exception) {
            Toast.makeText(act, e.message ?: "重做失败", Toast.LENGTH_SHORT).show()
        }
    }
}
