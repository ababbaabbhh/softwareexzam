package com.softexam.ui

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.widget.LinearLayout
import android.widget.TextView

/** 统一视觉与控件构建工具（移动端深浅蓝主题）。 */
object U {
    const val PRIMARY = 0xFF1F5FA8.toInt()
    const val DARK = 0xFF16324F.toInt()
    const val BG = 0xFFF2F5F9.toInt()
    const val CARD = 0xFFFFFFFF.toInt()
    const val TEXT = 0xFF1F2A37.toInt()
    const val TEXT2 = 0xFF5B6B7C.toInt()
    const val TEXT3 = 0xFF8A99A8.toInt()
    const val LINE = 0xFFE3E9F0.toInt()
    const val ACCENT = 0xFFF08C2E.toInt()
    const val SUCCESS = 0xFF2E9E5B.toInt()
    const val DANGER = 0xFFD64545.toInt()
    const val LIGHT = 0xFFE8F0FA.toInt()
    const val GREEN_BG = 0xFFE6F6ED.toInt()
    const val RED_BG = 0xFFFDECEC.toInt()
    const val ORANGE_BG = 0xFFFDF1E3.toInt()

    fun dp(ctx: Context, v: Float): Int = (v * ctx.resources.displayMetrics.density + 0.5f).toInt()

    fun round(color: Int, radius: Float = 10f, stroke: Int? = null, strokeWidth: Float = 1f): GradientDrawable {
        val d = GradientDrawable()
        d.shape = GradientDrawable.RECTANGLE
        d.cornerRadius = radius * 3f
        d.setColor(color)
        if (stroke != null) d.setStroke(strokeWidth.toInt(), stroke)
        return d
    }

    fun text(ctx: Context, s: CharSequence, size: Float, color: Int = TEXT, bold: Boolean = false): TextView =
        TextView(ctx).apply {
            text = s
            setTextSize(TypedValue.COMPLEX_UNIT_SP, size)
            setTextColor(color)
            if (bold) setTypeface(typeface, Typeface.BOLD)
            includeFontPadding = false
        }

    fun button(ctx: Context, label: CharSequence, bg: Int = PRIMARY, fg: Int = Color.WHITE, onTap: () -> Unit): TextView =
        text(ctx, label, 15f, fg, true).apply {
            gravity = Gravity.CENTER
            setPadding(dp(ctx, 16f), dp(ctx, 10f), dp(ctx, 16f), dp(ctx, 10f))
            background = round(bg, 9f)
            isClickable = true
            setOnClickListener { onTap() }
        }

    fun ghostButton(ctx: Context, label: CharSequence, onTap: () -> Unit): TextView =
        button(ctx, label, Color.WHITE, PRIMARY, onTap).apply {
            background = round(Color.WHITE, 9f, 0xFFBCD0E6.toInt(), 1.2f)
        }

    fun card(ctx: Context, padding: Float = 16f): LinearLayout = LinearLayout(ctx).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(dp(ctx, padding), dp(ctx, padding), dp(ctx, padding), dp(ctx, padding))
        background = round(CARD, 12f, LINE, 1f)
    }

    fun section(ctx: Context, title: String): LinearLayout = LinearLayout(ctx).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        addView(text(ctx, title, 17f, DARK, true).apply { layoutParams = LinearLayout.LayoutParams(0, -2, 1f) })
        setPadding(dp(ctx, 2f), dp(ctx, 14f), dp(ctx, 2f), dp(ctx, 8f))
    }

    fun chip(ctx: Context, label: String, bg: Int = LIGHT, fg: Int = PRIMARY): TextView =
        text(ctx, label, 12f, fg).apply {
            setPadding(dp(ctx, 10f), dp(ctx, 4f), dp(ctx, 10f), dp(ctx, 4f))
            background = round(bg, 20f)
        }

    fun tag(ctx: Context, label: String, bg: Int = LIGHT, fg: Int = PRIMARY): TextView = chip(ctx, label, bg, fg)

    fun divider(ctx: Context): View = View(ctx).apply {
        setBackgroundColor(LINE)
        layoutParams = LinearLayout.LayoutParams(-1, dp(ctx, 1f)).apply { topMargin = dp(ctx, 8f); bottomMargin = dp(ctx, 8f) }
    }

    fun spacer(ctx: Context, h: Float): View = View(ctx).apply {
        layoutParams = LinearLayout.LayoutParams(-1, dp(ctx, h))
    }

    fun lp(w: Int, h: Int, weight: Float = 0f): LinearLayout.LayoutParams =
        LinearLayout.LayoutParams(w, h, weight)

    fun lpMargin(w: Int, h: Int, left: Int = 0, top: Int = 0, right: Int = 0, bottom: Int = 0): LinearLayout.LayoutParams =
        LinearLayout.LayoutParams(w, h).apply { setMargins(left, top, right, bottom) }

    fun scroll(ctx: Context, content: View): android.widget.ScrollView =
        android.widget.ScrollView(ctx).apply {
            isFillViewport = true
            addView(content)
        }
}

/** 自动换行的流式布局（用于统计胶囊、题号网格）。 */
class FlowLayout(ctx: Context) : android.view.ViewGroup(ctx) {
    init { /* 无构造参数 */ }

    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        val width = MeasureSpec.getSize(widthMeasureSpec)
        var lineWidth = 0
        var lineHeight = 0
        var totalHeight = 0
        for (i in 0 until childCount) {
            val child = getChildAt(i)
            measureChild(child, MeasureSpec.makeMeasureSpec(width, MeasureSpec.AT_MOST), MeasureSpec.makeMeasureSpec(0, MeasureSpec.UNSPECIFIED))
            val lp = child.layoutParams as MarginLayoutParams
            val cw = child.measuredWidth + lp.leftMargin + lp.rightMargin
            val ch = child.measuredHeight + lp.topMargin + lp.bottomMargin
            if (lineWidth + cw > width && lineWidth > 0) {
                totalHeight += lineHeight
                lineWidth = 0
                lineHeight = 0
            }
            lineWidth += cw
            lineHeight = maxOf(lineHeight, ch)
        }
        totalHeight += lineHeight
        setMeasuredDimension(width, totalHeight)
    }

    override fun onLayout(changed: Boolean, l: Int, t: Int, r: Int, b: Int) {
        val width = r - l
        var x = 0
        var y = 0
        var lineHeight = 0
        for (i in 0 until childCount) {
            val child = getChildAt(i)
            val lp = child.layoutParams as MarginLayoutParams
            val cw = child.measuredWidth + lp.leftMargin + lp.rightMargin
            val ch = child.measuredHeight + lp.topMargin + lp.bottomMargin
            if (x + cw > width && x > 0) {
                x = 0
                y += lineHeight
                lineHeight = 0
            }
            child.layout(x + lp.leftMargin, y + lp.topMargin, x + lp.leftMargin + child.measuredWidth, y + lp.topMargin + child.measuredHeight)
            x += cw
            lineHeight = maxOf(lineHeight, ch)
        }
    }

    override fun generateDefaultLayoutParams(): LayoutParams =
        MarginLayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT)

    override fun generateLayoutParams(p: LayoutParams): LayoutParams = MarginLayoutParams(p)
    override fun checkLayoutParams(p: LayoutParams): Boolean = p is MarginLayoutParams
}
