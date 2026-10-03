#!/usr/bin/env node
// 授权凭据档 CLI
//   npm run grants -- add    --grantor=CUSTOMER --purpose=客户验收 --issued=2026-10-01 --until=2026-12-31 --grant-file=/path/授权书.pdf
//   npm run grants -- list
//   npm run grants -- check                      # 逐份复核：ok / expired / not-yet / fingerprint-mismatch / file-missing
//   npm run grants -- pick --purpose=客户验收     # 挑一份当前可用的并给出判决（退出码 0/2）
//
// 存放位置：IG5_GRANT_STORE（默认 ~/.dsh/ig5-grants.json）。

import { loadStore, saveStore, addGrant, verifyStore, pickGrant, DEFAULT_STORE } from '../data/grant-store.mjs'

const argv = process.argv.slice(2)
const cmd = argv[0]
const kv = Object.fromEntries(argv.slice(1).map((a) => {
  const [k, v] = a.replace(/^--/, '').split('=')
  return [k, v === undefined ? true : v]
}))

const ICON = { ok: '✅', expired: '⌛️', 'not-yet': '🕗', 'fingerprint-mismatch': '❌', 'file-missing': '❓', unverifiable: '⚠️' }
const line = (g) => `  ${ICON[g.status] || '•'} ${String(g.id).padEnd(26)} ${g.status.padEnd(20)} ${g.issuedAt}→${g.until}  ${g.purpose || ''}`

if (cmd === 'add') {
  const store = loadStore()
  const res = addGrant(store, {
    grantor: kv.grantor, purpose: kv.purpose, kind: kv.kind || 'authorized',
    issuedAt: kv.issued, until: kv.until, file: kv['grant-file'], sha256: kv.sha256, subject: kv.subject, id: kv.id,
  })
  if (!res.ok) { console.log(JSON.stringify(res)); process.exit(2) }
  saveStore(res.store)
  console.log(JSON.stringify({ ok: true, store: DEFAULT_STORE, grant: res.grant, windowDays: res.windowDays }, null, 0))
  process.exit(0)
}
if (cmd === 'list' || cmd === 'check') {
  const store = loadStore()
  const { rows, active } = verifyStore(store)
  console.log(`授权凭据档：${DEFAULT_STORE}（${rows.length} 份，可用 ${active.length} 份）`)
  for (const g of rows) console.log(line(g))
  process.exit(0)
}
if (cmd === 'pick') {
  const r = pickGrant(loadStore(), { purpose: kv.purpose, kind: kv.kind })
  console.log(JSON.stringify(r, null, 2))
  process.exit(r.ok ? 0 : 2)
}
console.log('用法：add | list | check | pick（加 --help 看注释顶部）')
process.exit(1)
