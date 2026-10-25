package com.softexam

import com.softexam.core.Grade
import com.softexam.core.MiniJson
import com.softexam.core.Modes
import com.softexam.core.Paper
import com.softexam.core.Practice
import com.softexam.core.Question
import com.softexam.core.QuestionSource
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.random.Random

/** 核心逻辑 JVM 单元测试（不依赖 Android 运行时）。 */
class CoreTest {

    private fun q(
        id: Long,
        type: String = "single",
        topic: String = "DS_ALGO",
        knowledge: String? = "考点",
        options: List<String>? = listOf("甲", "乙", "丙", "丁"),
        answer: List<String> = listOf("A"),
        score: Double = 1.0,
        difficulty: Int = 2,
        paper: String? = null,
        seqNo: Int? = null,
    ) = Question(
        id = id, type = type, topic = topic, knowledge = knowledge, stem = "测试题干 $id",
        options = options, answer = answer, rubric = null, explanation = null,
        score = score, difficulty = difficulty, paper = paper, paperTitle = null, seqNo = seqNo,
    )

    @Test fun normalizeHandlesFullWidthAndSpaces() {
        assertEquals("ab", Grade.normalize(" Ａ Ｂ\t"))
        assertEquals("o(nlogn)", Grade.normalize("O(n log n)"))
    }

    @Test fun singleChoice() {
        val question = q(1, answer = listOf("B"))
        assertEquals(true, Grade.grade(question, listOf("B")).correct)
        assertEquals(1.0, Grade.grade(question, listOf("B")).awarded!!, 0.001)
        assertEquals(false, Grade.grade(question, listOf("A")).correct)
        assertEquals(0.0, Grade.grade(question, listOf("A")).awarded!!, 0.001)
    }

    @Test fun multiChoiceAllOrNothing() {
        val question = q(2, type = "multi", answer = listOf("A", "C"), score = 2.0)
        assertTrue(Grade.grade(question, listOf("C", "A")).correct == true)
        assertEquals(2.0, Grade.grade(question, listOf("C", "A")).awarded!!, 0.001)
        assertFalse(Grade.grade(question, listOf("A")).correct == true)
        assertFalse(Grade.grade(question, listOf("A", "B", "C")).correct == true)
        assertFalse(Grade.grade(question, listOf("B", "D")).correct == true)
    }

    @Test fun trueFalseVariants() {
        val question = q(3, type = "tf", answer = listOf("对"), options = null)
        assertTrue(Grade.grade(question, listOf("正确")).correct == true)
        assertFalse(Grade.grade(question, listOf("错")).correct == true)
    }

    @Test fun fillPartialCredit() {
        val question = q(4, type = "fill", answer = listOf("O(nlogn)|O(n log n)", "快速排序"), options = null, score = 2.0)
        val all = Grade.grade(question, listOf("O(n log n)", "快速排序"))
        assertEquals(2.0, all.awarded!!, 0.001)
        val half = Grade.grade(question, listOf("O(nlogn)", "冒泡排序"))
        assertEquals(1.0, half.awarded!!, 0.001)
        assertEquals(1, half.matchedBlanks)
    }

    @Test fun subjectiveNotAutoGraded() {
        val question = q(5, type = "subjective", options = null, answer = listOf("参考答案"), score = 15.0)
        assertNull(Grade.grade(question, null).awarded)
        assertNull(Grade.grade(question, null).correct)
    }

    @Test fun passLines() {
        assertEquals(45.0, Grade.passLine(Modes.MORNING, 75.0), 0.001)
        assertEquals(60.0, Grade.passLine(Modes.MIXED, 100.0), 0.001)
    }

    @Test fun miniJsonRoundTrip() {
        val values = listOf("a\"b", "换行\n测试", "反斜杠\\")
        assertEquals(values, MiniJson.decodeStrings(MiniJson.encodeStrings(values)))
        assertEquals("多行\n文本", MiniJson.decodeString(MiniJson.encodeString("多行\n文本")))
    }

    @Test fun practiceShuffleKeepsAllIds() {
        val ids = (1L..100L).toList()
        val shuffled = Practice.shuffledIds(ids, Random(42))
        assertEquals(100, shuffled.size)
        assertEquals(ids.toSet(), shuffled.toSet())
    }

    /** 内存假题库：每个模块 30 单选 / 15 多选 / 15 填空 / 15 判断，另含主观题各 8 道。 */
    private class FakeSource : QuestionSource {
        private val all = ArrayList<Question>()
        private var id = 0L

        init {
            val topics = listOf("DS_ALGO", "SE", "OO", "DB", "OS", "NET", "PL", "CO", "SEC", "MULTI")
            for (topic in topics) {
                repeat(30) {
                    id += 1
                    all.add(Question(id, "single", topic, "$topic-$it", "单选题 $id", listOf("A", "B", "C", "D"), listOf("ABCD"[it % 4].toString()), null, null, 1.0, it % 3 + 1))
                }
                repeat(15) {
                    id += 1
                    all.add(Question(id, "multi", topic, "$topic-m$it", "多选题 $id", listOf("A", "B", "C", "D"), listOf("A", "C"), null, null, 2.0, 2))
                }
                repeat(15) {
                    id += 1
                    all.add(Question(id, "fill", topic, "$topic-f$it", "填空 $id ____", null, listOf("答案"), null, null, 1.0, 2))
                }
                repeat(15) {
                    id += 1
                    all.add(Question(id, "tf", topic, "$topic-t$it", "判断 $id", null, listOf("对"), null, null, 1.0, 1))
                }
            }
            for (k in listOf("数据流图", "数据库设计", "UML建模", "算法设计", "程序设计-C++", "程序设计-Java")) {
                repeat(8) {
                    id += 1
                    all.add(Question(id, "subjective", "SE", k, "案例 $id", null, listOf("参考答案"), listOf("要点"), null, 15.0, 3))
                }
            }
            // 真题 75 题
            repeat(75) {
                id += 1
                all.add(Question(id, "single", "DS_ALGO", "真题", "真题 $id", listOf("A", "B", "C", "D"), listOf("A"), null, "解析", 1.0, 2, paper = "TEST下", seqNo = it + 1))
            }
        }

        override fun pool(type: String, topic: String?): List<Question> =
            all.filter { it.type == type && (topic == null || it.topic == topic) }

        override fun byKnowledge(type: String, knowledge: String): List<Question> =
            all.filter { it.type == type && it.knowledge == knowledge }

        override fun byPaper(paper: String): List<Question> = all.filter { it.paper == paper }
    }

    @Test fun morningPaperWeights() {
        val source = FakeSource()
        val paper = Paper.build(source, Modes.MORNING, null, Random(7))
        assertEquals(75, paper.items.size)
        val counts = paper.items.groupingBy { it.topic }.eachCount()
        assertEquals(17, counts["DS_ALGO"])
        assertEquals(14, counts["SE"])
        assertEquals(11, counts["OO"])
        assertEquals(10, counts["DB"])
        assertEquals(8, counts["OS"])
        assertEquals(6, counts["NET"])
        assertEquals(5, counts["PL"])
        assertEquals(2, counts["CO"])
        assertEquals(1, counts["SEC"])
        assertEquals(1, counts["MULTI"])
        assertEquals(75, paper.items.map { it.qid }.toSet().size)
        for (i in 2 until paper.items.size) {
            assertFalse(
                "第 ${i + 1} 题出现连续 3 题同模块",
                paper.items[i].topic == paper.items[i - 1].topic && paper.items[i].topic == paper.items[i - 2].topic,
            )
        }
    }

    @Test fun mixedPaperScore100() {
        val paper = Paper.build(FakeSource(), Modes.MIXED, null, Random(3))
        assertEquals(85, paper.items.size)
        assertEquals(100.0, paper.items.sumOf { it.score }, 0.001)
    }

    @Test fun afternoonPaperFiveQuestions() {
        val paper = Paper.build(FakeSource(), Modes.AFTERNOON, null, Random(5))
        assertEquals(5, paper.items.size)
        paper.items.forEach { assertEquals(15.0, it.score, 0.001) }
        assertEquals(5, paper.items.map { it.section }.toSet().size)
    }

    @Test fun realPaper75() {
        val paper = Paper.build(FakeSource(), Modes.REAL, "TEST下", Random(1))
        assertEquals(75, paper.items.size)
        assertEquals(75, paper.items.map { it.qid }.toSet().size)
    }

    @Test fun unansweredDetection() {
        assertFalse(Grade.isAnswered("single", null))
        assertFalse(Grade.isAnswered("fill", listOf("", " ")))
        assertTrue(Grade.isAnswered("single", listOf("A")))
        assertNotNull(Grade.grade(q(9), listOf("A")))
    }
}
