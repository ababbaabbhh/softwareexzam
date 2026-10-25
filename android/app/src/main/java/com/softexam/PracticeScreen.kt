package com.softexam

import android.graphics.Color
import android.text.Editable
import android.text.TextWatcher
import android.view.Gravity
import android.view.View
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import com.softexam.core.Practice
import com.softexam.core.Question
import com.softexam.core.QuestionType
import com.softexam.data.Repo
import com.softexam.ui.U

/** 练习模式：随机出题、下一题揭示答案、整库循环。 */
class PracticeScreen(
    private val act: MainActivity,
    private val repo: Repo,
    private val mode: String,
) : MainActivity.Screen {

    private var question: Question? = null
    private var done = 0
    private var total = 0
    private var revealed = false
    private var choice = LinkedHashSet<String>()
    private var fillValues: MutableList<String> = mutableListOf()
    private var text = ""

    private lateinit var progressText: TextView
    private lateinit var cardHost: LinearLayout
    private lateinit var answerHost: LinearLayout
    private lateinit var nextBtn: TextView

    override val root: View = build()

    private fun build(): View {
        val ctx = act
        val root = LinearLayout(ctx).apply { orientation = LinearLayout.VERTICAL; setBackgroundColor(U.BG) }
        val bar = LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setBackgroundColor(U.DARK)
            setPadding(U.dp(ctx, 12f), U.dp(ctx, 10f), U.dp(ctx, 12f), U.dp(ctx, 10f))
        }
        bar.addView(U.text(ctx, Practice.name(mode), 16f, Color.WHITE, true), LinearLayout.LayoutParams(0, -2, 1f))
        progressText = U.text(ctx, "", 12f, 0xFFC9D8EA.toInt())
        bar.addView(progressText)
        bar.addView(U.button(ctx, "退出", 0x00000000, Color.WHITE) { act.showHome() })
        root.addView(bar)

        cardHost = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(U.dp(ctx, 14f), U.dp(ctx, 12f), U.dp(ctx, 14f), U.dp(ctx, 12f))
        }
        answerHost = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(U.dp(ctx, 14f), 0, U.dp(ctx, 14f), U.dp(ctx, 12f))
        }
        val scrollContent = LinearLayout(ctx).apply { orientation = LinearLayout.VERTICAL }
        scrollContent.addView(cardHost)
        scrollContent.addView(answerHost)
        root.addView(ScrollView(ctx).apply { addView(scrollContent) }, LinearLayout.LayoutParams(-1, 0, 1f))

        nextBtn = U.button(ctx, "下一题", U.PRIMARY) { onNext() }
        root.addView(nextBtn, LinearLayout.LayoutParams(-1, -2).apply {
            setMargins(U.dp(ctx, 14f), U.dp(ctx, 6f), U.dp(ctx, 14f), U.dp(ctx, 12f))
        })
        load()
        return root
    }

    private fun load() {
        val ctx = act
        try {
            val next = repo.practiceNext(mode)
            question = next.question
            done = next.done
            total = next.total
            revealed = false
            choice = LinkedHashSet()
            fillValues = mutableListOf()
            text = ""
            progressText.text = "本轮 第 $done 题 / 共 $total 题"
            nextBtn.text = "下一题"
            nextBtn.background = U.round(U.PRIMARY, 9f)
            answerHost.removeAllViews()
            renderCard()
        } catch (e: Exception) {
            cardHost.removeAllViews()
            cardHost.addView(U.text(ctx, e.message ?: "加载失败", 14f, U.TEXT2))
        }
    }

    private fun renderCard() {
        val ctx = act
        val q = question ?: return
        cardHost.removeAllViews()
        val card = U.card(ctx)
        val head = LinearLayout(ctx).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        head.addView(U.tag(ctx, QuestionType.name(q.type)))
        head.addView(View(ctx).apply { layoutParams = LinearLayout.LayoutParams(0, 1, 1f) })
        head.addView(U.text(ctx, "${q.score} 分", 11.5f, U.TEXT3))
        card.addView(head)
        card.addView(U.text(ctx, q.stem, 15.5f, U.TEXT).apply { setPadding(0, U.dp(ctx, 10f), 0, 0) })

        when (q.type) {
            "single", "tf" -> renderChoice(card, q, false)
            "multi" -> renderChoice(card, q, true)
            "fill" -> renderFill(card, q)
            "subjective" -> renderSubjective(card, q)
        }
        cardHost.addView(card)
    }

    private fun renderChoice(card: LinearLayout, q: Question, multi: Boolean) {
        val ctx = act
        val options = if (q.type == "tf") listOf("对", "错") else q.options ?: emptyList()
        val letters = "ABCDE"
        options.forEachIndexed { i, textValue ->
            val key = if (q.type == "tf") textValue else letters[i].toString()
            val row = LinearLayout(ctx).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                setPadding(U.dp(ctx, 12f), U.dp(ctx, 10f), U.dp(ctx, 12f), U.dp(ctx, 10f))
                background = U.round(if (key in choice) U.LIGHT else Color.WHITE, 9f, if (key in choice) U.PRIMARY else U.LINE, 1.2f)
                isClickable = true
            }
            if (q.type != "tf") row.addView(U.text(ctx, key, 14f, U.PRIMARY, true).apply { setPadding(0, 0, U.dp(ctx, 8f), 0) })
            row.addView(U.text(ctx, textValue, 14.5f, U.TEXT), LinearLayout.LayoutParams(0, -2, 1f))
            row.setOnClickListener {
                if (revealed) return@setOnClickListener
                if (multi) {
                    if (!choice.add(key)) choice.remove(key)
                } else {
                    choice.clear(); choice.add(key)
                }
                renderCard()
            }
            card.addView(row, LinearLayout.LayoutParams(-1, -2).apply { topMargin = U.dp(ctx, 8f) })
        }
    }

    private fun renderFill(card: LinearLayout, q: Question) {
        val ctx = act
        val inputs = ArrayList<EditText>()
        for (i in 0 until q.blankCount.coerceAtLeast(1)) {
            val line = LinearLayout(ctx).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
            line.addView(U.text(ctx, "第 ${i + 1} 空", 13f, U.TEXT2).apply { setPadding(0, 0, U.dp(ctx, 8f), 0) })
            val input = EditText(ctx).apply {
                hint = "请输入答案"
                setText(fillValues.getOrNull(i) ?: "")
                setTextSize(android.util.TypedValue.COMPLEX_UNIT_SP, 14.5f)
                isEnabled = !revealed
                background = U.round(Color.WHITE, 8f, U.LINE, 1.2f)
            }
            input.addTextChangedListener(object : TextWatcher {
                override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
                override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {}
                override fun afterTextChanged(s: Editable?) {
                    fillValues = inputs.map { it.text.toString() }.toMutableList()
                }
            })
            inputs.add(input)
            line.addView(input, LinearLayout.LayoutParams(0, -2, 1f))
            card.addView(line, LinearLayout.LayoutParams(-1, -2).apply { topMargin = U.dp(ctx, 8f) })
        }
    }

    private fun renderSubjective(card: LinearLayout, q: Question) {
        val ctx = act
        val input = EditText(ctx).apply {
            hint = "请在此作答（可分点书写）"
            setText(text)
            isEnabled = !revealed
            minLines = 8
            gravity = Gravity.TOP
            setTextSize(android.util.TypedValue.COMPLEX_UNIT_SP, 14.5f)
            background = U.round(Color.WHITE, 9f, U.LINE, 1.2f)
        }
        input.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {}
            override fun afterTextChanged(s: Editable?) { text = s?.toString() ?: "" }
        })
        card.addView(input, LinearLayout.LayoutParams(-1, -2).apply { topMargin = U.dp(ctx, 8f) })
        card.addView(U.text(ctx, "主观题不自动评分，点击「下一题」查看参考答案与评分要点", 11.5f, U.TEXT3).apply {
            setPadding(0, U.dp(ctx, 6f), 0, 0)
        })
    }

    private fun onNext() {
        if (!revealed) {
            val q = question ?: return
            val userAnswer: List<String>? = when (q.type) {
                "fill" -> if (fillValues.any { it.isNotBlank() }) fillValues.toList() else null
                "subjective" -> null
                else -> if (choice.isEmpty()) null else choice.sorted()
            }
            try {
                val res = repo.practiceCheck(q.id, userAnswer)
                showAnswer(res, q)
                revealed = true
                nextBtn.text = "继续下一题 →"
                nextBtn.background = U.round(U.SUCCESS, 9f)
            } catch (e: Exception) {
                nextBtn.text = e.message ?: "加载失败"
            }
            return
        }
        load()
    }

    private fun showAnswer(res: Repo.PracticeCheck, q: Question) {
        val ctx = act
        answerHost.removeAllViews()
        val box = U.card(ctx)
        val status = when {
            q.isSubjective -> U.tag(ctx, "对照参考答案自检", U.ORANGE_BG, 0xFFB96A12.toInt())
            res.correct == true -> U.tag(ctx, "回答正确", U.GREEN_BG, U.SUCCESS)
            res.totalBlanks > 0 && res.matchedBlanks > 0 -> U.tag(ctx, "部分正确 ${res.matchedBlanks}/${res.totalBlanks} 空", U.ORANGE_BG, 0xFFB96A12.toInt())
            else -> U.tag(ctx, "回答错误", U.RED_BG, U.DANGER)
        }
        val head = LinearLayout(ctx).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        head.addView(U.text(ctx, "答案解析", 14f, U.DARK, true))
        head.addView(status, LinearLayout.LayoutParams(-2, -2).apply { leftMargin = U.dp(ctx, 8f) })
        box.addView(head)

        val yourAnswer = when (q.type) {
            "tf" -> choice.joinToString("、").ifBlank { "未作答" }
            "fill" -> fillValues.filter { it.isNotBlank() }.joinToString(" ") { "「$it」" }.ifBlank { "未作答" }
            "subjective" -> text.ifBlank { "（未作答）" }
            else -> choice.sorted().joinToString(" ")
        }
        box.addView(U.text(ctx, "你的答案：$yourAnswer", 13f, U.TEXT2).apply { setPadding(0, U.dp(ctx, 8f), 0, 0) })

        if (!q.isSubjective) {
            val answerText = when (q.type) {
                "fill" -> q.answer.joinToString(" / ") { it.split("|").joinToString("|") }
                "tf" -> q.answer.firstOrNull() ?: ""
                else -> q.answer.joinToString("、")
            }
            box.addView(U.text(ctx, "正确答案：$answerText", 13.5f, U.SUCCESS, true).apply { setPadding(0, U.dp(ctx, 6f), 0, 0) })
        } else {
            box.addView(U.text(ctx, "参考答案", 13f, U.DARK, true).apply { setPadding(0, U.dp(ctx, 10f), 0, U.dp(ctx, 4f)) })
            box.addView(U.text(ctx, q.answer.joinToString("\n"), 13f, U.TEXT2).apply {
                background = U.round(0xFFF7F9FC.toInt(), 6f); setPadding(U.dp(ctx, 10f), U.dp(ctx, 8f), U.dp(ctx, 10f), U.dp(ctx, 8f))
            })
            if (!q.rubric.isNullOrEmpty()) {
                box.addView(U.text(ctx, "评分要点", 13f, U.DARK, true).apply { setPadding(0, U.dp(ctx, 10f), 0, U.dp(ctx, 4f)) })
                q.rubric.forEach { r -> box.addView(U.text(ctx, "· $r", 12.5f, U.TEXT2)) }
            }
        }
        if (!q.explanation.isNullOrBlank()) {
            box.addView(U.text(ctx, "解析：${q.explanation}", 12.5f, U.TEXT2).apply {
                setPadding(0, U.dp(ctx, 8f), 0, 0)
            })
        }
        answerHost.addView(box)
    }
}
