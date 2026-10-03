// data/grant-store.mjs —— 授权凭据档（可携带、可复核、可自动挑）
//
// 为什么要有它：`authorized` 需要「签发日 + 到期日 + 授权文件 sha256」三样，命令行每次手打既啰嗦又容易抄错。
// 凭据档把一份份授权写成可复核的记录，调用方只问一句「现在该用哪份授权」。
//
// 存放：默认 ~/.dsh/ig5-grants.json，可用 IG5_GRANT_STORE 覆盖。
// 记录形状：{ id, kind, grantor, purpose, issuedAt, until, file, sha256, subject?, note? }
// 状态口径（verifyStore）：ok / expired / not-yet / fingerprint-mismatch / file-missing / unverifiable
//
// 与判决函数的分工：本模块只管「档案与复核」，放行与否仍由 credentialPermit() 说了算。

import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { credentialPermit, MAX_GRANT_DAYS } from './credential-permit.mjs'

export const DEFAULT_STORE = process.env.IG5_GRANT_STORE || join(homedir(), '.dsh', 'ig5-grants.json')
const HEX64 = /^[0-9a-f]{64}$/

export const sha256File = (p) => createHash('sha256').update(readFileSync(p)).digest('hex')

export function loadStore(path = DEFAULT_STORE) {
  if (!existsSync(path)) return { version: 1, grants: [] }
  try { return JSON.parse(readFileSync(path, 'utf8')) } catch { return { version: 1, grants: [], broken: true } }
}
export function saveStore(store, path = DEFAULT_STORE) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(store, null, 2) + '\n', 'utf8')
  return path
}

// 加一份授权：入档前把能判的都判掉（指纹格式、日期顺序、窗口上限）
export function addGrant(store, grant, { sha256Of = sha256File } = {}) {
  const g = { ...grant }
  if (g.file && !g.sha256 && existsSync(g.file)) g.sha256 = sha256Of(g.file)
  if (!g.id) g.id = `${String(g.grantor || 'grant').toLowerCase()}-${g.until || 'na'}`
  if (!HEX64.test(String(g.sha256 || ''))) return { ok: false, error: '缺 sha256（64 位 hex）', need: ['--grant-file 或 --sha256'] }
  // 严格 YYYY-MM-DD：`new Date('01/02/2026')` 这种会被 JS 当美式日期解析通过 —— 必须是这里先卡住。
  const ISO = /^\d{4}-\d{2}-\d{2}$/
  if (!ISO.test(String(g.issuedAt || '')) || !ISO.test(String(g.until || ''))) {
    return { ok: false, error: '签发日/到期日格式应为 YYYY-MM-DD' }
  }
  const iss = new Date(g.issuedAt), exp = new Date(g.until)
  if (Number.isNaN(iss.getTime()) || Number.isNaN(exp.getTime())) return { ok: false, error: '签发日/到期日不是有效日期' }
  if (exp <= iss) return { ok: false, error: '到期日须晚于签发日' }
  const days = Math.round((exp - iss) / 86400000)
  if (days > MAX_GRANT_DAYS) return { ok: false, error: `授权窗口 ${days} 天超过上限 ${MAX_GRANT_DAYS} 天` }
  const grants = (store.grants || []).filter((x) => x.id !== g.id)
  grants.push(g)
  return { ok: true, store: { ...store, version: 1, grants }, grant: g, windowDays: days }
}

// 复核：每份授权当前是什么状态（文件指纹对不上 / 过期 / 未生效 / 文件不在）
export function verifyStore(store, { now = new Date(), sha256Of = sha256File } = {}) {
  const rows = (store.grants || []).map((g) => {
    let status = 'ok'
    const iss = new Date(g.issuedAt), exp = new Date(g.until)
    if (Number.isNaN(iss.getTime()) || Number.isNaN(exp.getTime())) status = 'unverifiable'
    else if (now < iss) status = 'not-yet'
    else if (now > exp) status = 'expired'
    if (status === 'ok' && g.file) {
      if (!existsSync(g.file)) status = 'file-missing'
      else if (sha256Of(g.file) !== g.sha256) status = 'fingerprint-mismatch'
    }
    return { ...g, status }
  })
  return { rows, active: rows.filter((r) => r.status === 'ok'), broken: rows.filter((r) => r.status !== 'ok') }
}

// 挑一份最合适的：优先 purpose 命中，其次到期最晚
export function pickGrant(store, { purpose, now = new Date(), sha256Of = sha256File, kind } = {}) {
  const { active } = verifyStore(store, { now, sha256Of })
  const pool = active.filter((g) => (kind ? g.kind === kind : true))
  if (!pool.length) return { ok: false, error: '没有当前可用的授权（过期 / 未生效 / 指纹对不上 / 文件不在）' }
  const exact = purpose ? pool.filter((g) => g.purpose === purpose) : []
  const list = exact.length ? exact : pool
  list.sort((a, b) => new Date(b.until) - new Date(a.until))
  const g = list[0]
  const verdict = credentialPermit({
    kind: g.kind || 'authorized', grantor: g.grantor, purpose: g.purpose,
    issuedAt: g.issuedAt, until: g.until, grantRef: g.sha256, subject: g.subject, now,
  })
  return { ok: verdict.allow, grant: g, verdict }
}
