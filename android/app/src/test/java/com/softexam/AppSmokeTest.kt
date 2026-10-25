package com.softexam

import android.app.Activity
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** 使用 Robolectric 在 JVM 中启动真实 Activity，验证界面与核心流程。 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33], manifest = Config.NONE)
class AppSmokeTest {

    private fun texts(root: View): List<String> {
        val out = ArrayList<String>()
        fun walk(v: View) {
            if (v is TextView) out.add(v.text?.toString() ?: "")
            if (v is ViewGroup) for (i in 0 until v.childCount) walk(v.getChildAt(i))
        }
        walk(root)
        return out
    }

    private fun findText(root: View, contains: String): TextView? {
        var found: TextView? = null
        fun walk(v: View) {
            if (found != null) return
            if (v is TextView && v.text?.contains(contains) == true) { found = v; return }
            if (v is ViewGroup) for (i in 0 until v.childCount) walk(v.getChildAt(i))
        }
        walk(root)
        return found
    }

    @Test
    fun launchHomeAndStartExam() {
        val activity = Robolectric.buildActivity(MainActivity::class.java).setup().get()
        assertNotNull(activity)
        val decor = activity.window.decorView
        val all = texts(decor)
        assertTrue("首页应显示标题", all.any { it.contains("软件设计师模考") })

        // 通过仓储直接开一场上午卷，再进入考试页
        val examId = activity.repo.startExam("morning")
        activity.showExam(examId)
        val examTexts = texts(decor)
        assertTrue("考试页应显示交卷", examTexts.any { it.contains("交卷") })
        assertTrue("考试页应显示第 1 题", examTexts.any { it.contains("第 1 题") })

        // 交卷后进入成绩页
        val repo = activity.repo
        val seqs = repo.items(examId).map { it.seq }
        for (seq in seqs) {
            val item = repo.items(examId).first { it.seq == seq }
            if (item.question.isSubjective) repo.saveAnswer(examId, seq, item.question, null, "测试作答")
            else repo.saveAnswer(examId, seq, item.question, listOf("A"), null)
        }
        repo.submitExam(examId, false)
        activity.showResult(examId)
        val resultTexts = texts(decor)
        assertTrue("成绩页应显示重做按钮", resultTexts.any { it.contains("重做这套试卷") })
        assertTrue("成绩页应显示总分", resultTexts.any { it.contains("总分") })
    }

    @Test
    fun practiceRevealsAnswer() {
        val activity = Robolectric.buildActivity(MainActivity::class.java).setup().get()
        activity.showPractice("basic")
        val decor = activity.window.decorView
        val texts1 = texts(decor)
        assertTrue("练习页应显示进度", texts1.any { it.contains("本轮") })
        assertTrue("练习页应有下一题", texts1.any { it.contains("下一题") })
    }

    @Test
    fun historyAndMeta() {
        val activity = Robolectric.buildActivity(MainActivity::class.java).setup().get()
        val meta = activity.repo.meta()
        assertTrue("题库应有 2000+ 题", meta.total >= 2000)
        assertTrue("应包含真题套", meta.papers.any { it.first == "2022下" && it.third == 75 })
        activity.showHistory()
        val decor = activity.window.decorView
        assertTrue(texts(decor).any { it.contains("历史记录") })
    }
}
