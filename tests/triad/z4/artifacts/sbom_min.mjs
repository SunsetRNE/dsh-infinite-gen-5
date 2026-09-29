#!/usr/bin/env node
// sbom_min.mjs — 最小 SPDX 风格 SBOM 生成器（零依赖，Node 20+）
// 定位：syft 不可用时的降级路径。读 package-lock.json，输出 name/version/integrity 三列。
// 用法：
//   node sbom_min.mjs --lock package-lock.json          # 文本三列表 + 汇总行
//   node sbom_min.mjs --selftest                        # 内置 fixture 断言，退出码 0=通过 1=失败
// 退出码：0 成功 / 1 自检失败 / 3 锁文件缺失（ENOLOCK 等价降级态）
import { readFileSync, existsSync } from 'node:fs';

const argv = process.argv.slice(2);
const getArg = (n, d) => {
  const i = argv.indexOf(n);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
const has = (n) => argv.includes(n);

// ---- 解析：兼容 lockfileVersion 1（嵌套 dependencies）与 2/3（扁平 packages）----
export function parseLock(text, label = 'package-lock.json') {
  let o;
  try {
    o = JSON.parse(text);
  } catch (e) {
    throw new Error(`${label}: JSON 解析失败 — ${e.message}`);
  }
  const out = [];
  const push = (name, meta) => {
    if (!name || name === '') return; // 根条目不算组件
    out.push({
      name,
      version: meta && meta.version ? String(meta.version) : null,
      integrity: meta && meta.integrity ? String(meta.integrity) : null,
      resolved: meta && meta.resolved ? String(meta.resolved) : null,
      dev: !!(meta && meta.dev),
    });
  };
  if (o.packages && typeof o.packages === 'object') {
    for (const [key, meta] of Object.entries(o.packages)) {
      if (key === '') continue; // "" 是根包，不是组件
      const name = key.includes('node_modules/') ? key.slice(key.lastIndexOf('node_modules/') + 'node_modules/'.length) : key;
      push(name, meta);
    }
  } else if (o.dependencies && typeof o.dependencies === 'object') {
    const walk = (deps) => {
      for (const [name, meta] of Object.entries(deps)) {
        push(name, meta);
        if (meta && meta.dependencies) walk(meta.dependencies);
      }
    };
    walk(o.dependencies);
  }
  return out;
}

export function summarize(comps) {
  const noVer = comps.filter((c) => !c.version);
  const noInt = comps.filter((c) => !c.integrity);
  const byName = new Map();
  for (const c of comps) byName.set(c.name, (byName.get(c.name) || 0) + 1);
  const dupNames = [...byName.entries()].filter(([, n]) => n > 1);
  const byVer = new Map();
  for (const c of comps) {
    if (!c.version) continue;
    if (!byVer.has(c.version)) byVer.set(c.version, new Set());
    byVer.get(c.version).add(c.name);
  }
  // 重复版本组 = 同一 version 被 >=2 个不同包名占用
  const dupVerGroups = [...byVer.entries()].filter(([, names]) => names.size > 1);
  return {
    components: comps.length,
    withIntegrity: comps.length - noInt.length,
    integrityMissing: noInt.length,
    resolvedMissing: comps.filter((c) => !c.resolved).length,
    versionMissing: noVer.length,
    duplicateNameEntries: dupNames.length,
    duplicateVersionGroups: dupVerGroups.length,
    duplicateVersionMembers: dupVerGroups.reduce((a, [, s]) => a + s.size, 0),
  };
}

function render(comps, s, label) {
  const w = Math.max(4, ...comps.map((c) => c.name.length));
  const lines = [];
  lines.push(`# SPDX 风格最小清单 — ${label}`);
  lines.push(`SPDXID: SPDXRef-DOCUMENT | PackageCount: ${s.components} | 生成器: sbom_min.mjs`);
  lines.push(`${'NAME'.padEnd(w)} | VERSION | INTEGRITY`);
  lines.push(`${'-'.repeat(w)}-+---------+----------`);
  for (const c of comps) {
    lines.push(`${c.name.padEnd(w)} | ${(c.version || '(未知)').padEnd(7)} | ${c.integrity || '(缺失)'}`);
  }
  lines.push('');
  lines.push(
    `汇总: 组件=${s.components} 含integrity=${s.withIntegrity} integrity缺失=${s.integrityMissing} ` +
      `resolved缺失=${s.resolvedMissing} 缺版本=${s.versionMissing} 重复版本组=${s.duplicateVersionGroups}`
  );
  return lines.join('\n');
}

// ---- 内置 fixture 自检：断言组件数、字段齐、根条排除、嵌套名解析、重复版本组 ----
const FIXTURE = {
  name: 'fixture-root',
  version: '9.9.9',
  lockfileVersion: 3,
  packages: {
    '': { name: 'fixture-root', version: '9.9.9' }, // 根包：必须被排除
    'node_modules/alpha': { version: '1.0.0', integrity: 'sha512-ALPHA_FIXTURE', resolved: 'https://registry.invalid/alpha' },
    'node_modules/beta': { version: '2.0.0', integrity: 'sha512-BETA_FIXTURE', resolved: 'https://registry.invalid/beta' },
    'node_modules/beta/node_modules/gamma': { version: '0.1.0' }, // 嵌套 + integrity 缺失
    'node_modules/delta': { version: '1.0.0', integrity: 'sha512-DELTA_FIXTURE' },
    'node_modules/epsilon': { version: '1.0.0', integrity: 'sha512-EPSILON_FIXTURE' },
  },
};

export function selftest() {
  const comps = parseLock(JSON.stringify(FIXTURE), 'fixture-lock.json');
  const s = summarize(comps);
  const names = comps.map((c) => c.name);
  const checks = [
    ['组件数=5（根包被排除）', s.components, 5],
    ['根包 "" 未计入', names.includes('fixture-root') || names.includes(''), false],
    ['嵌套名解析为 gamma', names.includes('gamma'), true],
    ['integrity 缺失数=1', s.integrityMissing, 1],
    ['字段齐全（无缺 version）', s.versionMissing, 0],
    ['重复版本组=1（1.0.0 三名）', s.duplicateVersionGroups, 1],
    ['重复版本组成员数=3', s.duplicateVersionMembers, 3],
  ];
  let fail = 0;
  for (const [label, actual, expected] of checks) {
    const ok = actual === expected;
    if (!ok) fail++;
    console.log(`${ok ? 'PASS' : 'FAIL'} | ${label} | 实测=${JSON.stringify(actual)} 期望=${JSON.stringify(expected)}`);
  }
  console.log(`--selftest: ${checks.length - fail}/${checks.length} 断言通过，退出码 ${fail ? 1 : 0}`);
  return fail ? 1 : 0;
}

function main() {
  if (has('--selftest')) process.exit(selftest());
  const lock = getArg('--lock', 'package-lock.json');
  if (!existsSync(lock)) {
    console.log(`状态: LOCKFILE_MISSING — 未找到 ${lock}`);
    console.log('组件数: 0（无法从锁文件枚举；不等于「无依赖」，只表示无锁文件可读）');
    console.log('降级: 无锁文件时改用 syft dir:. -o cyclonedx-json=OUT 做源码面枚举');
    process.exit(3);
  }
  const comps = parseLock(readFileSync(lock, 'utf8'), lock);
  const s = summarize(comps);
  console.log(render(comps, s, lock));
  process.exit(0);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
