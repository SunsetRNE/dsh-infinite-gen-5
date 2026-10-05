#!/usr/bin/env node
// 伴侣身份 bundle 生成器：根据环境变量生成可安装 preset 与压缩包输入目录。
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const out = resolve(process.env.COMPANION_OUTPUT ?? join(root, 'dist', 'companion-identity-bundle'))
const value = (name, fallback = '') => process.env[name] || fallback
const textValue = (name, fallback = '') => value(name, fallback).replaceAll('\\n', '\n').replaceAll('\\r', '\r')
const id = value('COMPANION_ID', 'companion')
const displayName = value('COMPANION_NAME', '伴侣身份')
const description = value('COMPANION_DESCRIPTION', '温柔、可靠、主动协作的可切换身份。')
const prefix = textValue('COMPANION_PREFIX', `你是“${displayName}”助手：温柔、可靠、主动协作，提供连贯而有沉浸感的陪伴式互动；优先帮助用户完成当前任务。\n\n【关系设定】\n- 尊重用户指定的关系与互动设定，保持自然、连续的陪伴式表达。`)
// suffix 默认保留 {{cwd}} 模板，由宿主在当前会话/agent scope 渲染实际工作目录；只有显式设置 COMPANION_SUFFIX 才覆盖它。
const suffix = textValue('COMPANION_SUFFIX', '你的工作目录是 {{cwd}}。')
if (!/^[a-z0-9-]{2,40}$/.test(id)) throw new Error('COMPANION_ID 必须是 2-40 位小写字母、数字或短横线')
if (!displayName.trim() || !prefix.trim()) throw new Error('身份名称和 prefix 不能为空')

const plugin = (id, name, config) => ({ id, name, ...(config === undefined ? {} : { config }) })
const plugins = [
  plugin('persona', '@deepseek-ai/dsh-persona', { suffix, prefix }),
  plugin('agent-instructions', '@deepseek-ai/dsh-agent-instructions', { maxBytes: 65536 }),
  plugin('time-context', '@deepseek-ai/dsh-time-context'),
  plugin('tool-bash', '@deepseek-ai/dsh-tool-bash', undefined),
  plugin('tool-pwsh', '@deepseek-ai/dsh-tool-pwsh', undefined),
  plugin('tool-fs', '@deepseek-ai/dsh-tool-fs'),
  plugin('tool-fs-search', '@deepseek-ai/dsh-tool-fs-search', { sampleOverCapGlobResults: false }),
  plugin('tool-jobs', '@deepseek-ai/dsh-tool-jobs'),
  plugin('tool-schedule', '@deepseek-ai/dsh-tool-schedule'),
  plugin('skill-filesystem', '@deepseek-ai/dsh-skill-filesystem'),
  plugin('tool-skill', '@deepseek-ai/dsh-tool-skill'),
  plugin('command-goal', '@deepseek-ai/dsh-command-goal'),
  plugin('tool-goal', '@deepseek-ai/dsh-tool-goal'),
  plugin('tool-ask-user', '@deepseek-ai/dsh-tool-ask-user'),
  plugin('tool-todo', '@deepseek-ai/dsh-tool-todo', { allowParallelInProgress: true }),
  plugin('tool-web', '@deepseek-ai/dsh-tool-web', { fetch: true, searchTimeoutMs: 60000 }),
  plugin('present', '@deepseek-ai/dsh-tool-present'),
]
rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
writeFileSync(join(out, 'package.json'), JSON.stringify({
  name: `@local/dsh-${id}-identity`, version: '1.0.0', private: true, type: 'module',
  description, exports: { '.': './index.js', './package.json': './package.json' },
  dsh: { bundle: { patch: './cordis.patch.yml' } },
}, null, 2) + '\n')
writeFileSync(join(out, 'index.js'), 'export function apply() {}\n')
writeFileSync(join(out, 'identity.json'), JSON.stringify({ id, displayName, description, prefix, suffix }, null, 2) + '\n')
writeFileSync(join(out, 'companion-plugins.json'), JSON.stringify(plugins, null, 2) + '\n')
writeFileSync(join(out, 'cordis.patch.yml'), `- insert:\n    - id: preset-${id}\n      name: '@deepseek-ai/dsh-agent-preset'\n      config:\n        id: ${id}\n        name: ${JSON.stringify(displayName)}\n        description: ${JSON.stringify(description)}\n        order: 20\n        plugins:\n          - id: identity-plugin-list\n            name: cordis:include\n            config:\n              path: ./companion-plugins.json\n`)
writeFileSync(join(out, 'README.md'), `# ${displayName}\n\n${description}\n\n由 GitHub Actions 根据仓库身份配置生成。preset id：\`${id}\`。\n`)
console.log(`generated ${out}`)
