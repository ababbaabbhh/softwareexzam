package com.softexam.core

/** 极简 JSON 编解码：只处理字符串与字符串数组，避免引入额外依赖。 */
object MiniJson {
    fun encodeString(value: String): String {
        val sb = StringBuilder("\"")
        for (ch in value) {
            when (ch) {
                '\\' -> sb.append("\\\\")
                '"' -> sb.append("\\\"")
                '\n' -> sb.append("\\n")
                '\r' -> sb.append("\\r")
                '\t' -> sb.append("\\t")
                else -> if (ch.code < 0x20) sb.append(String.format("\\u%04x", ch.code)) else sb.append(ch)
            }
        }
        sb.append('"')
        return sb.toString()
    }

    fun encodeStrings(values: List<String>): String =
        values.joinToString(prefix = "[", postfix = "]", separator = ",") { encodeString(it) }

    fun decodeString(raw: String?): String {
        if (raw == null) return ""
        val s = raw.trim()
        if (!s.startsWith("\"")) return s
        val sb = StringBuilder()
        var i = 1
        while (i < s.length - 1) {
            val c = s[i]
            if (c == '\\' && i + 1 < s.length) {
                when (val n = s[i + 1]) {
                    'n' -> sb.append('\n')
                    'r' -> sb.append('\r')
                    't' -> sb.append('\t')
                    '"' -> sb.append('"')
                    '\\' -> sb.append('\\')
                    'u' -> {
                        if (i + 5 < s.length) {
                            sb.append(s.substring(i + 2, i + 6).toInt(16).toChar())
                            i += 6
                            continue
                        }
                        sb.append(n)
                    }
                    else -> sb.append(n)
                }
                i += 2
            } else {
                sb.append(c)
                i += 1
            }
        }
        return sb.toString()
    }

    fun decodeStrings(raw: String?): List<String> {
        if (raw == null) return emptyList()
        val s = raw.trim()
        if (!s.startsWith("[")) return listOf(decodeString(s))
        val out = ArrayList<String>()
        var i = 1
        while (i < s.length) {
            if (s[i] == '"') {
                var j = i + 1
                val sb = StringBuilder()
                while (j < s.length && s[j] != '"') {
                    if (s[j] == '\\' && j + 1 < s.length) {
                        when (val n = s[j + 1]) {
                            'n' -> sb.append('\n')
                            'r' -> sb.append('\r')
                            't' -> sb.append('\t')
                            '"' -> sb.append('"')
                            '\\' -> sb.append('\\')
                            'u' -> if (j + 5 < s.length) {
                                sb.append(s.substring(j + 2, j + 6).toInt(16).toChar()); j += 4
                            } else sb.append(n)
                            else -> sb.append(n)
                        }
                        j += 2
                    } else {
                        sb.append(s[j]); j += 1
                    }
                }
                out.add(sb.toString())
                i = j + 1
            } else {
                i += 1
            }
        }
        return out
    }
}
