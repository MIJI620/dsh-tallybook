/**
 * DeepSeek usage statistics — Host half.
 *
 * Reads the signed-in account's usage through the Platform console's own
 * endpoints and serves one aggregated snapshot to the browser half:
 *
 *   GET /api/deepseek-usage/data            aggregated snapshot (cached)
 *   GET /api/deepseek-usage/data?refresh=1  rebuild the cache
 *
 * Sources, authenticated with the account token the DSH account service holds:
 *   - GET /api/v0/users/get_user_summary    lifetime spend (`total_costs`)
 *   - GET /api/v0/usage/cost?month&year     per-day spend
 *   - GET /api/v0/usage/amount?month&year   per-day token composition
 *
 * The token never leaves the Host. The browser only ever receives numbers.
 *
 * @module dsh-deepseek-usage-stats
 */
import { execFile } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/** Cordis plugin name. */
export const name = 'deepseek-usage-stats'

/** The account service owns the Platform credential; webServer exposes the route. */
export const inject = ['deepseekAccount', 'webServer']

/** Snapshot route; the browser half builds the same constant. */
const ROUTE = '/api/deepseek-usage/data'

/** Route that writes a generated report PNG to the plugin's reports folder. */
const REPORT_ROUTE = '/api/deepseek-usage/save-report'

/** Route that opens the native folder picker. */
const PICK_ROUTE = '/api/deepseek-usage/pick-folder'

/** Cached native dialog lookup: the desktop shell exposes Electron, other shells do not. */
let dialogPromise = null

/**
 * Resolve Electron's dialog module when the Host runs inside the desktop shell.
 * @returns the dialog object, or null when unavailable.
 */
function loadDialog() {
  if (dialogPromise === null) {
    dialogPromise = import('electron')
      .then(module => module.dialog ?? module.default?.dialog ?? null)
      .catch(() => null)
  }
  return dialogPromise
}

/**
 * Whether a string is an absolute path this Host can write to.
 * @param value - candidate path.
 * @returns whether it looks absolute.
 */
function isAbsolutePath(value) {
  return typeof value === 'string' && (/^[A-Za-z]:[\\/]/.test(value) || value.startsWith('/'))
}

/**
 * Open the Windows folder picker through PowerShell, used when the desktop shell
 * does not expose Electron's dialog to plugins.
 * @returns the chosen folder, or null when cancelled or unavailable.
 */
function pickFolderWithPowerShell() {
  return new Promise((resolve) => {
    const script = [
      'Add-Type -AssemblyName System.Windows.Forms',
      '$dialog = New-Object System.Windows.Forms.FolderBrowserDialog',
      "$dialog.Description = '选择报告保存位置'",
      'if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($dialog.SelectedPath) } else { [Console]::Out.Write("CANCELED") }',
    ].join('; ')
    execFile('powershell.exe', ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { timeout: 180000, windowsHide: true },
      (error, stdout) => {
        const value = String(stdout ?? '').trim()
        if (error !== null || value === '' || value === 'CANCELED') {
          resolve(null)
          return
        }
        resolve(value)
      })
  })
}

/** Per-API-key token endpoint (the console's "by API" view). */
const BY_KEY_AMOUNT_PATH = '/api/v0/usage/by_api_key/amount'

/** Per-API-key cost endpoint. */
const BY_KEY_COST_PATH = '/api/v0/usage/by_api_key/cost'

/** One Platform request's deadline. */
const REQUEST_TIMEOUT_MS = 20000

/** How long a snapshot stays fresh. */
const CACHE_TTL_MS = 5 * 60 * 1000

/** A stored snapshot older than this is not shown at all; the request waits for a rebuild. */
const STALE_LIMIT_MS = 24 * 60 * 60 * 1000

/** Oldest month the walker will look at. */
const MAX_MONTHS = 36

/** Consecutive months without spend that end the walk. */
const STOP_EMPTY_MONTHS = 3

/** Months fetched at once. */
const BATCH_SIZE = 4

/** Response headers for every JSON answer. */
const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
}

/** Platform usage-type names mapped to the snapshot fields they accumulate into. */
const TOKEN_FIELDS = {
  PROMPT_TOKEN: 'prompt',
  PROMPT_CACHE_HIT_TOKEN: 'cacheHit',
  PROMPT_CACHE_MISS_TOKEN: 'cacheMiss',
  RESPONSE_TOKEN: 'response',
  REQUEST: 'requests',
}

/**
 * Write one JSON response.
 * @param res - the route's response.
 * @param status - HTTP status code.
 * @param body - serializable body.
 */
function sendJson(res, status, body) {
  res.writeHead(status, JSON_HEADERS)
  res.end(JSON.stringify(body))
}

/**
 * Coerce a possibly-string amount to a finite number.
 * @param value - raw amount from the Platform payload.
 * @returns the number, or 0 when it is not finite.
 */
function toNumber(value) {
  const parsed = typeof value === 'string' ? Number(value) : value
  return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : 0
}

/** Zero an usage tally. */
function emptyTotals() {
  return { cost: 0, prompt: 0, cacheHit: 0, cacheMiss: 0, response: 0, requests: 0 }
}

/** Pad a month or day number to two digits. */
function pad(value) {
  return String(value).padStart(2, '0')
}

/**
 * Whether a request came from this machine.
 * @param req - the incoming request.
 * @returns whether its peer address is a loopback address.
 */
function isLoopback(req) {
  const address = req.socket?.remoteAddress ?? ''
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1' || address.startsWith('127.')
}

/**
 * Headers for a Platform console request: the deployment headers the account
 * service supplies plus the account token the console's own API expects.
 * @param session - the account's Platform session.
 * @returns the request headers.
 */
function platformHeaders(session) {
  return {
    ...session.requestHeaders,
    'x-dsh-auth-token': session.token,
    Accept: 'application/json',
    Origin: session.origin,
    Referer: `${session.origin}/usage`,
    'x-app-version': '1.0.0',
  }
}

/**
 * Call one console endpoint and unwrap the envelope's business payload.
 * @param session - the account's Platform session.
 * @param path - path below the Platform origin, leading slash included.
 * @returns the business payload, or null when the envelope carries none.
 */
async function platformGet(session, path) {
  const response = await fetch(`${session.origin}${path}`, {
    headers: platformHeaders(session),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (response.status === 401) throw new Error('session-expired')
  if (!response.ok) throw new Error(`http-${response.status}`)
  const payload = await response.json()
  const code = payload?.code
  if (code === 40003) throw new Error('session-expired')
  if (code !== 0) throw new Error(`api-${String(code)}`)
  let business = payload?.data?.biz_data
  if (Array.isArray(business)) business = business[0]
  return business ?? null
}

/**
 * Read the lifetime spend the summary endpoint reports.
 * @param session - the account's Platform session.
 * @returns the currency and spend, or null when the payload carries neither.
 */
async function fetchLifetimeSpend(session) {
  const summary = await platformGet(session, '/api/v0/users/get_user_summary')
  const costs = Array.isArray(summary?.total_costs) ? summary.total_costs : []
  const chosen = costs.find(entry => entry?.currency === 'CNY') ?? costs[0]
  if (chosen === undefined) return null
  return { currency: typeof chosen.currency === 'string' ? chosen.currency : 'CNY', amount: toNumber(chosen.amount) }
}

/**
 * Look up (or create) one day's tally.
 * @param days - the month's day map.
 * @param date - `YYYY-MM-DD`.
 * @returns the day's tally.
 */
function dayEntry(days, date) {
  let entry = days.get(date)
  if (entry === undefined) {
    entry = { date, cost: 0, prompt: 0, cacheHit: 0, cacheMiss: 0, response: 0, requests: 0 }
    days.set(date, entry)
  }
  return entry
}

/**
 * Accumulate one payload's per-day usage into the month's day map.
 * @param days - the month's day map.
 * @param payload - the unwrapped `usage` business payload.
 * @param field - `cost` for money payloads, `tokens` for the amount payload.
 */
function accumulate(days, payload, field) {
  for (const day of payload?.days ?? []) {
    if (typeof day?.date !== 'string') continue
    const entry = dayEntry(days, day.date)
    for (const model of day.data ?? []) {
      for (const usage of model?.usage ?? []) {
        if (field === 'cost') {
          entry.cost += toNumber(usage?.amount)
          continue
        }
        const target = TOKEN_FIELDS[usage?.type]
        if (target !== undefined) entry[target] += toNumber(usage?.amount)
      }
    }
  }
}

/**
 * Fetch one month's spend and token composition.
 * @param session - the account's Platform session.
 * @param year - four-digit year.
 * @param month - 1-based month.
 * @returns the month's totals, active-day count, and days in date order.
 */
async function fetchMonth(session, year, month) {
  const [costPayload, amountPayload] = await Promise.all([
    platformGet(session, `/api/v0/usage/cost?month=${month}&year=${year}`),
    platformGet(session, `/api/v0/usage/amount?month=${month}&year=${year}`),
  ])
  const days = new Map()
  accumulate(days, costPayload, 'cost')
  accumulate(days, amountPayload, 'tokens')
  const totals = emptyTotals()
  let activeDays = 0
  for (const entry of days.values()) {
    totals.cost += entry.cost
    totals.prompt += entry.prompt
    totals.cacheHit += entry.cacheHit
    totals.cacheMiss += entry.cacheMiss
    totals.response += entry.response
    totals.requests += entry.requests
    if (entry.cost > 0) activeDays += 1
  }
  const sortedDays = [...days.values()].sort((left, right) => left.date.localeCompare(right.date))
  return { key: `${year}-${pad(month)}`, year, month, totals, activeDays, days: sortedDays }
}

/**
 * Step one month back.
 * @param year - four-digit year.
 * @param month - 1-based month.
 * @returns the previous month.
 */
function previousMonth(year, month) {
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 }
}

/**
 * Walk back from the current month until three months in a row hold no spend.
 * @param session - the account's Platform session.
 * @returns the collected months in ascending order.
 */
async function collectMonths(session) {
  const collected = []
  const now = new Date()
  let cursor = { year: now.getFullYear(), month: now.getMonth() + 1 }
  let emptyRun = 0
  while (collected.length < MAX_MONTHS) {
    const batch = []
    while (batch.length < BATCH_SIZE && collected.length + batch.length < MAX_MONTHS) {
      batch.push(cursor)
      cursor = previousMonth(cursor.year, cursor.month)
    }
    const settled = await Promise.all(batch.map(item => fetchMonth(session, item.year, item.month)))
    for (const entry of settled) {
      collected.push(entry)
      emptyRun = entry.totals.cost > 0 ? 0 : emptyRun + 1
    }
    if (emptyRun >= STOP_EMPTY_MONTHS) break
  }
  return collected.reverse()
}

/**
 * Parse `YYYY-MM-DD` into a UTC midnight timestamp.
 * @param date - the date key.
 * @returns the timestamp.
 */
function parseDateKey(date) {
  const [year, month, day] = date.split('-').map(Number)
  return Date.UTC(year, month - 1, day)
}

/**
 * Format a UTC midnight timestamp as `YYYY-MM-DD`.
 * @param timestamp - the timestamp.
 * @returns the date key.
 */
function formatDateKey(timestamp) {
  const date = new Date(timestamp)
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
}

/**
 * Today's date key in the Host's own time zone.
 * @returns the date key.
 */
function todayKey() {
  const now = new Date()
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/**
 * Build the continuous daily series the charts draw, filling idle days with zeros.
 * @param months - ascending months with their day maps.
 * @returns ascending days from the first recorded month to today.
 */
function buildDailySeries(months) {
  if (months.length === 0) return []
  const byDate = new Map()
  for (const month of months) {
    for (const day of month.days) byDate.set(day.date, day)
  }
  const start = parseDateKey(`${months[0].key}-01`)
  const end = parseDateKey(todayKey())
  const series = []
  for (let cursor = start; cursor <= end; cursor += 24 * 60 * 60 * 1000) {
    const date = formatDateKey(cursor)
    const recorded = byDate.get(date)
    series.push(recorded ?? { date, cost: 0, prompt: 0, cacheHit: 0, cacheMiss: 0, response: 0, requests: 0 })
  }
  return series
}

/**
 * Convert one month into the timestamp window the per-key endpoints expect.
 * The month is cut on UTC boundaries: the console's own `usage/amount` rows are
 * UTC days too, so both sources place the same day in the same month.
 * @param year - four-digit year.
 * @param month - 1-based month.
 * @returns start/end seconds and a zero offset.
 */
function monthWindow(year, month) {
  return {
    startSec: Date.UTC(year, month - 1, 1) / 1000,
    endSec: Date.UTC(year, month, 1) / 1000,
    tzSec: 0,
  }
}

/**
 * Render a bucket timestamp as the local date it belongs to.
 * @param timeSec - bucket start in seconds.
 * @param tzSec - local offset in seconds.
 * @returns `YYYY-MM-DD`.
 */
function bucketDate(timeSec, tzSec) {
  const date = new Date((timeSec + tzSec) * 1000)
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
}

/**
 * Collect per-model and per-API-key daily series for the recorded months.
 * The console exposes both dimensions through `/usage/by_api_key/*`, whose
 * series carry the key identity and the model of every bucket.
 * @param session - the account's Platform session.
 * @param months - ascending months to cover.
 * @returns models and keys, each a list of groups with their daily rows.
 */
async function collectGroups(session, months) {
  const rows = new Map()
  const rowOf = (trackingId, name, model, date) => {
    const id = `${trackingId}|${model}|${date}`
    let row = rows.get(id)
    if (row === undefined) {
      row = { trackingId, name, model, date, cost: 0, cacheHit: 0, cacheMiss: 0, response: 0, requests: 0 }
      rows.set(id, row)
    }
    return row
  }
  for (const month of months) {
    const { startSec, endSec, tzSec } = monthWindow(month.year, month.month)
    const query = `start=${startSec}&end=${endSec}&tz=${tzSec}`
    const [amountBiz, costBiz] = await Promise.all([
      platformGet(session, `${BY_KEY_AMOUNT_PATH}?${query}`),
      platformGet(session, `${BY_KEY_COST_PATH}?${query}`),
    ])
    for (const item of amountBiz?.series ?? []) {
      const apiKey = item.api_key ?? {}
      const trackingId = typeof apiKey.tracking_id === 'string' ? apiKey.tracking_id : ''
      const name = typeof apiKey.name === 'string' && apiKey.name !== '' ? apiKey.name : trackingId
      const model = typeof item.model === 'string' ? item.model : ''
      for (const bucket of item.buckets ?? []) {
        const row = rowOf(trackingId, name, model, bucketDate(bucket.time, tzSec))
        const usage = bucket.usage ?? {}
        row.cacheHit += toNumber(usage.PROMPT_CACHE_HIT_TOKEN)
        row.cacheMiss += toNumber(usage.PROMPT_CACHE_MISS_TOKEN)
        row.response += toNumber(usage.RESPONSE_TOKEN)
        row.requests += toNumber(usage.REQUEST)
      }
    }
    for (const item of costBiz?.data?.[0]?.series ?? []) {
      const apiKey = item.api_key ?? {}
      const trackingId = typeof apiKey.tracking_id === 'string' ? apiKey.tracking_id : ''
      const name = typeof apiKey.name === 'string' && apiKey.name !== '' ? apiKey.name : trackingId
      const model = typeof item.model === 'string' ? item.model : ''
      for (const bucket of item.buckets ?? []) {
        rowOf(trackingId, name, model, bucketDate(bucket.time, tzSec)).cost += toNumber(bucket.cost)
      }
    }
  }

  const addDay = (days, row) => {
    let day = days.get(row.date)
    if (day === undefined) {
      day = { date: row.date, cost: 0, cacheHit: 0, cacheMiss: 0, response: 0, requests: 0 }
      days.set(row.date, day)
    }
    day.cost += row.cost
    day.cacheHit += row.cacheHit
    day.cacheMiss += row.cacheMiss
    day.response += row.response
    day.requests += row.requests
  }
  const byModel = new Map()
  const byKey = new Map()
  for (const row of rows.values()) {
    if (row.model !== '') {
      if (!byModel.has(row.model)) byModel.set(row.model, new Map())
      addDay(byModel.get(row.model), row)
    }
    if (row.trackingId !== '') {
      let entry = byKey.get(row.trackingId)
      if (entry === undefined) {
        entry = { trackingId: row.trackingId, name: row.name, days: new Map() }
        byKey.set(row.trackingId, entry)
      }
      addDay(entry.days, row)
    }
  }
  const sorted = (days) => [...days.values()].sort((left, right) => left.date.localeCompare(right.date))
  return {
    models: [...byModel].map(([name, days]) => ({ name, daily: sorted(days) })),
    keys: [...byKey.values()].map(entry => ({
      trackingId: entry.trackingId,
      name: entry.name,
      daily: sorted(entry.days),
    })),
  }
}

/**
 * Build one snapshot: lifetime spend, per-month summaries, and the daily series.
 * @param session - the account's Platform session.
 * @returns the snapshot body without the route envelope.
 */
async function buildSnapshot(session) {
  const lifetime = await fetchLifetimeSpend(session)
  const collected = await collectMonths(session)
  // The walk ends only after three empty months, so it can start before the
  // account's first spend. History starts at the first month that spent money.
  const firstWithSpend = collected.findIndex(month => month.totals.cost > 0)
  const months = firstWithSpend > 0 ? collected.slice(firstWithSpend) : collected
  const daily = buildDailySeries(months)
  const dailyTotal = daily.reduce((sum, day) => sum + day.cost, 0)
  const lifetimeSpend = lifetime === null ? dailyTotal : lifetime.amount
  const monthsWithSpend = months.filter(month => month.totals.cost > 0).length
  // Group data is a bonus view: a failure there must not sink the main snapshot.
  let groups = { models: [], keys: [] }
  try {
    groups = await collectGroups(session, months)
  } catch {
    // Keep the ungrouped snapshot usable when the per-key endpoint misbehaves.
  }
  return {
    ok: true,
    currency: lifetime === null ? 'CNY' : lifetime.currency,
    lifetimeSpend,
    lifetimeFromMonths: dailyTotal,
    firstDate: daily.length > 0 ? daily[0].date : null,
    lastDate: daily.length > 0 ? daily[daily.length - 1].date : null,
    recordedDays: daily.length,
    activeDays: daily.filter(day => day.cost > 0).length,
    recordedMonths: months.length,
    monthsWithSpend,
    months: months.map(month => ({
      key: month.key,
      year: month.year,
      month: month.month,
      cost: month.totals.cost,
      prompt: month.totals.prompt,
      cacheHit: month.totals.cacheHit,
      cacheMiss: month.totals.cacheMiss,
      response: month.totals.response,
      requests: month.totals.requests,
      activeDays: month.activeDays,
    })),
    daily,
    groups,
    generatedAt: new Date().toISOString(),
  }
}

/**
 * Where the last snapshot is kept between Host restarts.
 * @returns the file path, or null when the Host reports no home directory.
 */
function cacheFilePath() {
  const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  return join(home, 'storages', 'tallybook', 'snapshot.json')
}

/**
 * Read the snapshot an earlier Host process saved.
 * @returns the snapshot, or null when absent or unreadable.
 */
function readStoredSnapshot() {
  const path = cacheFilePath()
  if (path === null) return null
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    const usable = parsed !== null && typeof parsed === 'object' && parsed.ok === true && parsed.groups !== undefined
    return usable ? parsed : null
  } catch {
    return null
  }
}

/**
 * Persist a snapshot so the next Host process starts warm.
 * @param snapshot - the built snapshot.
 */
function writeStoredSnapshot(snapshot) {
  const path = cacheFilePath()
  if (path === null) return
  try {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, JSON.stringify(snapshot), 'utf8')
  } catch {
    // A cache write failure must not fail the request that produced the data.
  }
}

/**
 * Serve the snapshot, rebuilding the cache on demand.
 * @param account - the DeepSeek account service.
 * @param refresh - whether the caller asked for a fresh read.
 * @param cache - the plugin's one-entry cache.
 * @returns an HTTP status and JSON body.
 */
async function answerSnapshot(account, refresh, cache) {
  const age = Date.now() - cache.at
  const fresh = cache.value !== null && age < CACHE_TTL_MS
  if (cache.value !== null) {
    if (!refresh && fresh) return { status: 200, body: cache.value }
    // A stale snapshot answers at once and refreshes behind the scenes; one
    // older than STALE_LIMIT_MS is too old to show, so the request waits.
    if (!refresh && age < STALE_LIMIT_MS) {
      if (cache.refreshing !== true) {
        cache.refreshing = true
        void rebuild(account, cache).finally(() => { cache.refreshing = false })
      }
      return { status: 200, body: cache.value }
    }
  }
  return { status: 200, body: await rebuild(account, cache) }
}

/**
 * Read the account's usage and replace the cache with a new snapshot.
 * @param account - the DeepSeek account service.
 * @param cache - the plugin's one-entry cache.
 * @returns the new snapshot, or an error body.
 */
async function rebuild(account, cache) {
  let session
  try {
    session = await account.getPlatformSession()
  } catch (error) {
    return { ok: false, code: 'account-error', message: String(error?.message ?? error) }
  }
  if (session === null) return { ok: false, code: 'signed-out' }
  try {
    const snapshot = await buildSnapshot(session)
    cache.value = snapshot
    cache.at = Date.now()
    writeStoredSnapshot(snapshot)
    return snapshot
  } catch (error) {
    const message = String(error?.message ?? error)
    if (message === 'session-expired') {
      cache.value = null
      return { ok: false, code: 'session-expired' }
    }
    return { ok: false, code: 'fetch-failed', message }
  }
}

/**
 * Read and parse a JSON request body.
 * @param req - the incoming request.
 * @param limit - maximum accepted body size in bytes.
 * @returns the parsed body.
 */
function readJsonBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('body-too-large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch (error) {
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

/**
 * Register the snapshot route.
 * @param ctx - the Host plugin context.
 */
export function apply(ctx) {
  const stored = readStoredSnapshot()
  const storedAt = stored === null ? 0 : Date.parse(stored.generatedAt ?? '')
  const cache = {
    at: Number.isFinite(storedAt) ? storedAt : 0,
    value: stored,
    refreshing: false,
  }
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: ROUTE,
    handler: async (req, res) => {
      if (!isLoopback(req)) {
        sendJson(res, 403, { ok: false, code: 'loopback-only' })
        return
      }
      const refresh = new URL(req.url ?? ROUTE, 'http://localhost').searchParams.get('refresh') === '1'
      const answer = await answerSnapshot(ctx.deepseekAccount, refresh, cache)
      sendJson(res, answer.status, answer.body)
    },
  }), 'deepseek-usage-stats: data route')

  // Reports are written by the Host: a browser folder picker is not available in
  // this shell, and this way the browser never needs a save dialog at all.
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: REPORT_ROUTE,
    handler: async (req, res) => {
      if (!isLoopback(req)) {
        sendJson(res, 403, { ok: false, code: 'loopback-only' })
        return
      }
      if (req.method !== 'POST') {
        sendJson(res, 405, { ok: false, code: 'post-only' })
        return
      }
      let payload
      try {
        payload = await readJsonBody(req, 64 * 1024 * 1024)
      } catch {
        sendJson(res, 400, { ok: false, code: 'bad-body' })
        return
      }
      const name = typeof payload?.name === 'string' ? payload.name : ''
      const dataUrl = typeof payload?.dataUrl === 'string' ? payload.dataUrl : ''
      if (!/^[A-Za-z0-9._-]{1,120}\.png$/.test(name)) {
        sendJson(res, 400, { ok: false, code: 'bad-name' })
        return
      }
      const prefix = 'data:image/png;base64,'
      if (!dataUrl.startsWith(prefix)) {
        sendJson(res, 400, { ok: false, code: 'bad-data' })
        return
      }
      try {
        const requested = typeof payload?.directory === 'string' ? payload.directory : ''
        const directory = isAbsolutePath(requested) ? requested : join(dirname(cacheFilePath()), 'reports')
        mkdirSync(directory, { recursive: true })
        const target = join(directory, name)
        writeFileSync(target, Buffer.from(dataUrl.slice(prefix.length), 'base64'))
        sendJson(res, 200, { ok: true, path: target })
      } catch (error) {
        sendJson(res, 500, { ok: false, code: 'write-failed', message: String(error?.message ?? error) })
      }
    },
  }), 'deepseek-usage-stats: report route')

  // The native picker runs in the Host process: the browser half has no access to
  // one here, and this also lets the user choose where reports land.
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: PICK_ROUTE,
    handler: async (req, res) => {
      if (!isLoopback(req)) {
        sendJson(res, 403, { ok: false, code: 'loopback-only' })
        return
      }
      const dialog = await loadDialog()
      if (dialog !== null && typeof dialog.showOpenDialog === 'function') {
        try {
          const result = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
          if (result.canceled || result.filePaths.length === 0) {
            sendJson(res, 200, { ok: false, code: 'canceled' })
            return
          }
          sendJson(res, 200, { ok: true, path: result.filePaths[0] })
        } catch (error) {
          sendJson(res, 200, { ok: false, code: 'picker-failed', message: String(error?.message ?? error) })
        }
        return
      }
      const picked = await pickFolderWithPowerShell()
      if (picked === null) {
        sendJson(res, 200, { ok: false, code: 'canceled' })
        return
      }
      sendJson(res, 200, { ok: true, path: picked })
    },
  }), 'deepseek-usage-stats: folder picker')
}
