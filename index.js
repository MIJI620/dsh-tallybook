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
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/** Cordis plugin name. */
export const name = 'deepseek-usage-stats'

/** The account service owns the Platform credential; webServer exposes the route. */
export const inject = ['deepseekAccount', 'webServer']

/** Snapshot route; the browser half builds the same constant. */
const ROUTE = '/api/deepseek-usage/data'

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
    return parsed !== null && typeof parsed === 'object' && parsed.ok === true ? parsed : null
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
}
