package com.softexam

import android.app.Activity
import android.os.Bundle
import android.view.View
import android.widget.FrameLayout
import com.softexam.data.Repo

/** 单 Activity + 屏幕栈式导航（程序化 UI，无第三方框架）。 */
class MainActivity : Activity() {

    interface Screen {
        val root: View
        fun onShow() {}
        fun onHide() {}
    }

    lateinit var repo: Repo
    private lateinit var container: FrameLayout
    private var screen: Screen? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        repo = Repo(this)
        container = FrameLayout(this)
        container.setBackgroundColor(0xFFF2F5F9.toInt())
        setContentView(container)
        showHome()
    }

    private fun setScreen(next: Screen) {
        screen?.onHide()
        container.removeAllViews()
        screen = next
        container.addView(next.root)
        next.onShow()
    }

    fun showHome() = setScreen(HomeScreen(this, repo))
    fun showHistory() = setScreen(HistoryScreen(this, repo))
    fun showExam(examId: Long) {
        val ex = repo.exam(examId)
        when {
            ex == null -> showHome()
            ex.status == "submitted" -> showResult(examId)
            ex.status == "aborted" -> showHome()
            else -> setScreen(ExamScreen(this, repo, examId))
        }
    }

    fun showResult(examId: Long) {
        val ex = repo.exam(examId)
        when {
            ex == null -> showHome()
            ex.inProgress -> showExam(examId)
            else -> setScreen(ResultScreen(this, repo, examId))
        }
    }
    fun showPractice(mode: String) = setScreen(PracticeScreen(this, repo, mode))

    override fun onPause() {
        super.onPause()
        screen?.onHide()
    }

    override fun onResume() {
        super.onResume()
        screen?.onShow()
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        val s = screen
        if (s is ExamScreen) s.confirmLeave()
        else if (s is HomeScreen) super.onBackPressed()
        else showHome()
    }
}
