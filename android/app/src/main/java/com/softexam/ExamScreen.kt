package com.softexam

import android.app.AlertDialog
import android.content.Context
import android.graphics.Color
import android.os.Handler
import android.os.Looper
import android.text.Editable
import android.text.TextWatcher
import android.view.Gravity
import android.view.View
import android.widget.CheckBox
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import com.softexam.core.ExamQuestionRow
import com.softexam.core.ExamRow
import com.softexam.core.MiniJson
import com.softexam.core.Question
import com.softexam.core.QuestionType
import com.softexam.data.Repo
import com.softexam.ui.FlowLayout
import com.softexam.ui.U

/** 考试页：倒计时、答题、答题卡、交卷校验。 */
class ExamScreen(
    private val act: MainActivity,
    private val repo: Repo,
    private val examId: Long,
) : MainActivity.Screen {

    private lateinit var exam: ExamRow
    private lateinit var items: List<ExamQuestionRow>
    private var index = 0
    private val flags = HashSet<Int>()
    private var submitted = false
    private var textWatcher: TextWatcher? = null

    private lateinit var timerText: TextView
    private lateinit var progressText: TextView
    private lateinit var questionHost: LinearLayout
    private val handler = Handler(Looper.getMainLooper())

    private val tick = object : Runnable {
        override fun run() {
            if (submitted) return
            val left = ((exam.deadlineAt - System.currentTimeMillis()) / 1000).coerceAtLeast(0)
            timerText.text = fmt(left.toInt())
            timerText.setTextColor(if (left <= 300) U.DANGER else U.PRIMARY)
            if (left <= 0) {
                Toast.makeText(act, "时间到，已自动交卷", Toast.LENGTH_SHORT).show()
                doSubmit(true)
            } else {
                handler.postDelayed(this, 1000)
            }
        }
    }

    override val root: View = build()

    private fun build(): View {
        exam = repo.exam(examId) ?: throw IllegalStateException("考试不存在")
        items = repo.items(examId)

        val frame = FrameLayout(act)
        val column = LinearLayout(act).apply { orientation = LinearLayout.VERTICAL; setBackgroundColor(U.BG) }

        // 顶栏
        val bar = LinearLayout(act).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setBackgroundColor(Color.WHITE)
            setPadding(U.dp(act, 12f), U.dp(act, 10f), U.dp(act, 12f), U.dp(act, 10f))
        }
        bar.addView(U.text(act, exam.title, 13f, U.DARK, true).apply { maxLines = 1 }, LinearLayout.LayoutParams(0, -2, 1f))
        timerText = U.text(act, "--:--", 19f, U.PRIMARY, true)
        bar.addView(timerText, LinearLayout.LayoutParams(-2, -2))
        progressText = U.text(act, "", 12f, U.TEXT2).apply { setPadding(U.dp(act, 10f), 0, U.dp(act, 10f), 0) }
        bar.addView(progressText)
        bar.addView(U.button(act, "交卷", U.DANGER) { confirmSubmit() })
        column.addView(bar)
        refreshProgress()

        // 题目区
        questionHost = LinearLayout(act).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(U.dp(act, 14f), U.dp(act, 10f), U.dp(act, 14f), U.dp(act, 14f))
        }
        column.addView(ScrollView(act).apply {
            addView(questionHost)
            isFillViewport = true
        }, LinearLayout.LayoutParams(-1, 0, 1f))

        // 底部操作
        val bottom = LinearLayout(act).apply {
            orientation = LinearLayout.HORIZONTAL
            setBackgroundColor(Color.WHITE)
            setPadding(U.dp(act, 12f), U.dp(act, 8f), U.dp(act, 12f), U.dp(act, 8f))
        }
        bottom.addView(U.ghostButton(act, "上一题") { go(index - 1) }, LinearLayout.LayoutParams(0, -2, 1f))
        val flagBtn = U.ghostButton(act, "标记") { toggleFlag() }
        bottom.addView(flagBtn, LinearLayout.LayoutParams(0, -2, 1f).apply { leftMargin = U.dp(act, 8f) })
        bottom.addView(U.button(act, "下一题", U.PRIMARY) { go(index + 1) }, LinearLayout.LayoutParams(0, -2, 1f).apply { leftMargin = U.dp(act, 8f) })
        column.addView(bottom)

        frame.addView(column, FrameLayout.LayoutParams(-1, -1))
        val sheetBtn = U.button(act, "答题卡", U.PRIMARY) { showAnswerSheet() }.apply {
            background = U.round(U.PRIMARY, 40f)
            setPadding(U.dp(act, 14f), U.dp(act, 10f), U.dp(act, 14f), U.dp(act, 10f))
        }
        val lp = FrameLayout.LayoutParams(-2, -2, Gravity.END or Gravity.BOTTOM).apply {
            rightMargin = U.dp(act, 16f); bottomMargin = U.dp(act, 74f)
        }
        frame.addView(sheetBtn, lp)
        return frame
    }

    override fun onShow() {
        if (!submitted) handler.post(tick)
        if (exam.inProgress && System.currentTimeMillis() >= exam.deadlineAt) {
            exam = repo.exam(examId) ?: exam
            if (!exam.inProgress) act.showResult(examId)
        }
    }

    override fun onHide() {
        handler.removeCallbacks(tick)
    }

    private fun refreshProgress() {
        val (done, total) = repo.progress(examId)
        progressText.text = "已答 $done/$total"
    }

    private fun go(next: Int) {
        if (next < 0 || next >= items.size || next == index) return
        index = next
        render()
    }

    private fun toggleFlag() {
        val seq = items[index].seq
        if (!flags.add(seq)) flags.remove(seq)
        render()
    }

    private fun render() {
        questionHost.removeAllViews()
        val row = items[index]
        val q = row.question
        val card = U.card(act).apply { layoutParams = LinearLayout.LayoutParams(-1, -2) }

        val head = LinearLayout(act).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        head.addView(U.text(act, "第 ${row.seq} 题", 16f, U.DARK, true))
        head.addView(U.tag(act, QuestionType.name(q.type)).apply {
            val lp = LinearLayout.LayoutParams(-2, -2); lp.leftMargin = U.dp(act, 6f); layoutParams = lp
        })
        if (flags.contains(row.seq)) head.addView(U.tag(act, "标记", U.ORANGE_BG, 0xFFB96A12.toInt()).apply {
            val lp = LinearLayout.LayoutParams(-2, -2); lp.leftMargin = U.dp(act, 6f); layoutParams = lp
        })
        head.addView(View(act).apply { layoutParams = LinearLayout.LayoutParams(0, 1, 1f) })
        head.addView(U.text(act, "${index + 1}/${items.size}", 11.5f, U.TEXT3))
        card.addView(head)

        card.addView(U.text(act, q.stem, 15.5f, U.TEXT).apply { setPadding(0, U.dp(act, 10f), 0, 0) })

        when (q.type) {
            "single", "tf" -> renderChoice(card, q, multi = false)
            "multi" -> renderChoice(card, q, multi = true)
            "fill" -> renderFill(card, q)
            "subjective" -> renderSubjective(card, q)
        }
        questionHost.addView(card)
        questionHost.addView(U.text(act, "第 ${index + 1} / ${items.size} 题", 11.5f, U.TEXT3).apply {
            gravity = Gravity.CENTER; setPadding(0, U.dp(act, 10f), 0, 0)
        })
        refreshProgress()
    }

    private fun renderChoice(card: LinearLayout, q: Question, multi: Boolean) {
        val options = if (q.type == "tf") listOf("对", "错") else q.options ?: emptyList()
        val current = MiniJson.decodeStrings(items[index].rawAnswer).toMutableSet()
        val letters = "ABCDE"
        options.forEachIndexed { i, text ->
            val key = if (q.type == "tf") text else letters[i].toString()
            val row = LinearLayout(act).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                setPadding(U.dp(act, 12f), U.dp(act, 10f), U.dp(act, 12f), U.dp(act, 10f))
                background = U.round(if (key in current) U.LIGHT else Color.WHITE, 9f, if (key in current) U.PRIMARY else U.LINE, 1.2f)
                isClickable = true
            }
            if (q.type != "tf") {
                row.addView(U.text(act, key, 14f, U.PRIMARY, true).apply { setPadding(0, 0, U.dp(act, 8f), 0) })
            }
            row.addView(U.text(act, text, 14.5f, U.TEXT), LinearLayout.LayoutParams(0, -2, 1f))
            row.setOnClickListener {
                if (multi) {
                    if (!current.add(key)) current.remove(key)
                } else {
                    current.clear(); current.add(key)
                }
                saveChoice(current)
                render()
            }
            card.addView(row, LinearLayout.LayoutParams(-1, -2).apply { topMargin = U.dp(act, 8f) })
        }
    }

    private fun saveChoice(values: Set<String>) {
        val row = items[index]
        repo.saveAnswer(examId, row.seq, row.question, values.sorted(), null)
    }

    private fun renderFill(card: LinearLayout, q: Question) {
        val values = MiniJson.decodeStrings(items[index].rawAnswer)
        val inputs = ArrayList<EditText>()
        for (i in 0 until q.blankCount.coerceAtLeast(1)) {
            val line = LinearLayout(act).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
            line.addView(U.text(act, "第 ${i + 1} 空", 13f, U.TEXT2).apply { setPadding(0, 0, U.dp(act, 8f), 0) })
            val input = EditText(act).apply {
                hint = "请输入答案"
                setText(values.getOrNull(i) ?: "")
                setTextSize(android.util.TypedValue.COMPLEX_UNIT_SP, 14.5f)
                setPadding(U.dp(act, 10f), U.dp(act, 8f), U.dp(act, 10f), U.dp(act, 8f))
                background = U.round(Color.WHITE, 8f, U.LINE, 1.2f)
                setSingleLine(true)
            }
            input.addTextChangedListener(object : TextWatcher {
                override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
                override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {}
                override fun afterTextChanged(s: Editable?) {
                    val vals = inputs.map { it.text.toString() }
                    repo.saveAnswer(examId, items[index].seq, q, if (vals.any { it.isNotBlank() }) vals else null, null)
                    refreshProgress()
                }
            })
            inputs.add(input)
            line.addView(input, LinearLayout.LayoutParams(0, -2, 1f))
            card.addView(line, LinearLayout.LayoutParams(-1, -2).apply { topMargin = U.dp(act, 8f) })
        }
    }

    private fun renderSubjective(card: LinearLayout, q: Question) {
        val existing = MiniJson.decodeString(items[index].rawAnswer)
        val input = EditText(act).apply {
            hint = "请在此作答（可分点书写）"
            setText(existing)
            setTextSize(android.util.TypedValue.COMPLEX_UNIT_SP, 14.5f)
            minLines = 8
            gravity = Gravity.TOP
            setPadding(U.dp(act, 10f), U.dp(act, 10f), U.dp(act, 10f), U.dp(act, 10f))
            background = U.round(Color.WHITE, 9f, U.LINE, 1.2f)
        }
        input.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {}
            override fun afterTextChanged(s: Editable?) {
                repo.saveAnswer(examId, items[index].seq, q, null, s?.toString())
                refreshProgress()
            }
        })
        card.addView(input, LinearLayout.LayoutParams(-1, -2).apply { topMargin = U.dp(act, 8f) })
        card.addView(U.text(act, "主观题不自动评分，交卷后对照参考答案自评", 11.5f, U.TEXT3).apply {
            setPadding(0, U.dp(act, 6f), 0, 0)
        })
    }

    private fun showAnswerSheet() {
        val ctx: Context = act
        val scroll = ScrollView(ctx)
        val wrap = LinearLayout(ctx).apply { orientation = LinearLayout.VERTICAL; setPadding(U.dp(ctx, 16f), U.dp(ctx, 12f), U.dp(ctx, 16f), U.dp(ctx, 12f)) }
        val flow = FlowLayout(ctx)
        val answered = items.associate { row ->
            row.seq to (if (row.question.isSubjective) !MiniJson.decodeString(row.rawAnswer).isBlank()
            else MiniJson.decodeStrings(row.rawAnswer).any { it.isNotBlank() })
        }
        items.forEachIndexed { i, row ->
            val btn = U.text(ctx, row.seq.toString(), 13f, Color.WHITE, true).apply {
                gravity = Gravity.CENTER
                background = U.round(if (answered[row.seq] == true) U.PRIMARY else Color.WHITE, 7f, if (answered[row.seq] == true) U.PRIMARY else U.LINE, 1.2f)
                if (answered[row.seq] != true) setTextColor(U.TEXT2)
                setPadding(U.dp(ctx, 10f), U.dp(ctx, 8f), U.dp(ctx, 10f), U.dp(ctx, 8f))
                isClickable = true
            }
            if (flags.contains(row.seq)) btn.append("•")
            btn.setOnClickListener {
                index = i
                dialog?.dismiss()
                render()
            }
            val lp = android.view.ViewGroup.MarginLayoutParams(-2, -2)
            lp.setMargins(U.dp(ctx, 4f), U.dp(ctx, 4f), U.dp(ctx, 4f), U.dp(ctx, 4f))
            flow.addView(btn, lp)
        }
        wrap.addView(U.text(ctx, "答题卡（蓝=已答 · •=标记）", 14f, U.DARK, true))
        wrap.addView(flow, LinearLayout.LayoutParams(-1, -2).apply { topMargin = U.dp(ctx, 8f) })
        scroll.addView(wrap)
        dialog = AlertDialog.Builder(act).setView(scroll).setNegativeButton("关闭", null).show()
    }

    private var dialog: android.app.Dialog? = null

    fun confirmSubmit() {
        val unanswered = repo.unansweredSeqs(examId)
        if (unanswered.isNotEmpty()) {
            AlertDialog.Builder(act)
                .setTitle("还有 ${unanswered.size} 题未作答")
                .setMessage("考试要求全部作答后才能交卷：" + unanswered.take(30).joinToString("、") { "第${it}题" } + if (unanswered.size > 30) " 等" else "")
                .setPositiveButton("去作答") { _, _ ->
                    index = items.indexOfFirst { it.seq == unanswered.first() }.coerceAtLeast(0)
                    render()
                }
                .setNegativeButton("取消", null)
                .show()
            return
        }
        AlertDialog.Builder(act)
            .setTitle("确认交卷")
            .setMessage("全部 ${items.size} 题已作答，交卷后将立即评分。")
            .setPositiveButton("确认交卷") { _, _ -> doSubmit(false) }
            .setNegativeButton("再检查一下", null)
            .show()
    }

    fun confirmLeave() {
        AlertDialog.Builder(act)
            .setTitle("退出考试")
            .setMessage("进度已自动保存，可以稍后继续作答。")
            .setPositiveButton("退出") { _, _ -> act.showHome() }
            .setNegativeButton("继续作答", null)
            .show()
    }

    private fun doSubmit(auto: Boolean) {
        if (submitted) return
        submitted = true
        handler.removeCallbacks(tick)
        try {
            repo.submitExam(examId, auto)
            act.showResult(examId)
        } catch (e: Exception) {
            submitted = false
            Toast.makeText(act, e.message ?: "交卷失败", Toast.LENGTH_SHORT).show()
        }
    }

    private fun fmt(sec: Int): String {
        val h = sec / 3600
        val m = (sec % 3600) / 60
        val s = sec % 60
        return if (h > 0) String.format("%d:%02d:%02d", h, m, s) else String.format("%02d:%02d", m, s)
    }

    init {
        // 构建完成后渲染第一题
        render()
    }
}
