#!/usr/bin/env node
// 伴侣身份生成器门禁：验证自定义身份元数据、persona 注入和输出文件完整性。
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const out = join(root, '.tmp-companion-verify')
rmSync(out, { recursive: true, force: true })
try {
  execFileSync(process.execPath, ['scripts/generate-companion-bundle.mjs'], {
    cwd: root,
    env: { ...process.env, COMPANION_ID: 'verify-companion', COMPANION_NAME: '验证身份', COMPANION_OUTPUT: out },
    stdio: 'pipe',
  })
  for (const file of ['package.json', 'identity.json', 'companion-plugins.json', 'cordis.patch.yml', 'index.js']) {
    if (!existsSync(join(out, file))) throw new Error(`生成结果缺少 ${file}`)
  }
  const pkg = JSON.parse(readFileSync(join(out, 'package.json'), 'utf8'))
  const identity = JSON.parse(readFileSync(join(out, 'identity.json'), 'utf8'))
  const plugins = JSON.parse(readFileSync(join(out, 'companion-plugins.json'), 'utf8'))
  if (pkg.name !== '@local/dsh-verify-companion-identity') throw new Error(`package name 错误：${pkg.name}`)
  if (identity.id !== 'verify-companion' || identity.displayName !== '验证身份') throw new Error('identity 元数据错误')
  if (plugins[0]?.name !== '@deepseek-ai/dsh-persona' || plugins[0]?.config?.prefix !== identity.prefix) throw new Error('persona 注入未同步')
  console.log('伴侣身份生成器自检通过')
} finally {
  rmSync(out, { recursive: true, force: true })
}
