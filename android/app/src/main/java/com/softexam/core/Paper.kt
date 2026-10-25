package com.softexam.core

import kotlin.random.Random

/** 组卷所需的数据源（Android 由 SQLite 实现，测试可用内存实现）。 */
interface QuestionSource {
    fun pool(type: String, topic: String?): List<Question>
    fun byKnowledge(type: String, knowledge: String): List<Question>
    fun byPaper(paper: String): List<Question>
}

/** 组卷策略：与 Web 版一致。 */
object Paper {
    val morningWeights: Map<String, Int> = linkedMapOf(
        "DS_ALGO" to 17, "SE" to 14, "OO" to 11, "DB" to 10, "OS" to 8,
        "NET" to 6, "PL" to 5, "CO" to 2, "SEC" to 1, "MULTI" to 1,
    )

    data class MixedPlan(val type: String, val count: Int, val score: Double, val section: String)

    val mixedPlan = listOf(
        MixedPlan("single", 40, 1.0, "一、单项选择题"),
        MixedPlan("multi", 15, 2.0, "二、多项选择题"),
        MixedPlan("fill", 15, 1.0, "三、填空题"),
        MixedPlan("tf", 15, 1.0, "四、判断题"),
    )

    private val mixedWeights = linkedMapOf(
        "DS_ALGO" to 22, "SE" to 18, "OO" to 14, "DB" to 14, "OS" to 10,
        "NET" to 9, "PL" to 6, "CO" to 4, "SEC" to 2, "MULTI" to 1,
    )

    data class Slot(val knowledge: String, val section: String)

    val afternoonSlots = listOf(
        Slot("数据流图", "试题一 · 数据流图"),
        Slot("数据库设计", "试题二 · 数据库设计"),
        Slot("UML建模", "试题三 · UML 建模"),
        Slot("算法设计", "试题四 · 算法设计"),
    )

    fun build(source: QuestionSource, mode: String, paperId: String?, rng: Random = Random.Default): BuiltPaper =
        when (mode) {
            Modes.MORNING -> buildMorning(source, rng)
            Modes.AFTERNOON -> buildAfternoon(source, rng)
            Modes.MIXED -> buildMixed(source, rng)
            Modes.REAL -> buildReal(source, paperId ?: throw IllegalArgumentException("缺少真题套"))
            else -> throw IllegalArgumentException("未知考试模式：$mode")
        }

    private fun shuffled(list: List<Question>, rng: Random): List<Question> = list.shuffled(rng)

    private fun sample(pool: List<Question>, count: Int, used: MutableSet<Long>, rng: Random): List<Question>? {
        val avail = shuffled(pool.filter { it.id !in used }, rng)
        if (avail.size < count) return null
        val easy = avail.filter { it.difficulty <= 1 }
        val mid = avail.filter { it.difficulty == 2 }
        val hard = avail.filter { it.difficulty >= 3 }
        val wantEasy = Math.round(count * 0.35).toInt()
        val wantHard = Math.round(count * 0.2).toInt()
        val wantMid = count - wantEasy - wantHard
        val picked = ArrayList<Question>(count)
        fun take(list: List<Question>, n: Int) {
            var k = n
            for (q in list) {
                if (k <= 0 || picked.size >= count) break
                if (q !in picked) {
                    picked.add(q)
                    k -= 1
                }
            }
        }
        take(easy, wantEasy); take(mid, wantMid); take(hard, wantHard)
        for (q in avail) {
            if (picked.size >= count) break
            if (q !in picked) picked.add(q)
        }
        if (picked.size < count) return null
        picked.forEach { used.add(it.id) }
        return picked
    }

    private fun splitByWeight(weights: Map<String, Int>, count: Int): List<Pair<String, Int>> {
        val total = weights.values.sum().toDouble()
        val entries = weights.map { (topic, w) -> topic to (w * count / total) }
        val base = entries.map { it.first to Math.floor(it.second).toInt() }.toMutableList()
        var rest = count - base.sumOf { it.second }
        val byFrac = entries.sortedByDescending { it.second - Math.floor(it.second) }
        for ((topic, _) in byFrac) {
            if (rest <= 0) break
            val idx = base.indexOfFirst { it.first == topic }
            if (idx >= 0) {
                base[idx] = topic to (base[idx].second + 1)
                rest -= 1
            }
        }
        return base
    }

    private fun interleave(items: List<NewItem>, rng: Random): List<NewItem> {
        val a = items.shuffled(rng).toMutableList()
        for (i in 2 until a.size) {
            if (a[i].topic == a[i - 1].topic && a[i].topic == a[i - 2].topic) {
                val j = (i + 1 until a.size).firstOrNull { a[it].topic != a[i].topic }
                if (j != null) {
                    val t = a[i]; a[i] = a[j]; a[j] = t
                }
            }
        }
        return a
    }

    private fun buildMorning(source: QuestionSource, rng: Random): BuiltPaper {
        val used = HashSet<Long>()
        val items = ArrayList<NewItem>(75)
        for ((topic, n) in splitByWeight(morningWeights, 75)) {
            if (n == 0) continue
            val picked = sample(source.pool("single", topic), n, used, rng)
                ?: throw IllegalStateException("题库不足：模块 $topic 的单选题不足以抽取 $n 道")
            picked.forEach { items.add(NewItem(it.id, it.topic, "上午卷 · 单项选择题", 1.0)) }
        }
        if (items.size != 75) throw IllegalStateException("题库不足：无法凑齐 75 道上午卷单选题")
        return BuiltPaper(
            title = "软件设计师 · 上午卷（基础知识）模拟",
            mode = Modes.MORNING,
            durationSec = 150 * 60,
            items = interleave(items, rng),
        )
    }

    private fun buildMixed(source: QuestionSource, rng: Random): BuiltPaper {
        val used = HashSet<Long>()
        val items = ArrayList<NewItem>()
        for (plan in mixedPlan) {
            val pickedAll = ArrayList<Question>()
            for ((topic, n) in splitByWeight(mixedWeights, plan.count)) {
                if (n == 0) continue
                val picked = sample(source.pool(plan.type, topic), n, used, rng)
                    ?: sample(source.pool(plan.type, null), n, used, rng)
                    ?: throw IllegalStateException("题库不足：${plan.type} 题型不足以抽取 ${plan.count} 道")
                pickedAll.addAll(picked)
            }
            if (pickedAll.size < plan.count) {
                val rest = sample(source.pool(plan.type, null), plan.count - pickedAll.size, used, rng)
                    ?: throw IllegalStateException("题库不足：${plan.type} 题型不足以抽取 ${plan.count} 道")
                pickedAll.addAll(rest)
            }
            pickedAll.forEach { items.add(NewItem(it.id, it.topic, plan.section, plan.score)) }
        }
        return BuiltPaper(
            title = "软件设计师 · 综合训练模拟卷",
            mode = Modes.MIXED,
            durationSec = 120 * 60,
            items = items,
        )
    }

    private fun buildAfternoon(source: QuestionSource, rng: Random): BuiltPaper {
        val used = HashSet<Long>()
        val items = ArrayList<NewItem>()
        for (slot in afternoonSlots) {
            val picked = sample(source.byKnowledge("subjective", slot.knowledge), 1, used, rng)
                ?: throw IllegalStateException("题库不足：缺少“${slot.knowledge}”主观题")
            items.add(NewItem(picked[0].id, picked[0].topic, slot.section, 15.0))
        }
        val lang = if (rng.nextInt(2) == 0) "程序设计-C++" else "程序设计-Java"
        val picked = sample(source.byKnowledge("subjective", lang), 1, used, rng)
            ?: throw IllegalStateException("题库不足：缺少“$lang”主观题")
        val label = lang.replace("程序设计-", "")
        items.add(NewItem(picked[0].id, picked[0].topic, "试题五 · 程序设计（$label）", 15.0))
        return BuiltPaper(
            title = "软件设计师 · 下午卷（应用技术）模拟",
            mode = Modes.AFTERNOON,
            durationSec = 150 * 60,
            items = items,
        )
    }

    private fun buildReal(source: QuestionSource, paperId: String): BuiltPaper {
        val rows = source.byPaper(paperId).sortedBy { it.seqNo ?: 0 }
        if (rows.isEmpty()) throw IllegalStateException("真题套“$paperId”不存在")
        if (rows.size != 75) throw IllegalStateException("真题套“$paperId”题量为 ${rows.size}，应为 75 题")
        val title = rows[0].paperTitle ?: paperId
        return BuiltPaper(
            title = title,
            mode = Modes.REAL,
            durationSec = 150 * 60,
            items = rows.map { NewItem(it.id, it.topic, "上午卷 · 单项选择题", 1.0) },
        )
    }

    /** 重做：复制原卷题目、顺序与分值。 */
    fun retake(title: String, mode: String, durationSec: Int, items: List<ExamQuestionRow>): BuiltPaper {
        if (items.isEmpty()) throw IllegalStateException("原试卷没有题目")
        return BuiltPaper(
            title = "$title（重做）",
            mode = mode,
            durationSec = durationSec,
            items = items.sortedBy { it.seq }.map { NewItem(it.question.id, it.question.topic, it.section, it.score) },
        )
    }
}
