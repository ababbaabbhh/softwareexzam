package com.softexam

import android.app.AlertDialog
import android.content.Context
import android.graphics.Color
import android.view.Gravity
import android.view.View
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import com.softexam.core.Modes
import com.softexam.data.Repo
import com.softexam.ui.FlowLayout
import com.softexam.ui.U
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** 首页：统计、考试模式、练习模式、真题、最近考试。 */
class HomeScreen(private val act: MainActivity, private val repo: Repo) : MainActivity.Screen {

    override val root: View = build()

    private fun build(): View {
        val ctx = act
        val meta = repo.meta()
        val byType = meta.byType
        val total = meta.total

        val root = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(U.BG)
        }
        root.addView(topBar(ctx))

        val content = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(U.dp(ctx, 16f), U.dp(ctx, 12f), U.dp(ctx, 16f), U.dp(ctx, 28f))
        }

        // 顶部统计卡
        val hero = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            background = U.round(U.DARK, 14f)
            setPadding(U.dp(ctx, 18f), U.dp(ctx, 18f), U.dp(ctx, 18f), U.dp(ctx, 18f))
        }
        hero.addView(U.text(ctx, "软件设计师 · 全真模拟", 21f, Color.WHITE, true))
        hero.addView(U.text(ctx, "软考中级 · 完全离线 · 手机随时刷题", 12.5f, 0xFFC9D8EA.toInt()).apply {
            setPadding(0, U.dp(ctx, 5f), 0, 0)
        })
        val flow = FlowLayout(ctx).apply { setPadding(0, U.dp(ctx, 12f), 0, 0) }
        fun chip(label: String, n: Int) {
            val tv = U.chip(ctx, "$label $n", 0x26FFFFFF, Color.WHITE)
            val lp = android.view.ViewGroup.MarginLayoutParams(-2, -2)
            lp.setMargins(0, 0, U.dp(ctx, 8f), U.dp(ctx, 8f))
            flow.addView(tv, lp)
        }
        chip("题库", total)
        chip("单选", byType["single"] ?: 0)
        chip("多选", byType["multi"] ?: 0)
        chip("填空", byType["fill"] ?: 0)
        chip("判断", byType["tf"] ?: 0)
        chip("主观", byType["subjective"] ?: 0)
        hero.addView(flow)
        content.addView(hero)

        // 进行中的考试
        meta.activeExam?.let { ex ->
            val banner = LinearLayout(ctx).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                background = U.round(0xFFFFF8EC.toInt(), 10f, 0xFFF3D9AD.toInt(), 1f)
                setPadding(U.dp(ctx, 14f), U.dp(ctx, 10f), U.dp(ctx, 14f), U.dp(ctx, 10f))
            }
            val lp = LinearLayout.LayoutParams(-1, -2).apply { topMargin = U.dp(ctx, 12f) }
            banner.addView(U.text(ctx, "进行中：${ex.title}", 13f, 0xFF8A5A10.toInt(), true).apply { maxLines = 1 })
            banner.addView(View(ctx).apply { layoutParams = LinearLayout.LayoutParams(0, 1, 1f) })
            banner.addView(U.button(ctx, "继续", U.PRIMARY) { act.showExam(ex.id) })
            val lp2 = LinearLayout.LayoutParams(-2, -2).apply { leftMargin = U.dp(ctx, 8f) }
            banner.addView(U.button(ctx, "放弃", 0xFFB96A12.toInt()) {
                confirmAbort(ex.id)
            }, lp2)
            content.addView(banner, lp)
        }

        // 考试模式
        content.addView(U.section(ctx, "考试模式"))
        content.addView(modeCard(
            ctx, "上午卷 · 基础知识", "75 道单选 · 150 分钟 · 75 分 · 45 分合格",
            { startExam(Modes.MORNING, null) },
        ))
        content.addView(modeCard(
            ctx, "下午卷 · 应用技术", "5 道案例题 · 150 分钟 · 75 分 · 主观题自评",
            { startExam(Modes.AFTERNOON, null) },
        ))
        content.addView(modeCard(
            ctx, "综合训练卷", "单选 40 + 多选 15 + 填空 15 + 判断 15 · 120 分钟 · 100 分",
            { startExam(Modes.MIXED, null) },
        ))

        // 练习模式
        content.addView(U.section(ctx, "练习模式"))
        content.addView(modeCard(
            ctx, "基础知识练习", "随机出题 · 点「下一题」立即看答案与解析 · 整库循环不重复",
            { act.showPractice("basic") },
        ))
        content.addView(modeCard(
            ctx, "应用技术练习", "二级案例题 · 作答后对照参考答案与评分要点",
            { act.showPractice("application") },
        ))

        // 历年真题
        if (meta.papers.isNotEmpty()) {
            content.addView(U.section(ctx, "历年真题（完整成套）"))
            meta.papers.forEach { p ->
                val card = LinearLayout(ctx).apply {
                    orientation = LinearLayout.HORIZONTAL
                    gravity = Gravity.CENTER_VERTICAL
                    background = U.round(U.CARD, 12f, U.LINE, 1f)
                    setPadding(U.dp(ctx, 14f), U.dp(ctx, 12f), U.dp(ctx, 14f), U.dp(ctx, 12f))
                }
                val info = LinearLayout(ctx).apply { orientation = LinearLayout.VERTICAL }
                info.addView(U.text(ctx, p.second, 15f, U.DARK, true))
                info.addView(U.text(ctx, "${p.third} 题 · 150 分钟 · 使用官方试卷原题", 12f, U.TEXT3))
                card.addView(info, LinearLayout.LayoutParams(0, -2, 1f))
                card.addView(U.button(ctx, "开始", U.PRIMARY) { startExam(Modes.REAL, p.first) })
                content.addView(card, LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = U.dp(ctx, 10f) })
            }
        }

        // 最近考试
        content.addView(U.section(ctx, "最近考试"))
        val recent = repo.history(5)
        if (recent.isEmpty()) {
            content.addView(U.text(ctx, "还没有考试记录，先来一场模拟吧。", 13.5f, U.TEXT3).apply {
                setPadding(U.dp(ctx, 4f), U.dp(ctx, 10f), 0, 0)
            })
        } else {
            recent.forEach { ex ->
                val row = LinearLayout(ctx).apply {
                    orientation = LinearLayout.HORIZONTAL
                    gravity = Gravity.CENTER_VERTICAL
                    background = U.round(U.CARD, 12f, U.LINE, 1f)
                    setPadding(U.dp(ctx, 14f), U.dp(ctx, 10f), U.dp(ctx, 14f), U.dp(ctx, 10f))
                }
                val info = LinearLayout(ctx).apply { orientation = LinearLayout.VERTICAL }
                info.addView(U.text(ctx, ex.title, 14f, U.DARK, true).apply { maxLines = 1 })
                info.addView(U.text(ctx, "${fmtDate(ex.startedAt)} · ${statusText(ex)}", 11.5f, U.TEXT3))
                row.addView(info, LinearLayout.LayoutParams(0, -2, 1f))
                val score = if (ex.status == "submitted") "${ex.totalScore?.toInt() ?: 0}" else "—"
                row.addView(U.text(ctx, score, 20f, U.PRIMARY, true))
                row.setOnClickListener { act.showResult(ex.id) }
                content.addView(row, LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = U.dp(ctx, 8f) })
            }
        }

        content.addView(U.text(ctx, "全部数据保存在本机 · 无需联网", 11.5f, U.TEXT3).apply {
            gravity = Gravity.CENTER
            setPadding(0, U.dp(ctx, 22f), 0, 0)
        })

        root.addView(ScrollView(ctx).apply { addView(content) }, LinearLayout.LayoutParams(-1, 0, 1f))
        return root
    }

    private fun topBar(ctx: Context): View = LinearLayout(ctx).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        setBackgroundColor(U.DARK)
        setPadding(U.dp(ctx, 16f), U.dp(ctx, 12f), U.dp(ctx, 12f), U.dp(ctx, 12f))
        addView(U.text(ctx, "软件设计师模考", 17f, Color.WHITE, true), LinearLayout.LayoutParams(0, -2, 1f))
        addView(U.button(ctx, "历史记录", 0x00000000, Color.WHITE) { act.showHistory() })
    }

    private fun modeCard(ctx: Context, title: String, desc: String, onStart: () -> Unit): View =
        LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            background = U.round(U.CARD, 12f, U.LINE, 1f)
            setPadding(U.dp(ctx, 14f), U.dp(ctx, 14f), U.dp(ctx, 14f), U.dp(ctx, 14f))
            addView(U.text(ctx, title, 15.5f, U.DARK, true))
            addView(U.text(ctx, desc, 12.5f, U.TEXT2).apply { setPadding(0, U.dp(ctx, 4f), 0, U.dp(ctx, 10f)) })
            addView(U.button(ctx, "开始", U.PRIMARY, Color.WHITE, onStart), LinearLayout.LayoutParams(-1, -2))
            layoutParams = LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = U.dp(ctx, 10f) }
        }

    private fun startExam(mode: String, paper: String?) {
        try {
            val id = repo.startExam(mode, paper)
            act.showExam(id)
        } catch (e: Repo.ActiveExamException) {
            AlertDialog.Builder(act)
                .setTitle("已有进行中的考试")
                .setMessage("同一时间只允许一场考试。可以继续上次的考试，或放弃后开始新的考试。")
                .setPositiveButton("继续上次") { _, _ -> act.showExam(e.examId) }
                .setNegativeButton("放弃并开始") { _, _ ->
                    repo.abort(e.examId)
                    startExam(mode, paper)
                }
                .setNeutralButton("取消", null)
                .show()
        } catch (e: Exception) {
            toast(e.message ?: "组卷失败")
        }
    }

    private fun confirmAbort(examId: Long) {
        AlertDialog.Builder(act)
            .setTitle("放弃本场考试")
            .setMessage("确定放弃这场进行中的考试吗？")
            .setPositiveButton("放弃") { _, _ -> repo.abort(examId); act.showHome() }
            .setNegativeButton("继续作答") { _, _ -> act.showExam(examId) }
            .show()
    }

    private fun toast(msg: String) = Toast.makeText(act, msg, Toast.LENGTH_SHORT).show()

    companion object {
        fun fmtDate(ts: Long): String {
            val f = SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.CHINA)
            return f.format(Date(ts))
        }

        fun statusText(ex: com.softexam.core.ExamRow): String = when (ex.status) {
            "submitted" -> if (ex.autoSubmitted) "超时交卷" else "已交卷"
            "aborted" -> "已放弃"
            else -> "进行中"
        }
    }
}
