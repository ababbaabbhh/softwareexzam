package com.softexam

import android.app.AlertDialog
import android.content.Context
import android.graphics.Color
import android.view.Gravity
import android.view.View
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.Toast
import com.softexam.core.Modes
import com.softexam.data.Repo
import com.softexam.ui.U

/** 历史记录：查看 / 重做 / 删除。 */
class HistoryScreen(private val act: MainActivity, private val repo: Repo) : MainActivity.Screen {

    override val root: View = build()

    private fun build(): View {
        val ctx = act
        val root = LinearLayout(ctx).apply { orientation = LinearLayout.VERTICAL; setBackgroundColor(U.BG) }
        root.addView(topBar(ctx))
        val list = repo.history(200)
        val content = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(U.dp(ctx, 16f), U.dp(ctx, 12f), U.dp(ctx, 16f), U.dp(ctx, 30f))
        }
        if (list.isEmpty()) {
            content.addView(U.text(ctx, "暂无考试记录", 14f, U.TEXT3).apply { gravity = Gravity.CENTER; setPadding(0, U.dp(ctx, 40f), 0, 0) })
        } else {
            list.forEach { ex -> content.addView(item(ctx, ex)) }
        }
        root.addView(ScrollView(ctx).apply { addView(content) }, LinearLayout.LayoutParams(-1, 0, 1f))
        return root
    }

    private fun topBar(ctx: Context): View = LinearLayout(ctx).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        setBackgroundColor(U.DARK)
        setPadding(U.dp(ctx, 12f), U.dp(ctx, 10f), U.dp(ctx, 12f), U.dp(ctx, 10f))
        addView(U.button(ctx, "← 首页", 0x00000000, Color.WHITE) { act.showHome() })
        addView(U.text(ctx, "历史记录", 16f, Color.WHITE, true).apply { gravity = Gravity.CENTER }, LinearLayout.LayoutParams(0, -2, 1f))
        addView(View(ctx).apply { layoutParams = LinearLayout.LayoutParams(U.dp(ctx, 52f), 1) })
    }

    private fun item(ctx: Context, ex: com.softexam.core.ExamRow): View {
        val card = U.card(ctx).apply {
            layoutParams = LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = U.dp(ctx, 10f) }
        }
        val head = LinearLayout(ctx).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        head.addView(U.text(ctx, ex.title, 14.5f, U.DARK, true).apply { maxLines = 1 }, LinearLayout.LayoutParams(0, -2, 1f))
        val score = if (ex.status == "submitted") "${ex.totalScore ?: 0.0}" else "—"
        head.addView(U.text(ctx, score, 20f, U.PRIMARY, true))
        head.addView(U.text(ctx, "分", 11.5f, U.TEXT3))
        card.addView(head)
        val sub = "${HomeScreen.fmtDate(ex.startedAt)} · ${Modes.short(ex.mode)} · ${HomeScreen.statusText(ex)}"
        card.addView(U.text(ctx, sub, 11.5f, U.TEXT3))

        val actions = LinearLayout(ctx).apply { orientation = LinearLayout.HORIZONTAL; setPadding(0, U.dp(ctx, 10f), 0, 0) }
        actions.addView(U.ghostButton(ctx, "查看") { act.showResult(ex.id) }, LinearLayout.LayoutParams(0, -2, 1f))
        actions.addView(U.ghostButton(ctx, "重做") { retake(ex.id) }, LinearLayout.LayoutParams(0, -2, 1f).apply { leftMargin = U.dp(ctx, 8f) })
        actions.addView(U.ghostButton(ctx, "删除") { confirmDelete(ex.id) }, LinearLayout.LayoutParams(0, -2, 1f).apply { leftMargin = U.dp(ctx, 8f) })
        card.addView(actions)
        return card
    }

    private fun retake(examId: Long) {
        try {
            val newId = repo.retake(examId)
            act.showExam(newId)
        } catch (e: Repo.ActiveExamException) {
            AlertDialog.Builder(act)
                .setTitle("已有进行中的考试")
                .setMessage("请先继续或放弃当前考试。")
                .setPositiveButton("继续上次") { _, _ -> act.showExam(e.examId) }
                .setNegativeButton("放弃并重做") { _, _ ->
                    repo.abort(e.examId)
                    retake(examId)
                }
                .show()
        } catch (e: Exception) {
            Toast.makeText(act, e.message ?: "重做失败", Toast.LENGTH_SHORT).show()
        }
    }

    private fun confirmDelete(examId: Long) {
        AlertDialog.Builder(act)
            .setTitle("删除考试记录")
            .setMessage("删除后不可恢复，确定删除吗？")
            .setPositiveButton("删除") { _, _ ->
                repo.delete(examId)
                act.showHistory()
            }
            .setNegativeButton("取消", null)
            .show()
    }
}
