package com.softexam.core

import kotlin.random.Random

/** 练习模式：两套题库与循环规则。 */
object Practice {
    const val BASIC = "basic"
    const val APPLICATION = "application"

    fun types(mode: String): List<String> =
        if (mode == BASIC) listOf("single", "multi", "fill", "tf") else listOf("subjective")

    fun name(mode: String): String = if (mode == BASIC) "基础知识练习" else "应用技术练习"

    fun shuffledIds(ids: List<Long>, rng: Random = Random.Default): List<Long> = ids.shuffled(rng)

    /** 一题的结果展示文案所需信息。 */
    data class CheckResult(
        val correct: Boolean?,
        val awarded: Double?,
        val matchedBlanks: Int,
        val totalBlanks: Int,
    )

    fun check(question: Question, answer: List<String>?): CheckResult {
        val r = Grade.grade(question, answer)
        return CheckResult(r.correct, r.awarded, r.matchedBlanks, r.totalBlanks)
    }
}
