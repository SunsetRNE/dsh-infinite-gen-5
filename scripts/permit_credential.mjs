#!/usr/bin/env node
// 凭据来源许可 CLI —— 把「授权代理」从三个字变成可核的一件东西
//
//   node scripts/permit_credential.mjs --kind=self
//   node scripts/permit_credential.mjs --kind=authorized --grantor=CUSTOMER --purpose=客户验收 \
//     --issued=2026-10-01 --until=2026-12-31 --grant-file=/path/授权书.pdf
//   # 想复核既有指纹是否还对得上当前文件：
//   node scripts/permit_credential.mjs --kind=authorized ... --grant-ref=<64hex> --grant-file=/path/授权书.pdf
//
// 它会：① 读授权文件算 sha256；② 若同时给了 --grant-ref，则比对（不一致 → stale，直接拒）；
//       ③ 把三件套 + 签发日 + 指纹交给判决函数；④ 打印判决与回执（含指纹前缀）。

import { createHash } from 'node:crypto'
import { readFileSync, existsSync, statSync } from 'node:fs'
import { credentialPermit, MAX_GRANT_DAYS } from '../data/credential-permit.mjs'

const argv = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, '').split('=')
  return [k, v === undefined ? true : v]
}))

const sha256Of = (p) => createHash('sha256').update(readFileSync(p)).digest('hex')

let grantRef = typeof argv['grant-ref'] === 'string' ? argv['grant-ref'] : undefined
let stale = false
let fileInfo = null
const file = typeof argv['grant-file'] === 'string' ? argv['grant-file'] : undefined
if (file) {
  if (!existsSync(file)) {
    console.log(JSON.stringify({ ok: false, error: `授权文件不存在：${file}` }, null, 0))
    process.exit(2)
  }
  const sha = sha256Of(file)
  fileInfo = { file, sha256: sha, bytes: statSync(file).size }
  if (grantRef && grantRef !== sha) { stale = true } else if (!grantRef) { grantRef = sha }
}

const verdict = credentialPermit({
  kind: argv.kind, grantor: argv.grantor, purpose: argv.purpose,
  issuedAt: argv.issued, until: argv.until, grantRef, stale,
  subject: argv.subject, fixture: argv.fixture === true,
})

console.log(JSON.stringify({
  tool: 'permit-credential', ts: new Date().toISOString(),
  kind: argv.kind, grantFile: fileInfo, maxGrantDays: MAX_GRANT_DAYS,
  verdict,
}, null, 2))
process.exit(verdict.allow ? 0 : 2)
