// dsh-deepseek-usage-stats — browser half.
//
// Adds the sidebar panel entry (a small chart glyph) and the statistics page it
// opens in the main column: daily spend curve, daily token composition, and the
// per-month plus average figures. Numbers come from the Host route
// /api/deepseek-usage/data; the account token never reaches this module.
//
// Styling uses only `--dsw-*` theme tokens. Charts are plain SVG drawn from the
// snapshot, with a hover readout positioned inside their own frame.
window.__ModuleLoader__.load({
  id: 'dsh-tallybook',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    const React = require('react')

    const h = React.createElement
    const { useCallback, useEffect, useMemo, useRef, useState } = React

    const NS = 'deepseekUsage'
    const PANEL_ID = 'deepseek-usage'
    const ROUTE = '/api/deepseek-usage/data'

    const DAY_MS = 24 * 60 * 60 * 1000

    // ---- dictionaries ----------------------------------------------------

    const zh = {
      panel: '用量统计',
      title: 'DeepSeek 用量统计',
      intro: '按日统计有记录以来的消费与 token 构成，按平台记录的口径汇总。',
      refresh: '刷新',
      refreshing: '读取中…',
      loading: '正在读取用量…',
      retry: '重试',
      errorTitle: '读取失败',
      errorHint: '稍后重试，或确认网络可以访问 platform.deepseek.com。',
      signedOutTitle: '尚未登录 DeepSeek 账号',
      signedOutHint: '在 DSH 左下角登录 DeepSeek 账号后，这里会显示用量。',
      expiredTitle: '登录已失效',
      expiredHint: '重新登录 DeepSeek 账号后再刷新。',
      updatedAt: '更新于 {time}',
      lifetimeSpend: '累计消费',
      lifetimeHint: '自 {date} 起',
      thisMonth: '本月消费',
      thisMonthHint: '{month} 至今',
      averageMonth: '月均消费',
      averageMonthHint: '有消费的 {months} 个月',
      averageDay: '日均消费',
      averageDayHint: '有消费的 {days} 天',
      totalRequests: '累计请求',
      totalRequestsHint: '共 {tokens} token',
      chartTitle: '每日用量与消费',
      chartHint: '{from} 至 {to}，共 {days} 天',
      chartAxisHint: '左轴为 token（对数刻度）；右轴为当日消费金额，画成圆角柱，分组时同一天叠在一起。每屏显示所选天数（按月按 30 天计），可横向拖动查看更早记录。',
      rangeLabel: '每屏',
      rangeMonths: '{months} 个月',
      rangeYear: '1 年',
      groupOverview: '总览',
      groupModel: '模型',
      groupKey: 'API',
      groupAll: '全部',
      dayTokens: 'token 合计',
      cacheHit: '缓存命中',
      cacheMiss: '缓存未命中',
      output: '输出',
      monthSectionTitle: '按月统计',
      monthSectionHint: '选择任意月份，查看该月的消费与 token 明细',
      month: '月份',
      monthTrend: '趋势',
      monthCost: '消费',
      monthOverMonth: '环比',
      yearOverYear: '同比',
      monthCurveHint: '该月每日消费与 token 合计',
      groupName: '名称',
      rankShare: '占比',
      rankUnit: '每百万 token',
      hitRatio: '缓存命中率',
      rankByApi: '该月各 API 的 token 用量（从高到低）',
      rankByModel: '该月各模型的 token 用量（从高到低）',
      rankByApiYear: '该年各 API 的 token 用量（从高到低）',
      rankByModelYear: '该年各模型的 token 用量（从高到低）',
      reportLegend: '柱 = 每日消费（右轴金额） · 线 = token 合计（左轴对数）',
      day: '日期',
      copyDetails: '复制明细',
      exportDetails: '导出明细',
      exportApiReport: '导出 API 报告',
      exportModelReport: '导出模型报告',
      savedToFolder: '已保存到 {path}',
      saveFailed: '写入失败，请换一个文件夹再试',
      paletteWarning: '共 {count} 个分组，超过 {steps} 种可区分颜色；超出部分会跳着色阶分配，相邻分组仍保持明显差异。',
      copied: '已复制到剪贴板',
      copyFailed: '复制失败，请检查浏览器剪贴板权限',
      yearSectionTitle: '按年统计',
      yearSectionHint: '按年汇总全年消费与 token；与月份合起来构成完整的统计口径',
      year: '年份',
      yearCurveHint: '该年每日消费与 token 合计',
      monthAverageDay: '日均',
      monthRequests: '请求',
      monthActiveDays: '活跃天数',
      empty: '还没有任何用量记录。',
      noSpend: '该月没有消费记录',
      dayAverage: '日均 {value}',
      peakDay: '峰值日 {date}（{value}）',
      cumulatedUntil: '截至该月累计',
      cumulatedUntilHint: '含该月在内',
      unitBillion: 'B',
      unitMillion: 'M',
      unitThousand: 'K',
      numberStyle: 'en',
    }

    const en = {
      panel: 'Usage',
      title: 'DeepSeek usage',
      intro: 'Daily spend and token composition for every recorded day, summarised by month.',
      refresh: 'Refresh',
      refreshing: 'Reading…',
      loading: 'Reading usage…',
      retry: 'Retry',
      errorTitle: 'Could not read usage',
      errorHint: 'Try again shortly, and make sure platform.deepseek.com is reachable.',
      signedOutTitle: 'Not signed in to DeepSeek',
      signedOutHint: 'Sign in from the account control in the sidebar; usage appears here afterwards.',
      expiredTitle: 'Sign-in expired',
      expiredHint: 'Sign in to DeepSeek again, then refresh.',
      updatedAt: 'Updated {time}',
      lifetimeSpend: 'Lifetime spend',
      lifetimeHint: 'since {date}',
      thisMonth: 'This month',
      thisMonthHint: '{month} to date',
      averageMonth: 'Average month',
      averageMonthHint: 'across {months} months with spend',
      averageDay: 'Average day',
      averageDayHint: 'across {days} days with spend',
      totalRequests: 'Requests',
      totalRequestsHint: '{tokens} tokens total',
      chartTitle: 'Daily usage and spend',
      chartHint: '{from} to {to}, {days} days',
      chartAxisHint: 'Left axis is tokens (log scale); right axis is that day’s spend drawn as rounded bars, stacked within a day when grouped. The chosen range sets how many days fill one screen (a month counts as 30 days); drag sideways for older days.',
      rangeLabel: 'Per screen',
      rangeMonths: '{months} months',
      rangeYear: '1 year',
      groupOverview: 'All',
      groupModel: 'Model',
      groupKey: 'API',
      groupAll: 'All',
      dayTokens: 'Total tokens',
      cacheHit: 'Cache hit',
      cacheMiss: 'Cache miss',
      output: 'Output',
      monthSectionTitle: 'By month',
      monthSectionHint: 'Pick a month to see its spend and token breakdown',
      month: 'Month',
      monthTrend: 'Trend',
      monthCost: 'Spend',
      monthOverMonth: 'MoM',
      yearOverYear: 'YoY',
      monthCurveHint: 'Daily spend and token total for this month',
      groupName: 'Name',
      rankShare: 'Share',
      rankUnit: 'Per 1M tokens',
      hitRatio: 'Cache hit rate',
      rankByApi: 'Token use by API key this month, highest first',
      rankByModel: 'Token use by model this month, highest first',
      rankByApiYear: 'Token use by API key this year, highest first',
      rankByModelYear: 'Token use by model this year, highest first',
      reportLegend: 'Bars = daily spend (right axis) · Line = token total (left, log)',
      day: 'Date',
      copyDetails: 'Copy details',
      exportDetails: 'Export details',
      exportApiReport: 'Export API report',
      exportModelReport: 'Export model report',
      savedToFolder: 'Saved to {path}',
      saveFailed: 'Could not write there; try another folder',
      paletteWarning: '{count} groups exceed the {steps} distinguishable colours; the extras step through the palette so neighbours still contrast.',
      copied: 'Copied to clipboard',
      copyFailed: 'Copy failed; check clipboard permission',
      yearSectionTitle: 'By year',
      yearSectionHint: 'Yearly totals for spend and tokens; with the monthly section this covers the whole record',
      year: 'Year',
      yearCurveHint: 'Daily spend and token total for this year',
      monthAverageDay: 'Per day',
      monthRequests: 'Requests',
      monthActiveDays: 'Active days',
      empty: 'No usage has been recorded yet.',
      noSpend: 'No spend recorded this month',
      dayAverage: '{value} per day',
      peakDay: 'Peak {date} ({value})',
      cumulatedUntil: 'Cumulative through month',
      cumulatedUntilHint: 'including this month',
      unitBillion: 'B',
      unitMillion: 'M',
      unitThousand: 'K',
      numberStyle: 'en',
    }

    // Chinese unit grouping (亿/万/千) rather than the English short scale.
    const zhNumbered = { ...zh, unitBillion: '亿', unitMillion: '万', unitThousand: '千', numberStyle: 'zh' }

    const DICTS = { zh: zhNumbered, en }

    // ---- formatting ------------------------------------------------------

    /**
     * Format a money amount in the snapshot's currency.
     * @param value - amount in the currency.
     * @param currency - ISO currency code.
     * @returns the formatted amount.
     */
    function formatMoney(value, currency) {
      const amount = Number(value) || 0
      const symbol = currency === 'USD' ? '$' : currency === 'CNY' ? '¥' : `${currency} `
      return `${symbol}${amount.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    }

    /**
     * Format a token count with the active language's unit grouping.
     * @param value - token count.
     * @param units - unit labels from the dictionary.
     * @returns the formatted count.
     */
    function formatTokens(value, units) {
      const amount = Number(value) || 0
      const abs = Math.abs(amount)
      const large = units.numberStyle === 'zh' ? 1e8 : 1e9
      const medium = units.numberStyle === 'zh' ? 1e4 : 1e6
      // Whole multiples read better without the trailing ".00" on an axis label.
      const scaled = (divisor) => {
        const text = (amount / divisor).toFixed(2)
        return text.endsWith('.00') ? text.slice(0, -3) : text
      }
      if (abs >= large) return `${scaled(large)}${units.unitBillion}`
      if (abs >= medium) return `${scaled(medium)}${units.unitMillion}`
      if (abs >= 1000) return `${scaled(1000)}${units.unitThousand}`
      return String(Math.round(amount))
    }

    /**
     * Format an ISO timestamp as a local `MM-DD HH:mm` clock reading.
     * @param iso - ISO timestamp.
     * @returns the formatted time, or an empty string when absent.
     */
    function formatClock(iso) {
      if (typeof iso !== 'string') return ''
      const date = new Date(iso)
      if (Number.isNaN(date.getTime())) return ''
      const month = String(date.getMonth() + 1).padStart(2, '0')
      const day = String(date.getDate()).padStart(2, '0')
      const hour = String(date.getHours()).padStart(2, '0')
      const minute = String(date.getMinutes()).padStart(2, '0')
      return `${month}-${day} ${hour}:${minute}`
    }

    /**
     * Render `YYYY-MM-DD` as `MM-DD`.
     * @param date - the date key.
     * @returns the short date.
     */
    function shortDate(date) {
      return typeof date === 'string' && date.length === 10 ? date.slice(5) : String(date ?? '')
    }

    /**
     * The browser's own date as `YYYY-MM-DD`, used to name exported files.
     * @returns the date key.
     */
    function todayKey() {
      const now = new Date()
      const month = String(now.getMonth() + 1).padStart(2, '0')
      const day = String(now.getDate()).padStart(2, '0')
      return `${now.getFullYear()}-${month}-${day}`
    }

    // ---- shared styles ---------------------------------------------------

    const pageStyle = {
      height: '100%',
      overflowY: 'auto',
      boxSizing: 'border-box',
      padding: '28px clamp(20px, 4vw, 48px) 48px',
      color: 'var(--dsw-alias-label-primary)',
      // Reading figures never needs selection, and a stray drag otherwise paints
      // half the report blue; the copy/export buttons cover what users take away.
      userSelect: 'none',
      WebkitUserSelect: 'none',
    }
    const innerStyle = {
      display: 'flex',
      flexDirection: 'column',
      gap: 24,
      width: '100%',
      maxWidth: 960,
      margin: '0 auto',
    }
    const headerStyle = { display: 'flex', alignItems: 'flex-start', gap: 16 }
    const headTextStyle = { display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0, flex: '1 1 auto' }
    const titleStyle = {
      margin: 0,
      fontSize: 20,
      lineHeight: '28px',
      fontWeight: 600,
      color: 'var(--dsw-alias-label-primary)',
    }
    const subtitleStyle = {
      margin: 0,
      fontSize: 13,
      lineHeight: '20px',
      color: 'var(--dsw-alias-label-secondary)',
    }
    const buttonStyle = {
      flex: 'none',
      height: 30,
      padding: '0 12px',
      borderRadius: 8,
      border: '1px solid var(--dsw-alias-border-l2)',
      background: 'transparent',
      color: 'var(--dsw-alias-label-primary)',
      font: 'inherit',
      fontSize: 13,
      cursor: 'pointer',
    }
    const cardGridStyle = {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
      gap: 12,
    }
    const cardStyle = {
      display: 'flex',
      flexDirection: 'column',
      gap: 4,
      padding: '14px 16px',
      borderRadius: 12,
      border: '1px solid var(--dsw-alias-border-l2)',
      background: 'var(--dsw-alias-bg-layer-1)',
      minWidth: 0,
    }
    const cardLabelStyle = { fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-secondary)' }
    const cardValueStyle = {
      fontSize: 22,
      lineHeight: '30px',
      fontWeight: 600,
      fontVariantNumeric: 'tabular-nums',
      color: 'var(--dsw-alias-label-primary)',
    }
    const cardHintStyle = { fontSize: 11, lineHeight: '16px', color: 'var(--dsw-alias-label-tertiary)' }
    const panelStyle = {
      display: 'flex',
      flexDirection: 'column',
      gap: 12,
      padding: '16px 18px',
      borderRadius: 12,
      border: '1px solid var(--dsw-alias-border-l2)',
      background: 'var(--dsw-alias-bg-layer-1)',
    }
    const sectionTitleStyle = { display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }
    const sectionNameStyle = { fontSize: 14, lineHeight: '22px', fontWeight: 600 }
    const sectionHintStyle = { fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-tertiary)' }
    const legendStyle = { display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 12, color: 'var(--dsw-alias-label-secondary)' }
    const legendItemStyle = { display: 'inline-flex', alignItems: 'center', gap: 6 }
    const noteStyle = { fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-secondary)' }
    const statusStyle = {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'flex-start',
      gap: 6,
      padding: '24px 0',
      color: 'var(--dsw-alias-label-secondary)',
      fontSize: 13,
    }
    const statusTitleStyle = { fontSize: 14, fontWeight: 600, color: 'var(--dsw-alias-label-primary)' }

    const monthChipsStyle = { display: 'flex', gap: 8, flexWrap: 'wrap' }
    const chipBase = {
      padding: '3px 10px',
      borderRadius: 999,
      border: '1px solid var(--dsw-alias-border-l1)',
      background: 'transparent',
      color: 'var(--dsw-alias-label-secondary)',
      font: 'inherit',
      fontSize: 12,
      lineHeight: '20px',
      cursor: 'pointer',
      fontVariantNumeric: 'tabular-nums',
    }
    const tableStyle = { width: '100%', borderCollapse: 'collapse', fontSize: 12 }
    const thStyle = {
      textAlign: 'right',
      fontWeight: 500,
      color: 'var(--dsw-alias-label-tertiary)',
      padding: '6px 8px',
      borderBottom: '1px solid var(--dsw-alias-border-l2)',
      whiteSpace: 'nowrap',
    }
    const thFirstStyle = { ...thStyle, textAlign: 'left' }
    const tdStyle = {
      textAlign: 'right',
      padding: '7px 8px',
      borderBottom: '1px solid var(--dsw-alias-border-l2)',
      fontVariantNumeric: 'tabular-nums',
      whiteSpace: 'nowrap',
      color: 'var(--dsw-alias-label-primary)',
    }
    const tdFirstStyle = { ...tdStyle, textAlign: 'left' }
    const mutedCellStyle = { ...tdStyle, color: 'var(--dsw-alias-label-secondary)' }

    const chartColors = {
      spend: 'var(--dsw-static-amber-500)',
      cacheHit: 'var(--dsw-alias-chart-messages)',
      cacheMiss: 'var(--dsw-alias-chart-tools)',
      output: 'var(--dsw-alias-brand-primary)',
    }

    /** Base bar colour, matching the overview orange. */
    const BAR_BASE = '#F5A524'

    /**
     * Lighten a hex colour toward white.
     * @param hex - base colour.
     * @param ratio - 0 keeps the base colour, 1 is white.
     * @returns a CSS `rgb()` colour.
     */
    function mixWithWhite(hex, ratio) {
      const value = hex.replace('#', '')
      const channels = [0, 2, 4].map(offset => parseInt(value.slice(offset, offset + 2), 16))
      const amount = Math.min(Math.max(ratio, 0), 1)
      const mixed = channels.map(channel => Math.round(channel + (255 - channel) * amount))
      return `rgb(${mixed[0]}, ${mixed[1]}, ${mixed[2]})`
    }

    /**
     * Darken a hex colour toward black.
     * @param hex - base colour.
     * @param ratio - 0 keeps the base colour, 1 is black.
     * @returns a CSS `rgb()` colour.
     */
    function mixWithBlack(hex, ratio) {
      const value = hex.replace('#', '')
      const channels = [0, 2, 4].map(offset => parseInt(value.slice(offset, offset + 2), 16))
      const amount = Math.min(Math.max(ratio, 0), 1)
      const mixed = channels.map(channel => Math.round(channel * (1 - amount)))
      return `rgb(${mixed[0]}, ${mixed[1]}, ${mixed[2]})`
    }

    /** How many distinguishable shades the report palette offers (light + dark steps). */
    const PALETTE_STEPS = 21

    /**
     * Pick a colour for the nth group: 0–10 lighten toward white in 10% steps,
     * 11–20 darken toward black in 10% steps. Past 21 groups the colour walks the
     * palette with a stride, so neighbours stay far apart instead of all going dark.
     * @param index - zero-based group index, ordered by token use.
     * @returns a CSS `rgb()` colour.
     */
    function groupColorAt(index) {
      const slot = index < PALETTE_STEPS ? index : (index * 8) % PALETTE_STEPS
      if (slot <= 10) return mixWithWhite(BAR_BASE, slot * 0.1)
      return mixWithBlack(BAR_BASE, Math.min(slot - 10, 10) * 0.1)
    }

    // ---- exported reports -------------------------------------------------

    /** Exported report canvas width. */
    const REPORT_WIDTH = 1200
    /** Exported report page inset. */
    const REPORT_PADDING = 48
    /** One row of the per-period breakdown table. */
    const REPORT_ROW_HEIGHT = 26

    /**
     * Trace a rounded rectangle on a 2D context.
     * @param ctx - canvas context.
     * @param x - left edge.
     * @param y - top edge.
     * @param width - rectangle width.
     * @param height - rectangle height.
     * @param radius - corner radius.
     */
    function roundRect(ctx, x, y, width, height, radius) {
      const r = Math.min(radius, width / 2, height / 2)
      ctx.beginPath()
      ctx.moveTo(x + r, y)
      ctx.lineTo(x + width - r, y)
      ctx.quadraticCurveTo(x + width, y, x + width, y + r)
      ctx.lineTo(x + width, y + height - r)
      ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height)
      ctx.lineTo(x + r, y + height)
      ctx.quadraticCurveTo(x, y + height, x, y + height - r)
      ctx.lineTo(x, y + r)
      ctx.quadraticCurveTo(x, y, x + r, y)
      ctx.closePath()
    }

    /**
     * Draw one text run and report its width.
     * @param ctx - canvas context.
     * @param content - text to draw.
     * @param x - anchor x.
     * @param y - baseline y.
     * @param options - size, weight, colour, alignment.
     * @returns the measured text width.
     */
    function drawText(ctx, content, x, y, options = {}) {
      const size = options.size ?? 14
      const weight = options.weight ?? 400
      const color = options.color ?? '#1A1D23'
      const align = options.align ?? 'left'
      ctx.save()
      ctx.font = `${weight} ${size}px "Microsoft YaHei", "Segoe UI", sans-serif`
      ctx.fillStyle = color
      ctx.textAlign = align
      ctx.textBaseline = 'alphabetic'
      ctx.fillText(content, x, y)
      const width = ctx.measureText(content).width
      ctx.restore()
      return width
    }

    /**
     * Draw one period's chart: stacked spend bars on the right axis and the daily
     * token total as a line on the left (logarithmic) axis.
     * @param ctx - canvas context.
     * @param left - chart left edge.
     * @param top - chart top edge.
     * @param width - chart width.
     * @param height - chart height.
     * @param days - the period's days in order.
     * @param groupValues - each group's daily spend, aligned with `days`.
     * @param palette - each group's colour, aligned with `groupValues`.
     * @param formatMoney - money formatter.
     * @param tokenValues - the daily token total.
     * @param tokensText - token formatter.
     */
    function drawPeriodBars(ctx, left, top, width, height, days, groupValues, palette, formatMoney, tokenValues, tokensText) {
      const totals = days.map((_, index) => groupValues.reduce((sum, values) => sum + (values[index] ?? 0), 0))
      const max = Math.max(1, ...totals)
      const tokenMax = Math.max(1, ...tokenValues)
      const tokenLogMax = Math.log10(tokenMax)
      const slot = width / Math.max(days.length, 1)
      const barWidth = Math.max(Math.min(slot * 0.7, 14), 1)
      const yForToken = (value) => {
        const ratio = tokenLogMax > 0 ? Math.log10(Math.max(value, 1)) / tokenLogMax : 0
        return top + height - Math.min(Math.max(ratio, 0), 1) * height
      }

      ctx.save()
      ctx.strokeStyle = '#E5E7EB'
      ctx.lineWidth = 1
      for (let step = 0; step <= 3; step += 1) {
        const y = Math.round(top + (height * step) / 3) + 0.5
        ctx.beginPath()
        ctx.moveTo(left, y)
        ctx.lineTo(left + width, y)
        ctx.stroke()
      }
      ctx.restore()

      for (let step = 0; step <= 3; step += 1) {
        const y = top + (height * step) / 3
        drawText(ctx, tokensText(10 ** (tokenLogMax * (1 - step / 3))), left - 8, y + 4,
          { size: 10, color: '#9CA3AF', align: 'right' })
        drawText(ctx, formatMoney(max * (1 - step / 3)), left + width + 8, y + 4,
          { size: 10, color: '#6B7280', align: 'left' })
      }

      days.forEach((day, index) => {
        let cursor = top + height
        const x = left + slot * index + (slot - barWidth) / 2
        groupValues.forEach((values, groupIndex) => {
          const value = values[index] ?? 0
          if (!(value > 0)) return
          const barHeight = (value / max) * height
          ctx.fillStyle = palette[groupIndex]
          ctx.fillRect(x, cursor - barHeight, barWidth, barHeight)
          cursor -= barHeight
        })
      })

      // Same Catmull-Rom smoothing as the on-page chart, clamped to the plot so a
      // spike cannot bulge outside the frame.
      const points = tokenValues.map((value, index) => ({
        x: left + slot * index + slot / 2,
        y: Math.min(Math.max(yForToken(value), top), top + height),
      }))
      if (points.length > 0) {
        const clampY = (value) => Math.min(Math.max(value, top), top + height)
        ctx.save()
        ctx.strokeStyle = '#4C8DF0'
        ctx.lineWidth = 2
        ctx.lineJoin = 'round'
        ctx.lineCap = 'round'
        ctx.beginPath()
        ctx.moveTo(points[0].x, points[0].y)
        for (let index = 0; index < points.length - 1; index += 1) {
          const p0 = points[index - 1] ?? points[index]
          const p1 = points[index]
          const p2 = points[index + 1]
          const p3 = points[index + 2] ?? p2
          ctx.bezierCurveTo(
            p1.x + (p2.x - p0.x) / 6,
            clampY(p1.y + (p2.y - p0.y) / 6),
            p2.x - (p3.x - p1.x) / 6,
            clampY(p2.y - (p3.y - p1.y) / 6),
            p2.x,
            p2.y,
          )
        }
        ctx.stroke()
        ctx.restore()
      }

      const labelEvery = Math.max(1, Math.ceil(days.length / 8))
      const labelIndexes = []
      const lastIndex = days.length - 1
      if (days.length > 0) {
        for (let index = 0; index < days.length; index += labelEvery) labelIndexes.push(index)
        const previousIndex = labelIndexes[labelIndexes.length - 1]
        if (previousIndex !== lastIndex) {
          if ((lastIndex - previousIndex) * slot < 44) labelIndexes[labelIndexes.length - 1] = lastIndex
          else labelIndexes.push(lastIndex)
        }
      }
      for (const index of labelIndexes) {
        drawText(ctx, shortDate(days[index].date), left + slot * index + slot / 2, top + height + 16,
          { size: 11, color: '#6B7280', align: 'center' })
      }
    }
    /**
     * Lay out and draw one report: header summary plus one block per period.
     * @param options - report content, palette, and formatting helpers.
     * @returns the finished canvas.
     */
    function drawReport(options) {
      const { title, subtitle, cards, periods, palette, money, tokensText, kind, t } = options
      const padding = REPORT_PADDING
      const contentWidth = REPORT_WIDTH - padding * 2
      const chartHeight = kind === 'month' ? 150 : 190
      const blockHead = 54

      let totalHeight = 24 + 52 + 40 + 96 + 32
      for (const period of periods) {
        totalHeight += blockHead + chartHeight + 50 + 30 + period.shares.length * REPORT_ROW_HEIGHT + 26
      }
      totalHeight += 32

      const canvas = document.createElement('canvas')
      canvas.width = REPORT_WIDTH
      canvas.height = Math.ceil(totalHeight)
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = '#FFFFFF'
      ctx.fillRect(0, 0, canvas.width, canvas.height)

      let y = 24 + 34
      drawText(ctx, title, padding, y, { size: 30, weight: 600 })
      y += 30
      drawText(ctx, subtitle, padding, y, { size: 13, color: '#6B7280' })
      y += 34

      const cardWidth = (contentWidth - 18 * (cards.length - 1)) / cards.length
      cards.forEach((card, index) => {
        const x = padding + index * (cardWidth + 18)
        ctx.save()
        roundRect(ctx, x, y, cardWidth, 76, 12)
        ctx.fillStyle = '#F6F7F9'
        ctx.fill()
        ctx.strokeStyle = '#E5E7EB'
        ctx.lineWidth = 1
        ctx.stroke()
        ctx.restore()
        drawText(ctx, card.label, x + 16, y + 26, { size: 12, color: '#6B7280' })
        drawText(ctx, card.value, x + 16, y + 58, { size: 22, weight: 600 })
      })
      y += 76 + 32

      for (const period of periods) {
        drawText(ctx, period.label, padding, y + 22, { size: 20, weight: 600 })
        drawText(ctx, period.summary, REPORT_WIDTH - padding, y + 22, { size: 13, color: '#6B7280', align: 'right' })
        y += blockHead

        const days = period.days
        const groupValues = period.groupValues
        drawPeriodBars(ctx, padding + 64, y, contentWidth - 64 - 96, chartHeight, days, groupValues,
          palette.map(item => item.color), money, period.tokenValues, tokensText)
        drawText(ctx, t('reportLegend'), padding + 64, y + chartHeight + 32, { size: 10, color: '#9CA3AF' })
        y += chartHeight + 50

        drawText(ctx, t('groupName'), padding, y + 14, { size: 12, color: '#6B7280' })
        drawText(ctx, t('dayTokens'), REPORT_WIDTH - padding - 340, y + 14, { size: 12, color: '#6B7280', align: 'right' })
        drawText(ctx, t('rankShare'), REPORT_WIDTH - padding - 230, y + 14, { size: 12, color: '#6B7280', align: 'right' })
        drawText(ctx, t('hitRatio'), REPORT_WIDTH - padding - 120, y + 14, { size: 12, color: '#6B7280', align: 'right' })
        drawText(ctx, t('rankUnit'), REPORT_WIDTH - padding, y + 14, { size: 12, color: '#6B7280', align: 'right' })
        y += 30
        ctx.save()
        ctx.strokeStyle = '#E5E7EB'
        ctx.beginPath()
        ctx.moveTo(padding, y - 6)
        ctx.lineTo(REPORT_WIDTH - padding, y - 6)
        ctx.stroke()
        ctx.restore()

        period.shares.forEach((share, index) => {
          if (index > 0) {
            ctx.save()
            ctx.strokeStyle = '#F1F2F4'
            ctx.beginPath()
            ctx.moveTo(padding, y + REPORT_ROW_HEIGHT * index - 6)
            ctx.lineTo(REPORT_WIDTH - padding, y + REPORT_ROW_HEIGHT * index - 6)
            ctx.stroke()
            ctx.restore()
          }
          const rowTop = y + REPORT_ROW_HEIGHT * index
          ctx.save()
          roundRect(ctx, padding - 6, rowTop - 12, 12, 12, 3)
          ctx.fillStyle = share.color
          ctx.fill()
          ctx.restore()
          drawText(ctx, share.name, padding + 14, rowTop, { size: 13 })
          drawText(ctx, share.tokens, REPORT_WIDTH - padding - 340, rowTop, { size: 13, align: 'right' })
          drawText(ctx, share.share, REPORT_WIDTH - padding - 230, rowTop, { size: 13, align: 'right', color: '#6B7280' })
          drawText(ctx, share.hitRatio, REPORT_WIDTH - padding - 120, rowTop, { size: 13, align: 'right', color: '#6B7280' })
          drawText(ctx, share.unit, REPORT_WIDTH - padding, rowTop, { size: 13, align: 'right' })
        })
        y += period.shares.length * REPORT_ROW_HEIGHT + 26
        ctx.save()
        ctx.strokeStyle = '#E5E7EB'
        ctx.beginPath()
        ctx.moveTo(padding, y - 20)
        ctx.lineTo(REPORT_WIDTH - padding, y - 20)
        ctx.stroke()
        ctx.restore()
      }

      return canvas
    }

    /**
     * Save a canvas as a PNG download.
     * @param canvas - finished canvas.
     * @param fileName - download name.
     */
    function downloadCanvas(canvas, fileName) {
      const url = canvas.toDataURL('image/png')
      const link = document.createElement('a')
      link.href = url
      link.download = fileName
      document.body.appendChild(link)
      link.click()
      link.remove()
    }

    /**
     * Hand one report PNG to the Host, which writes it into the chosen folder.
     * @param canvas - finished canvas.
     * @param name - file name.
     * @param directory - absolute folder path, or empty for the default one.
     * @returns the saved absolute path.
     */
    async function saveReportToHost(canvas, name, directory) {
      const dataUrl = canvas.toDataURL('image/png')
      const response = await fetch('/api/deepseek-usage/save-report', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, dataUrl, directory }),
      })
      const body = await response.json().catch(() => null)
      if (body === null || body.ok !== true) {
        throw new Error(typeof body?.message === 'string' ? body.message : 'save-failed')
      }
      return body.path
    }

    /**
     * Ask the Host to open the native folder picker.
     * @returns `{ ok, path?, code? }` as reported by the Host.
     */
    async function pickReportFolder() {
      const response = await fetch('/api/deepseek-usage/pick-folder', { method: 'POST' })
      return (await response.json().catch(() => null)) ?? { ok: false, code: 'unavailable' }
    }
    // ---- chart -----------------------------------------------------------

    /** Plot insets: the left axis width and the vertical head/foot room. */
    const PAD = { top: 14, right: 14, bottom: 24, left: 58 }
    /** Width reserved at the right edge for the second axis's labels. */
    const RIGHT_AXIS_WIDTH = 52
    /** Days shown per screen for each range option (30 days per month, a year as 360). */
    const RANGE_DAYS = { 2: 60, 3: 90, 6: 180, 12: 360 }

    /**
     * Measure an element's content width.
     * @returns the ref to attach and the measured width.
     */
    function useElementWidth() {
      const ref = useRef(null)
      const [width, setWidth] = useState(0)
      useEffect(() => {
        const element = ref.current
        if (element === null) return undefined
        setWidth(element.clientWidth)
        const observer = new ResizeObserver((entries) => {
          const entry = entries[0]
          if (entry !== undefined) setWidth(Math.round(entry.contentRect.width))
        })
        observer.observe(element)
        return () => { observer.disconnect() }
      }, [])
      return [ref, width]
    }

    /**
     * Build a smooth cubic path through pixel points, clamped inside the plot.
     * A Catmull-Rom segment per pair keeps the curve from overshooting the frame.
     * @param points - ordered `[x, y]` pairs.
     * @param top - highest y the curve may reach.
     * @param bottom - lowest y the curve may reach.
     * @returns SVG path data beginning with a move command.
     */
    function smoothPath(points, top, bottom) {
      if (points.length === 0) return ''
      const first = points[0]
      if (points.length === 1) return `M ${first[0].toFixed(1)} ${first[1].toFixed(1)}`
      const clampY = (value) => Math.min(Math.max(value, top), bottom)
      let path = `M ${first[0].toFixed(1)} ${first[1].toFixed(1)}`
      for (let index = 0; index < points.length - 1; index += 1) {
        const p0 = points[index - 1] ?? points[index]
        const p1 = points[index]
        const p2 = points[index + 1]
        const p3 = points[index + 2] ?? p2
        const c1x = p1[0] + (p2[0] - p0[0]) / 6
        const c1y = clampY(p1[1] + (p2[1] - p0[1]) / 6)
        const c2x = p2[0] - (p3[0] - p1[0]) / 6
        const c2y = clampY(p2[1] - (p3[1] - p1[1]) / 6)
        path += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`
      }
      return path
    }

    /**
     * The same curve without its initial move command, for appending to an area path.
     * @param path - a path returned by {@link smoothPath}.
     * @returns the segment data starting with a space, or an empty string.
     */
    function pathSegments(path) {
      const index = path.indexOf('C')
      return index < 0 ? '' : ` ${path.slice(index)}`
    }

    /**
     * Draw a multi-series line chart with two value axes and a hover readout.
     * Each series names its axis (`left`/`right`, default `left`), that axis's
     * scale, and its own formatter. The plot keeps a fixed number of days per
     * screen and scrolls horizontally for the rest.
     * @param props - dates, series, height, and days per screen.
     * @returns the chart frame.
     */
    function LineChart({ dates, series, height = 210, windowDays = 60 }) {
      const [frameRef, width] = useElementWidth()
      const [hoverIndex, setHoverIndex] = useState(null)
      const [scrollLeft, setScrollLeft] = useState(0)
      const scrollRef = useRef(null)
      const chartWidth = Math.max(width, 260)
      const leftItems = series.filter(item => (item.axis ?? 'left') === 'left')
      const rightItems = series.filter(item => item.axis === 'right')
      const hasRight = rightItems.length > 0
      const viewWidth = Math.max(chartWidth - PAD.left - (hasRight ? RIGHT_AXIS_WIDTH : 0), 120)
      const innerHeight = Math.max(height - PAD.top - PAD.bottom, 10)
      const count = dates.length

      // Start at the newest day: a whose-range window is read from its right edge,
      // and a range shorter than the window simply fills the whole width.
      useEffect(() => {
        const element = scrollRef.current
        if (element === null) return
        const target = Math.max(element.scrollWidth - element.clientWidth, 0)
        element.scrollLeft = target
        setScrollLeft(target)
      }, [count, windowDays, viewWidth])

      const axisMax = (items) => {
        let max = 0
        for (const item of items) {
          for (const value of item.values) if (value > max) max = value
        }
        return max > 0 ? max : 1
      }
      // One scale per axis; a mixed scale on one axis would need two tick sets.
      const leftScale = leftItems[0]?.scale ?? 'linear'
      const rightScale = rightItems[0]?.scale ?? 'linear'
      const leftMax = axisMax(leftItems)
      // Stacked bars must fit their daily sum, not their tallest group.
      const stackedMax = (() => {
        const stacked = rightItems.filter(item => item.type === 'bar')
        if (stacked.length === 0) return 0
        let max = 0
        for (let index = 0; index < dates.length; index += 1) {
          let sum = 0
          for (const item of stacked) sum += Math.max(item.values[index] ?? 0, 0)
          if (sum > max) max = sum
        }
        return max
      })()
      const rightMax = Math.max(axisMax(rightItems), stackedMax)
      const leftLogMax = Math.log10(Math.max(leftMax, 1))
      const rightLogMax = Math.log10(Math.max(rightMax, 1))

      /**
       * Height fraction (0 = bottom, 1 = top) of one value on one axis.
       * @param axis - `left` or `right`.
       * @param value - the plotted value.
       * @returns the fraction, clamped into the plot.
       */
      const ratioOf = (axis, value) => {
        const onRight = axis === 'right'
        const scale = onRight ? rightScale : leftScale
        const max = onRight ? rightMax : leftMax
        const logMax = onRight ? rightLogMax : leftLogMax
        const ratio = scale === 'log'
          ? (logMax <= 0 ? 0 : Math.log10(Math.max(value, 1)) / logMax)
          : Math.max(value, 0) / max
        return Number.isFinite(ratio) ? Math.min(Math.max(ratio, 0), 1) : 0
      }
      const valueAt = (axis, fraction) => {
        const onRight = axis === 'right'
        const scale = onRight ? rightScale : leftScale
        const max = onRight ? rightMax : leftMax
        const logMax = onRight ? rightLogMax : leftLogMax
        return scale === 'log' ? 10 ** (logMax * fraction) : max * fraction
      }
      const yOf = (fraction) => PAD.top + innerHeight - fraction * innerHeight

      const daysOnScreen = windowDays > 0 ? Math.min(windowDays, Math.max(count, 1)) : Math.max(count, 1)
      const dayWidth = viewWidth / daysOnScreen
      const plotWidth = Math.max(dayWidth * Math.max(count, 1), 10)
      const xAt = (index) => (index + 0.5) * dayWidth
      const baseline = PAD.top + innerHeight

      const leftFormat = leftItems[0]?.format ?? (value => String(value))
      const rightFormat = rightItems[0]?.format ?? (value => String(value))

      const gridLines = []
      const leftTicks = []
      const rightTicks = []
      for (let row = 0; row <= 4; row += 1) {
        const y = PAD.top + (innerHeight * row) / 4
        gridLines.push(h('line', {
          key: `grid-${row}`,
          x1: 0,
          x2: plotWidth,
          y1: y,
          y2: y,
          stroke: 'var(--dsw-alias-border-l2)',
          strokeWidth: 1,
        }))
        if (leftItems.length > 0) {
          leftTicks.push(h('text', {
            key: `left-${row}`,
            x: PAD.left - 8,
            y: y + 4,
            textAnchor: 'end',
            fontSize: 10,
            fill: 'var(--dsw-alias-label-primary)',
          }, leftFormat(valueAt('left', 1 - row / 4))))
        }
        if (hasRight) {
          rightTicks.push(h('text', {
            key: `right-${row}`,
            x: 8,
            y: y + 4,
            fontSize: 10,
            fill: 'var(--dsw-alias-label-primary)',
          }, rightFormat(valueAt('right', 1 - row / 4))))
        }
      }

      const labelEvery = Math.max(1, dayWidth >= 9 ? 7 : Math.ceil(64 / Math.max(dayWidth, 1)))
      // Ticks every `labelEvery` days, and the last day always gets one; when it
      // would crowd the previous tick that tick moves to the last day instead.
      const labelIndexes = []
      const lastIndex = count - 1
      if (count > 0) {
        for (let index = 0; index < count; index += labelEvery) labelIndexes.push(index)
        if (labelIndexes[labelIndexes.length - 1] !== lastIndex) {
          const previousIndex = labelIndexes[labelIndexes.length - 1]
          if ((lastIndex - previousIndex) * dayWidth < 44) labelIndexes[labelIndexes.length - 1] = lastIndex
          else labelIndexes.push(lastIndex)
        }
      }
      const xLabels = labelIndexes.map(index => h('text', {
        key: `x-${index}`,
        x: xAt(index),
        y: PAD.top + innerHeight + 16,
        textAnchor: index === 0 ? 'start' : index === lastIndex ? 'end' : 'middle',
        fontSize: 10,
        fill: 'var(--dsw-alias-label-primary)',
      }, shortDate(dates[index])))

      // Bars carry the money: one rounded column per day. Groups stack inside the
      // same column, so the day's total height never shrinks when it is split.
      const bars = []
      const barItems = series.filter(item => item.type === 'bar' && item.hidden !== true)
      if (barItems.length > 0) {
        const barSlot = Math.max(dayWidth * 0.72, 1)
        for (let index = 0; index < count; index += 1) {
          let cursor = baseline
          for (const item of barItems) {
            const value = item.values[index] ?? 0
            if (!(value > 0)) continue
            const height = Math.max(ratioOf(item.axis ?? 'right', value) * innerHeight, 0.5)
            bars.push(h('rect', {
              key: `bar-${item.key}-${index}`,
              x: (xAt(index) - barSlot / 2).toFixed(1),
              y: (cursor - height).toFixed(1),
              width: barSlot.toFixed(1),
              height: height.toFixed(1),
              rx: Math.min(barSlot * 0.3, 2).toFixed(1),
              fill: item.color,
            }))
            cursor -= height
          }
        }
      }

      const paths = []
      for (const item of series) {
        if (item.hidden === true || item.type === 'bar') continue
        const axis = item.axis ?? 'left'
        const coords = item.values.map((value, index) => [xAt(index), yOf(ratioOf(axis, value))])
        const line = smoothPath(coords, PAD.top, baseline)
        if (item.area === true) {
          const areaPath = `M ${coords[0][0].toFixed(1)} ${baseline} L ${coords[0][0].toFixed(1)} ${coords[0][1].toFixed(1)}${pathSegments(line)} L ${coords[coords.length - 1][0].toFixed(1)} ${baseline} Z`
          paths.push(h('path', {
            key: `area-${item.key}`,
            d: areaPath,
            fill: item.color,
            fillOpacity: 0.1,
            stroke: 'none',
          }))
        }
        paths.push(h('path', {
          key: `line-${item.key}`,
          d: line,
          fill: 'none',
          stroke: item.color,
          strokeWidth: item.width ?? 1.6,
          strokeDasharray: item.dash,
          strokeOpacity: item.opacity ?? 1,
          strokeLinejoin: 'round',
          strokeLinecap: 'round',
        }))
      }

      const hovered = hoverIndex !== null && hoverIndex >= 0 && hoverIndex < count ? hoverIndex : null
      const hoverArtifacts = []
      if (hovered !== null) {
        hoverArtifacts.push(h('line', {
          key: 'hover-line',
          x1: xAt(hovered),
          x2: xAt(hovered),
          y1: PAD.top,
          y2: baseline,
          stroke: 'var(--dsw-alias-border-l3)',
          strokeWidth: 1,
        }))
        for (const item of series) {
          if (item.hidden === true || item.type === 'bar') continue
          hoverArtifacts.push(h('circle', {
            key: `hover-dot-${item.key}`,
            cx: xAt(hovered),
            cy: yOf(ratioOf(item.axis ?? 'left', item.values[hovered])),
            r: 3,
            fill: item.color,
          }))
        }
      }

      const readoutStyle = {
        position: 'absolute',
        top: 0,
        pointerEvents: 'none',
        padding: '6px 8px',
        borderRadius: 8,
        border: '1px solid var(--dsw-alias-border-l2)',
        background: 'var(--dsw-alias-bg-layer-2)',
        boxShadow: 'var(--dsw-shadow-lv2)',
        fontSize: 11,
        lineHeight: '16px',
        color: 'var(--dsw-alias-label-primary)',
        whiteSpace: 'nowrap',
        transform: 'translateX(-50%)',
      }
      const scrolling = plotWidth > viewWidth + 0.5
      const readoutLeft = hovered === null
        ? 0
        : Math.min(
          Math.max(PAD.left + xAt(hovered) - scrollLeft, PAD.left + 70),
          PAD.left + viewWidth - 70,
        )

      return h('div', {
        ref: frameRef,
        style: { position: 'relative', width: '100%', height: height + 14 },
      }, [
        h('svg', {
          key: 'axis',
          width: PAD.left,
          height,
          'aria-hidden': true,
          style: { position: 'absolute', left: 0, top: 0, display: 'block', pointerEvents: 'none' },
        }, leftTicks),
        h('div', {
          key: 'scroll',
          ref: scrollRef,
          style: {
            position: 'absolute',
            left: PAD.left,
            right: hasRight ? RIGHT_AXIS_WIDTH : 0,
            top: 0,
            height: height + 14,
            overflowX: scrolling ? 'auto' : 'hidden',
            overflowY: 'hidden',
          },
          onScroll: (event) => { setScrollLeft(event.currentTarget.scrollLeft) },
        }, h('svg', {
          width: plotWidth + 8,
          height,
          role: 'img',
          'aria-label': dates.length > 0 ? `${dates[0]} — ${dates[dates.length - 1]}` : '',
          style: { display: 'block' },
          onPointerMove: (event) => {
            const rect = event.currentTarget.getBoundingClientRect()
            const index = Math.floor((event.clientX - rect.left) / Math.max(dayWidth, 0.001))
            setHoverIndex(index >= 0 && index < count ? index : null)
          },
          onPointerLeave: () => { setHoverIndex(null) },
        }, [...gridLines, ...xLabels, ...bars, ...paths, ...hoverArtifacts])),
        hasRight ? h('svg', {
          key: 'axis-right',
          width: RIGHT_AXIS_WIDTH,
          height,
          'aria-hidden': true,
          style: { position: 'absolute', right: 0, top: 0, display: 'block', pointerEvents: 'none' },
        }, rightTicks) : null,
        hovered === null ? null : h('div', {
          key: 'readout',
          style: { ...readoutStyle, left: readoutLeft },
        }, [
          h('div', { key: 'date', style: { color: 'var(--dsw-alias-label-secondary)' } }, dates[hovered]),
          ...series.map(item => h('div', {
            key: `readout-${item.key}`,
            style: { color: 'var(--dsw-alias-label-primary)' },
          }, `${item.label} ${item.format(item.values[hovered])}`)),
        ]),
      ])
    }
    // ---- page ------------------------------------------------------------

    /**
     * A small select control: a capsule button that opens its option list.
     * @param props - optional label, current value, options, and change handler.
     * @returns the control.
     */
    function Dropdown({ label, value, options, onChange }) {
      const [open, setOpen] = useState(false)
      const current = options.find(option => option.value === value) ?? options[0]
      return h('div', { style: { position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 6 } }, [
        label === undefined ? null : h('span', { key: 'label', style: sectionHintStyle }, label),
        h('button', {
          key: 'button',
          type: 'button',
          'aria-haspopup': 'listbox',
          'aria-expanded': open,
          style: { ...chipBase, display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 92 },
          onPointerDown: (event) => { event.preventDefault() },
          onClick: (event) => {
            event.currentTarget.blur()
            setOpen(!open)
          },
        }, [
          h('span', { key: 'text' }, current === undefined ? '' : current.label),
          h('span', { key: 'caret', style: { opacity: 0.6 } }, '▾'),
        ]),
        open ? h('div', {
          key: 'list',
          role: 'listbox',
          style: {
            position: 'absolute',
            top: 'calc(100% + 4px)',
            right: 0,
            zIndex: 30,
            minWidth: 150,
            padding: 4,
            borderRadius: 10,
            border: '1px solid var(--dsw-alias-border-l2)',
            background: 'var(--dsw-alias-bg-layer-2)',
            boxShadow: 'var(--dsw-shadow-lv2)',
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
          },
        }, options.map(option => h('button', {
          key: option.value,
          type: 'button',
          role: 'option',
          'aria-selected': option.value === value,
          style: {
            ...chipBase,
            border: 'none',
            textAlign: 'left',
            whiteSpace: 'nowrap',
            background: option.value === value ? 'var(--dsw-alias-interactive-bg-hover)' : 'transparent',
            color: option.value === value ? 'var(--dsw-alias-label-primary)' : 'var(--dsw-alias-label-secondary)',
          },
          onClick: () => {
            onChange(option.value)
            setOpen(false)
          },
        }, option.label))) : null,
      ])
    }

    /**
     * The group picker shared by the daily chart, the monthly section, and the
     * yearly section: a segmented control plus the group dropdown. All three
     * instances read and write the same state, so they stay in step.
     * @param props - translator, current state, group data, and change handlers.
     * @returns the picker row.
     */
    function DimensionPicker({
      t, dimension, groupSelection, groupList, groupOptions, hasModels, hasKeys,
      onDimension, onGroupSelection,
    }) {
      const unavailableOf = (value) => (value === 'model' ? !hasModels : value === 'key' ? !hasKeys : false)
      const showDropdown = dimension !== 'overview' && groupList.length > 0
      return h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', width: '100%' } }, [
        h('div', { key: 'dimension', style: {
          display: 'inline-flex',
          gap: 2,
          padding: 2,
          borderRadius: 999,
          border: '1px solid var(--dsw-alias-border-l1)',
        } }, ['overview', 'model', 'key'].map(value => {
          const unavailable = unavailableOf(value)
          return h('button', {
            key: value,
            type: 'button',
            'aria-pressed': dimension === value,
            disabled: unavailable,
            style: {
              ...chipBase,
              border: 'none',
              opacity: unavailable ? 0.4 : 1,
              background: dimension === value ? 'var(--dsw-alias-interactive-bg-hover)' : 'transparent',
              color: dimension === value ? 'var(--dsw-alias-label-primary)' : 'var(--dsw-alias-label-secondary)',
            },
            onPointerDown: (event) => { event.preventDefault() },
            onClick: (event) => {
              if (event.detail > 0) event.currentTarget.blur()
              if (unavailable) return
              onDimension(value)
            },
          }, t(value === 'overview' ? 'groupOverview' : value === 'model' ? 'groupModel' : 'groupKey'))
        })),
        showDropdown ? h('div', { key: 'spacer', style: { marginLeft: 'auto' } }) : null,
        showDropdown ? h(Dropdown, {
          key: 'group',
          value: groupSelection,
          options: groupOptions,
          onChange: onGroupSelection,
        }) : null,
      ])
    }

    /**
     * One labelled figure.
     * @param props - label, value, and optional hint.
     * @returns the card element.
     */
    function StatCard({ label, value, hint }) {
      return h('div', { style: cardStyle }, [
        h('span', { key: 'label', style: cardLabelStyle }, label),
        h('span', { key: 'value', style: cardValueStyle }, value),
        hint === undefined ? null : h('span', { key: 'hint', style: cardHintStyle }, hint),
      ])
    }

    /**
     * The statistics page registered into the `main` slot.
     * @param props - the injected translator.
     * @returns the page element.
     */
    function UsagePage(props) {
      const t = typeof props.t === 'function' ? props.t : (key) => key
      const units = DICTS[t('numberStyle') === 'zh' ? 'zh' : 'en']
      const [state, setState] = useState({ phase: 'loading', data: null, code: null, message: null })
      const [selectedKey, setSelectedKey] = useState(null)
      const [selectedYearKey, setSelectedYearKey] = useState(null)
      const [rangeMonths, setRangeMonths] = useState(2)
      const [dimension, setDimension] = useState('overview')
      const [groupSelection, setGroupSelection] = useState('all')
      const [notice, setNotice] = useState(null)
      // One screen holds this many days for each range: 30 per month, a year as 360.
      // The data itself is never cut — scrolling still reaches older days.
      const windowDays = RANGE_DAYS[rangeMonths] ?? 90

      useEffect(() => {
        if (notice === null) return undefined
        const timer = setTimeout(() => { setNotice(null) }, 2500)
        return () => { clearTimeout(timer) }
      }, [notice])

      const load = useCallback(async (refresh) => {
        setState(previous => ({ ...previous, phase: 'loading' }))
        try {
          const response = await fetch(refresh ? `${ROUTE}?refresh=1` : ROUTE, { cache: 'no-store' })
          const body = await response.json()
          if (body && body.ok === true) {
            setState({ phase: 'ready', data: body, code: null, message: null })
            setSelectedKey(previous => previous !== null && body.months.some(month => month.key === previous)
              ? previous
              : body.months.length > 0 ? body.months[body.months.length - 1].key : null)
          } else {
            setState({ phase: 'blocked', data: null, code: body?.code ?? 'unknown', message: body?.message ?? null })
          }
        } catch (error) {
          setState({ phase: 'error', data: null, code: 'network', message: String(error?.message ?? error) })
        }
      }, [])

      useEffect(() => { void load(false) }, [load])

      if (state.phase === 'loading' && state.data === null) {
        return h('div', { style: pageStyle }, h('div', { style: innerStyle },
          h('div', { style: statusStyle }, t('loading'))))
      }

      if (state.phase === 'blocked' || state.phase === 'error') {
        const signedOut = state.code === 'signed-out'
        const expired = state.code === 'session-expired'
        const heading = signedOut ? t('signedOutTitle') : expired ? t('expiredTitle') : t('errorTitle')
        const hint = signedOut ? t('signedOutHint') : expired ? t('expiredHint') : t('errorHint')
        return h('div', { style: pageStyle }, h('div', { style: innerStyle }, [
          h('div', { key: 'status', style: statusStyle }, [
            h('span', { key: 'title', style: statusTitleStyle }, heading),
            h('span', { key: 'hint' }, hint),
            state.message === null ? null : h('span', { key: 'message', style: noteStyle }, state.message),
            h('button', {
              key: 'retry',
              type: 'button',
              style: buttonStyle,
              onClick: () => { void load(true) },
            }, t('retry')),
          ]),
        ]))
      }

      const data = state.data
      if (data === null) {
        return h('div', { style: pageStyle }, h('div', { style: innerStyle }, h('div', { style: statusStyle }, t('empty'))))
      }

      const currency = data.currency
      const money = (value) => formatMoney(value, currency)
      const tokens = (value) => formatTokens(value, units)
      const months = data.months
      // History starts at the first month that spent money; a walk that ends on
      // empty months may have started before it.
      const firstSpent = months.findIndex(month => month.cost > 0)
      const historyStart = firstSpent >= 0 ? `${months[firstSpent].key}-01` : null
      const seriesDays = historyStart === null ? data.daily : data.daily.filter(day => day.date >= historyStart)
      const totalRequests = seriesDays.reduce((sum, day) => sum + day.requests, 0)
      const totalTokens = seriesDays.reduce((sum, day) => sum + day.cacheHit + day.cacheMiss + day.response, 0)

      // One chart carries everything: the left axis holds the token curves on a
      // log scale (their magnitudes differ by orders), the right axis the daily
      // spend. Comparing a day's spend with the same day's tokens is the point.
      const detailHeader = [t('day'), t('monthCost'), t('dayTokens'), t('cacheHit'), t('cacheMiss'), t('output'), t('monthRequests')]
      const detailRowsOf = (days) => days.map(day => [
        day.date,
        day.cost.toFixed(4),
        String(day.cacheHit + day.cacheMiss + day.response),
        String(day.cacheHit),
        String(day.cacheMiss),
        String(day.response),
        String(day.requests),
      ])

      /** Copy every recorded day as tab-separated text, ready to paste into a sheet. */
      const copyDetails = async () => {
        const text = [detailHeader, ...detailRowsOf(seriesDays)].map(row => row.join('\t')).join('\n')
        try {
          await navigator.clipboard.writeText(text)
          setNotice(t('copied'))
        } catch {
          setNotice(t('copyFailed'))
        }
      }

      /** Download every recorded day as a CSV file (BOM keeps Excel's encoding right). */
      const exportDetails = () => {
        const quote = (cell) => `"${String(cell).replace(/"/g, '""')}"`
        const csv = [detailHeader, ...detailRowsOf(seriesDays)]
          .map(row => row.map(quote).join(','))
          .join('\r\n')
        const blob = new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' })
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.download = `deepseek-usage-${todayKey()}.csv`
        document.body.appendChild(link)
        link.click()
        link.remove()
        setTimeout(() => { URL.revokeObjectURL(url) }, 1000)
      }

      /**
       * Assemble the period payloads for one grouping mode: the same groups keep
       * one colour across the monthly and the yearly sheet.
       * @param mode - `api` or `model`.
       * @returns groups, palette, and both period sets.
       */
      const buildReportPayload = (mode) => {
        const source = mode === 'api' ? (data.groups?.keys ?? []) : (data.groups?.models ?? [])
        const groups = source.map(group => ({
          name: group.name,
          daily: group.daily,
          totalTokens: group.daily.reduce((sum, day) => sum + day.cacheHit + day.cacheMiss + day.response, 0),
        })).filter(group => group.totalTokens > 0).sort((left, right) => right.totalTokens - left.totalTokens)
        const palette = groups.map((group, index) => ({ name: group.name, color: groupColorAt(index) }))

        const buildPeriod = (label, days, tokensTotal, costTotal) => {
          const groupValues = groups.map(group => {
            const byDate = new Map(group.daily.map(day => [day.date, day.cost]))
            return days.map(day => byDate.get(day.date) ?? 0)
          })
          const shares = groups.map((group, index) => {
            const byDate = new Map(group.daily.map(day => [day.date, day]))
            let tokensSum = 0
            let costSum = 0
            let hitSum = 0
            for (const day of days) {
              const hit = byDate.get(day.date)
              if (hit === undefined) continue
              tokensSum += hit.cacheHit + hit.cacheMiss + hit.response
              hitSum += hit.cacheHit
              costSum += hit.cost
            }
            return {
              name: group.name,
              color: palette[index].color,
              tokenCount: tokensSum,
              tokens: tokens(tokensSum),
              share: tokensTotal > 0 ? `${((tokensSum / tokensTotal) * 100).toFixed(1)}%` : '—',
              hitRatio: tokensSum > 0 ? `${((hitSum / tokensSum) * 100).toFixed(1)}%` : '—',
              unit: tokensSum > 0 ? `${money((costSum / tokensSum) * 1e6)}/M` : '—',
            }
          }).filter(item => item.tokenCount > 0)
          const summary = `${t('monthCost')} ${money(costTotal)} · ${t('dayTokens')} ${tokens(tokensTotal)}`
          return {
            label,
            days,
            groupValues,
            tokenValues: days.map(day => day.cacheHit + day.cacheMiss + day.response),
            shares,
            summary,
          }
        }

        const monthlyPeriods = (data.months ?? [])
          .map(month => buildPeriod(
            month.key,
            data.daily.filter(day => day.date.startsWith(`${month.key}-`)),
            month.cacheHit + month.cacheMiss + month.response,
            month.cost,
          ))
          .filter(period => period.days.length > 0)

        const yearMap = new Map()
        for (const day of data.daily) {
          const key = day.date.slice(0, 4)
          const entry = yearMap.get(key) ?? { days: [], tokens: 0, cost: 0 }
          entry.days.push(day)
          entry.tokens += day.cacheHit + day.cacheMiss + day.response
          entry.cost += day.cost
          yearMap.set(key, entry)
        }
        const yearlyPeriods = [...yearMap.entries()]
          .sort((left, right) => left[0].localeCompare(right[0]))
          .map(([key, entry]) => buildPeriod(key, entry.days, entry.tokens, entry.cost))

        const totalTokens = groups.reduce((sum, group) => sum + group.totalTokens, 0)
        const cards = [
          { label: t('lifetimeSpend'), value: money(data.lifetimeSpend) },
          { label: t('dayTokens'), value: tokens(totalTokens) },
          { label: t('monthSectionTitle'), value: String(monthlyPeriods.length) },
          { label: t('averageDay'), value: money(data.activeDays > 0 ? data.lifetimeSpend / data.activeDays : 0) },
        ]
        return { groups, palette, monthlyPeriods, yearlyPeriods, cards }
      }

      /**
       * Render the two PNG sheets (monthly and yearly) for one grouping mode.
       * @param mode - `api` or `model`.
       */
      const exportReport = async (mode) => {
        const payload = buildReportPayload(mode)
        if (payload.groups.length === 0) {
          setNotice(t('empty'))
          return
        }
        if (payload.groups.length > PALETTE_STEPS) {
          window.alert(t('paletteWarning', { count: payload.groups.length, steps: PALETTE_STEPS }))
        }
        const modeLabel = mode === 'api' ? t('groupKey') : t('groupModel')
        const base = {
          title: `${t('title')} · ${modeLabel}`,
          subtitle: `${chartFrom} — ${chartTo} · ${formatClock(data.generatedAt)}`,
          cards: payload.cards,
          palette: payload.palette,
          money: value => money(value),
          tokensText: value => tokens(value),
          t,
        }
        const monthly = drawReport({ ...base, periods: payload.monthlyPeriods, kind: 'month' })
        const yearly = drawReport({ ...base, periods: payload.yearlyPeriods, kind: 'year' })
        const monthlyName = `tallybook-${mode}-monthly-${todayKey()}.png`
        const yearlyName = `tallybook-${mode}-yearly-${todayKey()}.png`

        // Ask the Host for a folder first: the native picker lives there, and the
        // browser half has no folder access in this shell.
        let directory = ''
        const picked = await pickReportFolder().catch(() => ({ ok: false, code: 'unavailable' }))
        if (picked.ok === true && typeof picked.path === 'string') {
          directory = picked.path
        } else if (picked.code === 'canceled') {
          return
        }
        try {
          const first = await saveReportToHost(monthly, monthlyName, directory)
          await saveReportToHost(yearly, yearlyName, directory)
          const folder = typeof first === 'string' ? first.replace(/[\\/][^\\/]+$/, '') : ''
          setNotice(t('savedToFolder', { path: folder }))
        } catch {
          setNotice(t('saveFailed'))
        }
      }
      // Grouped spend lines: the console's per-key endpoint carries both the key
      // identity and the model, so one dataset serves either dimension.
      const groupList = dimension === 'model'
        ? (data.groups?.models ?? [])
        : dimension === 'key'
          ? (data.groups?.keys ?? [])
          : []
      const groupKeyOf = (group) => (dimension === 'key' ? group.trackingId : group.name)
      const selectedGroup = groupSelection === 'all'
        ? null
        : (groupList.find(group => groupKeyOf(group) === groupSelection) ?? null)
      const groupOptions = [{ value: 'all', label: t('groupAll') },
        ...groupList.map(group => ({ value: groupKeyOf(group), label: group.name }))]

      // A picked model or key narrows the whole chart, tokens included, and the
      // axis keeps only the days that group actually used: idle days are dropped
      // instead of being padded to fill the selected range. A single used day gets
      // one empty neighbour on each side so the point is not drawn against an edge.
      const usedDay = (day) => day.cost > 0
        || day.requests > 0
        || (day.cacheHit + day.cacheMiss + day.response) > 0
      const padSingleDay = (days) => {
        if (days.length !== 1) return days
        const only = days[0]
        const center = new Date(`${only.date}T00:00:00Z`).getTime()
        const emptyDay = (timestamp) => ({
          date: new Date(timestamp).toISOString().slice(0, 10),
          cost: 0, cacheHit: 0, cacheMiss: 0, response: 0, requests: 0,
        })
        return [emptyDay(center - 86400000), only, emptyDay(center + 86400000)]
      }
      const chartDays = selectedGroup === null
        ? seriesDays
        : padSingleDay(selectedGroup.daily.filter(usedDay).map(day => ({ ...day })))
      const chartFrom = chartDays.length > 0 ? chartDays[0].date : '—'
      const chartTo = chartDays.length > 0 ? chartDays[chartDays.length - 1].date : '—'
      const tokenTotals = chartDays.map(day => day.cacheHit + day.cacheMiss + day.response)

      // The monthly and yearly sections follow the same filter: a picked group
      // reports its own months and years instead of the account-wide ones.
      const sourceDays = selectedGroup === null ? data.daily : selectedGroup.daily.filter(usedDay)
      const aggregateMonthly = (days) => {
        const byKey = new Map()
        for (const day of days) {
          const key = day.date.slice(0, 7)
          let entry = byKey.get(key)
          if (entry === undefined) {
            entry = {
              key,
              year: Number(key.slice(0, 4)),
              month: Number(key.slice(5, 7)),
              cost: 0, cacheHit: 0, cacheMiss: 0, response: 0, requests: 0, activeDays: 0,
            }
            byKey.set(key, entry)
          }
          entry.cost += day.cost
          entry.cacheHit += day.cacheHit
          entry.cacheMiss += day.cacheMiss
          entry.response += day.response
          entry.requests += day.requests
          if (day.cost > 0) entry.activeDays += 1
        }
        return [...byKey.values()].sort((left, right) => left.key.localeCompare(right.key))
      }
      const aggregateYearly = (days) => {
        const byYear = new Map()
        for (const day of days) {
          const year = day.date.slice(0, 4)
          let entry = byYear.get(year)
          if (entry === undefined) {
            entry = { year, cost: 0, cacheHit: 0, cacheMiss: 0, response: 0, requests: 0, activeDays: 0 }
            byYear.set(year, entry)
          }
          entry.cost += day.cost
          entry.cacheHit += day.cacheHit
          entry.cacheMiss += day.cacheMiss
          entry.response += day.response
          entry.requests += day.requests
          if (day.cost > 0) entry.activeDays += 1
        }
        return [...byYear.values()].sort((left, right) => left.year.localeCompare(right.year))
      }
      const displayMonths = selectedGroup === null ? months : aggregateMonthly(sourceDays)
      const yearly = aggregateYearly(sourceDays)
      // Bar series for the month and year detail charts: the same group split and
      // light-to-dark ramp as the main chart, so the colours always mean the same.
      const barsFor = (days) => {
        if (dimension === 'overview' || groupList.length === 0 || selectedGroup !== null) {
          return [{
            key: 'cost',
            label: t('monthCost'),
            color: mixWithWhite(BAR_BASE, 0),
            values: days.map(day => day.cost),
            axis: 'right',
            scale: 'linear',
            format: money,
            type: 'bar',
          }]
        }
        return groupList.map((group, index) => {
          const byDate = new Map(group.daily.map(day => [day.date, day.cost]))
          return {
            key: `cost-${groupKeyOf(group)}`,
            label: group.name,
            color: mixWithWhite(BAR_BASE, Math.min(index, 10) * 0.1),
            values: days.map(day => byDate.get(day.date) ?? 0),
            axis: 'right',
            scale: 'linear',
            format: money,
            type: 'bar',
          }
        })
      }
      const lastMonth = displayMonths.length > 0 ? displayMonths[displayMonths.length - 1] : null
      const selected = displayMonths.find(month => month.key === selectedKey) ?? lastMonth
      const peakDay = selected === null ? null : sourceDays
        .filter(day => day.date.startsWith(`${selected.key}-`))
        .reduce((best, day) => (best === null || day.cost > best.cost ? day : best), null)

      const spendSeries = []
      if (dimension === 'overview' || groupList.length === 0) {
        spendSeries.push({
          key: 'spend',
          label: t('monthCost'),
          color: mixWithWhite(BAR_BASE, 0),
          values: chartDays.map(day => day.cost),
          axis: 'right',
          scale: 'linear',
          format: money,
          type: 'bar',
        })
      } else {
        const drawn = selectedGroup === null ? groupList : [selectedGroup]
        drawn.forEach((group, index) => {
          const byDate = new Map(group.daily.map(day => [day.date, day.cost]))
          spendSeries.push({
            key: `spend-${groupKeyOf(group)}`,
            label: group.name,
            color: mixWithWhite(BAR_BASE, selectedGroup !== null ? 0.3 : Math.min(index, 10) * 0.1),
            values: chartDays.map(day => byDate.get(day.date) ?? 0),
            axis: 'right',
            scale: 'linear',
            format: money,
            type: 'bar',
          })
        })
      }

      const combinedSeries = [
        {
          key: 'totalTokens',
          label: t('dayTokens'),
          color: 'var(--dsw-alias-label-tertiary)',
          values: tokenTotals,
          axis: 'left',
          scale: 'log',
          format: tokens,
          // Shown in the hover readout only: it tracks the cache-hit line closely.
          hidden: true,
        },
        {
          key: 'cacheHit',
          label: t('cacheHit'),
          color: chartColors.cacheHit,
          values: chartDays.map(day => day.cacheHit),
          axis: 'left',
          scale: 'log',
          format: tokens,
        },
        {
          key: 'cacheMiss',
          label: t('cacheMiss'),
          color: chartColors.cacheMiss,
          values: chartDays.map(day => day.cacheMiss),
          axis: 'left',
          scale: 'log',
          format: tokens,
        },
        {
          key: 'output',
          label: t('output'),
          color: chartColors.output,
          values: chartDays.map(day => day.response),
          axis: 'left',
          scale: 'log',
          format: tokens,
        },
        ...spendSeries,
      ]

      // The cards follow the filter: picking a model or key reports that group's
      // own totals, so they agree with the chart beside them.
      const scoped = selectedGroup !== null
      const scopeName = scoped ? selectedGroup.name : ''
      const scopePrefix = scoped ? `${scopeName} · ` : ''
      const scopeCost = scoped ? chartDays.reduce((sum, day) => sum + day.cost, 0) : data.lifetimeSpend
      const scopeActiveDays = scoped ? chartDays.filter(day => day.cost > 0).length : data.activeDays
      const scopeMonthsWithSpend = scoped
        ? new Set(chartDays.filter(day => day.cost > 0).map(day => day.date.slice(0, 7))).size
        : data.monthsWithSpend
      const scopeThisMonth = scoped && lastMonth !== null
        ? chartDays.filter(day => day.date.startsWith(`${lastMonth.key}-`)).reduce((sum, day) => sum + day.cost, 0)
        : (lastMonth === null ? 0 : lastMonth.cost)
      const scopeRequests = scoped ? chartDays.reduce((sum, day) => sum + day.requests, 0) : totalRequests
      const scopeTokens = scoped
        ? chartDays.reduce((sum, day) => sum + day.cacheHit + day.cacheMiss + day.response, 0)
        : totalTokens

      const cards = [
        h(StatCard, {
          key: 'lifetime',
          label: t('lifetimeSpend'),
          value: money(scopeCost),
          hint: scoped ? scopeName : (data.firstDate === null ? undefined : t('lifetimeHint', { date: data.firstDate })),
        }),
        h(StatCard, {
          key: 'thisMonth',
          label: t('thisMonth'),
          value: money(scopeThisMonth),
          hint: lastMonth === null ? undefined : `${scopePrefix}${t('thisMonthHint', { month: lastMonth.key })}`,
        }),
        h(StatCard, {
          key: 'averageMonth',
          label: t('averageMonth'),
          value: money(scopeMonthsWithSpend > 0 ? scopeCost / scopeMonthsWithSpend : 0),
          hint: `${scopePrefix}${t('averageMonthHint', { months: scopeMonthsWithSpend })}`,
        }),
        h(StatCard, {
          key: 'averageDay',
          label: t('averageDay'),
          value: money(scopeActiveDays > 0 ? scopeCost / scopeActiveDays : 0),
          hint: `${scopePrefix}${t('averageDayHint', { days: scopeActiveDays })}`,
        }),
        h(StatCard, {
          key: 'requests',
          label: t('totalRequests'),
          value: scopeRequests.toLocaleString('zh-CN'),
          hint: t('totalRequestsHint', { tokens: tokens(scopeTokens) }),
        }),
      ]

      // Spend recorded from the first month through the selected one.
      const cumulatedUntil = selected === null ? 0 : displayMonths
        .filter(month => month.key <= selected.key)
        .reduce((sum, month) => sum + month.cost, 0)

      const daysByMonth = new Map()
      for (const day of sourceDays) {
        const key = day.date.slice(0, 7)
        const list = daysByMonth.get(key)
        if (list === undefined) daysByMonth.set(key, [day])
        else list.push(day)
      }

      const signedPercent = (value) => `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`
      // A missing comparison month counts as zero spend; either way a zero base
      // has no ratio, so the month reports 100% when it spent something and 0%
      // when it did not.
      const growthBetween = (current, baseline) => {
        const base = baseline === null ? 0 : baseline.cost
        if (base > 0) return { percent: ((current.cost - base) / base) * 100 }
        return { percent: current.cost > 0 ? 100 : 0 }
      }

      // Per-period breakdown: which key and which model burned the tokens, each with
      // its own blended unit cost, shown inside that period's own table row.
      const rankFor = (prefix) => (list) => {
        const scoped = selectedGroup === null ? list : list.filter(group => groupKeyOf(group) === groupSelection)
        return scoped.map(group => {
          const days = group.daily.filter(day => day.date.startsWith(prefix))
          const tokensTotal = days.reduce((sum, day) => sum + day.cacheHit + day.cacheMiss + day.response, 0)
          const hitTotal = days.reduce((sum, day) => sum + day.cacheHit, 0)
          const cost = days.reduce((sum, day) => sum + day.cost, 0)
          return {
            key: groupKeyOf(group),
            name: group.name,
            tokens: tokensTotal,
            cost,
            unit: tokensTotal > 0 ? (cost / tokensTotal) * 1e6 : 0,
            hitRatio: tokensTotal > 0 ? (hitTotal / tokensTotal) * 100 : 0,
          }
        }).filter(item => item.tokens > 0).sort((left, right) => right.tokens - left.tokens)
      }
      const rankTable = (key, title, rows, total) => h('div', { key, style: { flex: '1 1 320px', minWidth: 240 } }, [
        h('div', { key: 'title', style: { ...sectionHintStyle, marginBottom: 4 } }, title),
        rows.length === 0
          ? h('div', { key: 'empty', style: sectionHintStyle }, '—')
          : h('table', { key: 'table', style: tableStyle }, [
            h('thead', { key: 'head' }, h('tr', {}, [
              h('th', { key: 'name', style: thFirstStyle }, t('groupName')),
              h('th', { key: 'tokens', style: thStyle }, t('dayTokens')),
              h('th', { key: 'share', style: thStyle }, t('rankShare')),
              h('th', { key: 'hitRatio', style: thStyle }, t('hitRatio')),
              h('th', { key: 'unit', style: thStyle }, t('rankUnit')),
            ])),
            h('tbody', { key: 'body' }, rows.map(row => h('tr', { key: row.key }, [
              h('td', { key: 'name', style: tdFirstStyle }, row.name),
              h('td', { key: 'tokens', style: mutedCellStyle }, tokens(row.tokens)),
              h('td', { key: 'share', style: mutedCellStyle },
                total > 0 ? `${((row.tokens / total) * 100).toFixed(1)}%` : '—'),
              h('td', { key: 'hitRatio', style: mutedCellStyle },
                row.tokens > 0 ? `${row.hitRatio.toFixed(1)}%` : '—'),
              h('td', { key: 'unit', style: mutedCellStyle }, `${money(row.unit)}/M`),
            ]))),
          ]),
      ])

      const monthRows = displayMonths.map((month, index) => {
        const previous = index > 0 ? displayMonths[index - 1] : null
        const sameMonthLastYear = displayMonths.find(item =>
          item.key === `${month.year - 1}-${String(month.month).padStart(2, '0')}`) ?? null
        const monthOverMonth = growthBetween(month, previous)
        const yearOverYear = growthBetween(month, sameMonthLastYear)
        const isSelected = selected !== null && selected.key === month.key
        const row = h('tr', {
          key: month.key,
          style: {
            cursor: 'pointer',
            background: isSelected ? 'var(--dsw-alias-interactive-bg-hover)' : undefined,
          },
          onClick: () => { setSelectedKey(month.key) },
        }, [
          h('td', { key: 'month', style: tdFirstStyle }, month.key),
          h('td', { key: 'trend', style: { ...tdStyle, width: 118, textAlign: 'left', lineHeight: '16px', whiteSpace: 'nowrap' } }, [
            h('div', { key: 'mom' }, `${t('monthOverMonth')} ${signedPercent(monthOverMonth.percent)}`),
            h('div', { key: 'yoy', style: { color: 'var(--dsw-alias-label-tertiary)' } },
              `${t('yearOverYear')} ${signedPercent(yearOverYear.percent)}`),
          ]),
          h('td', { key: 'cost', style: tdStyle }, money(month.cost)),
          h('td', { key: 'average', style: mutedCellStyle }, money(month.activeDays > 0 ? month.cost / month.activeDays : 0)),
          h('td', { key: 'active', style: mutedCellStyle }, String(month.activeDays)),
          h('td', { key: 'requests', style: mutedCellStyle }, month.requests.toLocaleString('zh-CN')),
          h('td', { key: 'tokens', style: mutedCellStyle }, tokens(month.cacheHit + month.cacheMiss + month.response)),
        ])
        if (!isSelected) return row
        // The picked month expands in place: its per-key and per-model token split,
        // each with its own unit cost.
        const monthTotal = month.cacheHit + month.cacheMiss + month.response
        return h(React.Fragment, { key: month.key }, [
          row,
          h('tr', { key: 'detail' }, h('td', {
            colSpan: 7,
            style: { padding: '10px 12px', background: 'var(--dsw-alias-bg-base)' },
          }, h('div', { style: { display: 'flex', gap: 20, flexWrap: 'wrap' } }, [
            rankTable('api', t('rankByApi'), rankFor(`${month.key}-`)(data.groups?.keys ?? []), monthTotal),
            rankTable('model', t('rankByModel'), rankFor(`${month.key}-`)(data.groups?.models ?? []), monthTotal),
          ]))),
        ])
      })

      const monthDays = selected === null ? [] : (daysByMonth.get(selected.key) ?? [])

      const selectedYear = yearly.find(entry => entry.year === selectedYearKey)
        ?? (yearly.length > 0 ? yearly[yearly.length - 1] : null)
      const yearIndex = selectedYear === null ? -1 : yearly.findIndex(entry => entry.year === selectedYear.year)
      const previousYear = yearIndex > 0 ? yearly[yearIndex - 1] : null
      const yearGrowth = selectedYear === null ? null : growthBetween(selectedYear, previousYear)
      const yearDays = selectedYear === null
        ? []
        : sourceDays.filter(day => day.date.startsWith(`${selectedYear.year}-`))

      const selectedDetails = selected === null ? null : h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 } }, [
        h('div', { key: 'title', style: sectionTitleStyle }, [
          h('span', { key: 'name', style: sectionNameStyle }, selected.key),
          h('span', { key: 'hint', style: sectionHintStyle }, selected.cost > 0
            ? t('dayAverage', { value: money(selected.activeDays > 0 ? selected.cost / selected.activeDays : 0) })
            : t('noSpend')),
        ]),
        h('div', { key: 'curve', style: {
          border: '1px solid var(--dsw-alias-border-l2)',
          borderRadius: 10,
          padding: '10px 12px',
          background: 'var(--dsw-alias-bg-base)',
        } }, [
          h('div', { key: 'label', style: { ...sectionHintStyle, marginBottom: 6 } }, t('monthCurveHint')),
          h(LineChart, {
            key: 'chart',
            dates: monthDays.map(day => day.date),
            series: [
              {
                key: 'tokens',
                label: t('dayTokens'),
                color: chartColors.cacheHit,
                values: monthDays.map(day => day.cacheHit + day.cacheMiss + day.response),
                axis: 'left',
                scale: 'log',
                format: tokens,
              },
              ...barsFor(monthDays),
            ],
            height: 200,
            windowDays: Math.max(monthDays.length, 1),
          }),
        ]),
        h('div', { key: 'grid', style: cardGridStyle }, [
          h(StatCard, { key: 'cost', label: t('monthCost'), value: money(selected.cost) }),
          h(StatCard, { key: 'average', label: t('monthAverageDay'), value: money(selected.activeDays > 0 ? selected.cost / selected.activeDays : 0) }),
          h(StatCard, {
            key: 'cumulated',
            label: t('cumulatedUntil'),
            value: money(cumulatedUntil),
            hint: t('cumulatedUntilHint'),
          }),
          h(StatCard, { key: 'active', label: t('monthActiveDays'), value: String(selected.activeDays) }),
          h(StatCard, { key: 'requests', label: t('monthRequests'), value: selected.requests.toLocaleString('zh-CN') }),
        ]),
        peakDay === null || peakDay.cost <= 0 ? null : h('div', {
          key: 'peak',
          style: noteStyle,
        }, t('peakDay', { date: peakDay.date, value: money(peakDay.cost) })),
        h('div', { key: 'legend', style: legendStyle }, [
          h('span', { key: 'tokens', style: legendItemStyle },
            [t('dayTokens'), ` ${tokens(selected.cacheHit + selected.cacheMiss + selected.response)}`]),
        ]),
      ])

      return h('div', { style: pageStyle }, h('div', { style: innerStyle }, [
        h('header', { key: 'head', style: headerStyle }, [
          h('div', { key: 'text', style: headTextStyle }, [
            h('h1', { key: 'title', style: titleStyle }, t('title')),
            h('p', { key: 'intro', style: subtitleStyle }, t('intro')),
            h('p', { key: 'updated', style: sectionHintStyle }, t('updatedAt', { time: formatClock(data.generatedAt) })),
          ]),
          h('div', { key: 'actions', style: { display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end', flex: 'none' } }, [
            h('button', {
              key: 'copy',
              type: 'button',
              style: buttonStyle,
              onClick: () => { void copyDetails() },
            }, t('copyDetails')),
            h('button', {
              key: 'export',
              type: 'button',
              style: buttonStyle,
              onClick: exportDetails,
            }, t('exportDetails')),
            h('button', {
              key: 'export-api',
              type: 'button',
              style: buttonStyle,
              onClick: () => { void exportReport('api') },
            }, t('exportApiReport')),
            h('button', {
              key: 'export-model',
              type: 'button',
              style: buttonStyle,
              onClick: () => { void exportReport('model') },
            }, t('exportModelReport')),
            h('button', {
              key: 'refresh',
              type: 'button',
              style: buttonStyle,
              disabled: state.phase === 'loading',
              onClick: () => { void load(true) },
            }, state.phase === 'loading' ? t('refreshing') : t('refresh')),
          ]),
        ]),

        notice === null ? null : h('p', { key: 'notice', style: { ...sectionHintStyle, margin: 0 } }, notice),

        h('div', { key: 'cards', style: cardGridStyle }, cards),

        h('section', { key: 'daily', style: panelStyle }, [
          h('div', { key: 'head', style: sectionTitleStyle }, [
            h('span', { key: 'name', style: sectionNameStyle }, t('chartTitle')),
            h('span', { key: 'hint', style: sectionHintStyle }, t('chartHint', {
              from: chartFrom,
              to: chartTo,
              days: chartDays.length,
            })),
            h('div', { key: 'window', style: { marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' } }, [
              h('span', { key: 'label', style: sectionHintStyle }, t('rangeLabel')),
              ...[2, 3, 6, 12].map(months => h('button', {
                key: months,
                type: 'button',
                'aria-pressed': months === rangeMonths,
                style: months === rangeMonths
                  ? { ...chipBase, color: 'var(--dsw-alias-label-primary)', background: 'var(--dsw-alias-interactive-bg-hover)' }
                  : chipBase,
                // A mouse click must not leave a focus ring on the button it just
                // deselected; keyboard focus keeps its ring.
                onPointerDown: (event) => { event.preventDefault() },
                onFocus: (event) => {
                  const element = event.currentTarget
                  if (!element.matches(':focus-visible')) element.blur()
                },
                onClick: (event) => {
                  // detail > 0 means a pointer click; drop its focus ring too.
                  if (event.detail > 0) event.currentTarget.blur()
                  setRangeMonths(months)
                },
              }, months === 12 ? t('rangeYear') : t('rangeMonths', { months }))),
            ]),
          ]),
          h(DimensionPicker, {
            key: 'groupbar',
            t,
            dimension,
            groupSelection,
            groupList,
            groupOptions,
            hasModels: (data.groups?.models ?? []).length > 0,
            hasKeys: (data.groups?.keys ?? []).length > 0,
            onDimension: (value) => {
              setDimension(value)
              setGroupSelection('all')
            },
            onGroupSelection: (value) => { setGroupSelection(value) },
          }),
          h('div', { key: 'legend', style: legendStyle }, combinedSeries.filter(item => item.hidden !== true).map(item => h('span', {
            key: item.key,
            style: legendItemStyle,
          }, [
            h('span', {
              key: 'swatch',
              style: {
                width: 10,
                height: 2,
                borderRadius: 1,
                background: item.color,
                display: 'inline-block',
                opacity: item.opacity ?? 1,
              },
            }),
            item.label,
          ]))),
          h(LineChart, {
            key: 'chart',
            dates: chartDays.map(day => day.date),
            series: combinedSeries,
            height: 240,
            windowDays,
          }),
          h('div', { key: 'scale', style: sectionHintStyle }, t('chartAxisHint')),
        ]),

        h('section', { key: 'months', style: panelStyle }, [
          h('div', { key: 'head', style: sectionTitleStyle }, [
            h('span', { key: 'name', style: sectionNameStyle }, t('monthSectionTitle')),
            h('span', { key: 'hint', style: sectionHintStyle }, t('monthSectionHint')),
          ]),
          h(DimensionPicker, {
            key: 'monthGroups',
            t,
            dimension,
            groupSelection,
            groupList,
            groupOptions,
            hasModels: (data.groups?.models ?? []).length > 0,
            hasKeys: (data.groups?.keys ?? []).length > 0,
            onDimension: (value) => {
              setDimension(value)
              setGroupSelection('all')
            },
            onGroupSelection: (value) => { setGroupSelection(value) },
          }),
          h('div', { key: 'chips', style: monthChipsStyle }, displayMonths.map(month => h('button', {
            key: month.key,
            type: 'button',
            'aria-pressed': selected !== null && selected.key === month.key,
            style: selected !== null && selected.key === month.key
              ? { ...chipBase, color: 'var(--dsw-alias-label-primary)', background: 'var(--dsw-alias-interactive-bg-hover)' }
              : chipBase,
            onPointerDown: (event) => { event.preventDefault() },
            onFocus: (event) => {
              const element = event.currentTarget
              if (!element.matches(':focus-visible')) element.blur()
            },
            onClick: (event) => {
              if (event.detail > 0) event.currentTarget.blur()
              setSelectedKey(month.key)
            },
          }, month.key))),
          selectedDetails,
          h('div', { key: 'table', style: { overflowX: 'auto' } }, h('table', { style: tableStyle }, [
            h('thead', { key: 'head' }, h('tr', {}, [
              h('th', { key: 'month', style: thFirstStyle }, t('month')),
              h('th', { key: 'trend', style: { ...thFirstStyle, width: 118 } }, t('monthTrend')),
              h('th', { key: 'cost', style: thStyle }, t('monthCost')),
              h('th', { key: 'average', style: thStyle }, t('monthAverageDay')),
              h('th', { key: 'active', style: thStyle }, t('monthActiveDays')),
              h('th', { key: 'requests', style: thStyle }, t('monthRequests')),
              h('th', { key: 'tokens', style: thStyle }, t('dayTokens')),
            ])),
            h('tbody', { key: 'body' }, monthRows),
          ])),
        ]),

        h('section', { key: 'years', style: panelStyle }, [
          h('div', { key: 'head', style: sectionTitleStyle }, [
            h('span', { key: 'name', style: sectionNameStyle }, t('yearSectionTitle')),
            h('span', { key: 'hint', style: sectionHintStyle }, t('yearSectionHint')),
          ]),
          h(DimensionPicker, {
            key: 'yearGroups',
            t,
            dimension,
            groupSelection,
            groupList,
            groupOptions,
            hasModels: (data.groups?.models ?? []).length > 0,
            hasKeys: (data.groups?.keys ?? []).length > 0,
            onDimension: (value) => {
              setDimension(value)
              setGroupSelection('all')
            },
            onGroupSelection: (value) => { setGroupSelection(value) },
          }),
          h('div', { key: 'chips', style: monthChipsStyle }, yearly.map(entry => h('button', {
            key: entry.year,
            type: 'button',
            'aria-pressed': selectedYear !== null && selectedYear.year === entry.year,
            style: selectedYear !== null && selectedYear.year === entry.year
              ? { ...chipBase, color: 'var(--dsw-alias-label-primary)', background: 'var(--dsw-alias-interactive-bg-hover)' }
              : chipBase,
            onPointerDown: (event) => { event.preventDefault() },
            onFocus: (event) => {
              const element = event.currentTarget
              if (!element.matches(':focus-visible')) element.blur()
            },
            onClick: (event) => {
              if (event.detail > 0) event.currentTarget.blur()
              setSelectedYearKey(entry.year)
            },
          }, entry.year))),
          selectedYear === null ? null : h('div', { key: 'curve', style: {
            border: '1px solid var(--dsw-alias-border-l2)',
            borderRadius: 10,
            padding: '10px 12px',
            background: 'var(--dsw-alias-bg-base)',
          } }, [
            h('div', { key: 'label', style: { ...sectionHintStyle, marginBottom: 6 } }, t('yearCurveHint')),
            h(LineChart, {
              key: 'chart',
              dates: yearDays.map(day => day.date),
              series: [
                {
                  key: 'tokens',
                  label: t('dayTokens'),
                  color: chartColors.cacheHit,
                  values: yearDays.map(day => day.cacheHit + day.cacheMiss + day.response),
                  axis: 'left',
                  scale: 'log',
                  format: tokens,
                },
                ...barsFor(yearDays),
              ],
              height: 200,
              windowDays: Math.max(yearDays.length, 1),
            }),
          ]),
          selectedYear === null ? null : h('div', { key: 'grid', style: cardGridStyle }, [
            h(StatCard, { key: 'cost', label: t('monthCost'), value: money(selectedYear.cost) }),
            h(StatCard, {
              key: 'average',
              label: t('monthAverageDay'),
              value: money(selectedYear.activeDays > 0 ? selectedYear.cost / selectedYear.activeDays : 0),
            }),
            h(StatCard, {
              key: 'growth',
              label: t('yearOverYear'),
              value: yearGrowth === null ? '—' : signedPercent(yearGrowth.percent),
            }),
            h(StatCard, { key: 'active', label: t('monthActiveDays'), value: String(selectedYear.activeDays) }),
            h(StatCard, { key: 'requests', label: t('monthRequests'), value: selectedYear.requests.toLocaleString('zh-CN') }),
          ]),
          h('div', { key: 'table', style: { overflowX: 'auto', marginTop: 10 } }, h('table', { style: tableStyle }, [
            h('thead', { key: 'head' }, h('tr', {}, [
              h('th', { key: 'year', style: thFirstStyle }, t('year')),
              h('th', { key: 'cost', style: thStyle }, t('monthCost')),
              h('th', { key: 'average', style: thStyle }, t('monthAverageDay')),
              h('th', { key: 'active', style: thStyle }, t('monthActiveDays')),
              h('th', { key: 'requests', style: thStyle }, t('monthRequests')),
              h('th', { key: 'tokens', style: thStyle }, t('dayTokens')),
              h('th', { key: 'growth', style: thStyle }, t('yearOverYear')),
            ])),
            h('tbody', { key: 'body' }, yearly.map((entry, index) => {
              const growth = growthBetween(entry, index > 0 ? yearly[index - 1] : null)
              const isSelected = selectedYear !== null && selectedYear.year === entry.year
              const row = h('tr', {
                key: entry.year,
                style: {
                  cursor: 'pointer',
                  background: isSelected ? 'var(--dsw-alias-interactive-bg-hover)' : undefined,
                },
                onClick: () => { setSelectedYearKey(entry.year) },
              }, [
                h('td', { key: 'year', style: tdFirstStyle }, entry.year),
                h('td', { key: 'cost', style: tdStyle }, money(entry.cost)),
                h('td', { key: 'average', style: mutedCellStyle }, money(entry.activeDays > 0 ? entry.cost / entry.activeDays : 0)),
                h('td', { key: 'active', style: mutedCellStyle }, String(entry.activeDays)),
                h('td', { key: 'requests', style: mutedCellStyle }, entry.requests.toLocaleString('zh-CN')),
                h('td', { key: 'tokens', style: mutedCellStyle }, tokens(entry.cacheHit + entry.cacheMiss + entry.response)),
                h('td', { key: 'growth', style: mutedCellStyle }, signedPercent(growth.percent)),
              ])
              if (!isSelected) return row
              const yearTotal = entry.cacheHit + entry.cacheMiss + entry.response
              return h(React.Fragment, { key: entry.year }, [
                row,
                h('tr', { key: 'detail' }, h('td', {
                  colSpan: 7,
                  style: { padding: '10px 12px', background: 'var(--dsw-alias-bg-base)' },
                }, h('div', { style: { display: 'flex', gap: 20, flexWrap: 'wrap' } }, [
                  rankTable('api', t('rankByApiYear'), rankFor(`${entry.year}-`)(data.groups?.keys ?? []), yearTotal),
                  rankTable('model', t('rankByModelYear'), rankFor(`${entry.year}-`)(data.groups?.models ?? []), yearTotal),
                ]))),
              ])
            })),
          ])),
        ]),
      ]))
    }

    /**
     * The sidebar panel glyph: three rising bars under a trend line.
     * @param props - requested size and selection state.
     * @returns the icon element.
     */
    function UsageIcon({ size = 16 }) {
      return h('svg', {
        width: size,
        height: size,
        viewBox: '0 0 16 16',
        fill: 'none',
        'aria-hidden': true,
        children: [
          h('rect', { key: 'bar1', x: 2.2, y: 9.4, width: 2.2, height: 4.2, rx: 0.6, fill: 'currentColor' }),
          h('rect', { key: 'bar2', x: 6.1, y: 6.6, width: 2.2, height: 7, rx: 0.6, fill: 'currentColor' }),
          h('rect', { key: 'bar3', x: 10, y: 3.6, width: 2.2, height: 10, rx: 0.6, fill: 'currentColor', opacity: 0.55 }),
          h('path', {
            key: 'trend',
            d: 'M2.4 6.2 6.2 4.4 9.9 5.5 13.6 1.9',
            stroke: 'currentColor',
            strokeWidth: 1.3,
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
          }),
        ],
      })
    }

    const inject = ['slots', 'locale']

    /**
     * Register the sidebar entry, the page it opens, and the dictionaries.
     * @param ctx - the browser plugin context.
     */
    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, DICTS), 'deepseek-usage-stats: dictionaries')
      const t = ctx.locale.bind(NS)

      ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
        name: 'sidebar.panellist',
        id: PANEL_ID,
        order: 1,
        label: () => t('panel'),
        locale: NS,
      }, UsageIcon))

      ctx.slots.inject('main', () => ctx.slots.register({
        name: 'main',
        key: PANEL_ID,
        locale: NS,
        inject: () => ({ t }),
      }, UsagePage))
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
