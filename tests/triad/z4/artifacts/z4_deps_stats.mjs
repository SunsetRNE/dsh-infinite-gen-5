#!/usr/bin/env node
// z4_deps_stats.mjs — 依赖面计数（零依赖）
// 输入：npm ls --all --json 的输出 + 项目 package.json
// 输出：总数 / 直接 / 传递 / 重复版本组，全部来自实测 JSON，不做推测
import { readFileSync, existsSync } from 'node:fs';

const lsPath = process.argv[2] || '/tmp/z4-npm-ls.json';
const pkgPath = process.argv[3] || './package.json';

if (!existsSync(lsPath)) {
  console.log(`状态: INPUT_MISSING — 未找到 ${lsPath}；先跑 npm ls --all --json > ${lsPath}`);
  process.exit(2);
}

const ls = JSON.parse(readFileSync(lsPath, 'utf8'));
const pkg = existsSync(pkgPath) ? JSON.parse(readFileSync(pkgPath, 'utf8')) : {};

const directNames = new Set([
  ...Object.keys(pkg.dependencies || {}),
  ...Object.keys(pkg.devDependencies || {}),
  ...Object.keys(pkg.optionalDependencies || {}),
  ...Object.keys(pkg.peerDependencies || {}),
]);

// 展平 npm ls 树；npm v7+ 对无依赖项目只回 {name, version}，无 dependencies 键
const seen = [];
const walk = (node, path) => {
  if (typeof node !== 'object' || node === null) return;
  const children = node.dependencies || {};
  for (const [name, child] of Object.entries(children)) {
    const full = path ? `${path}>${name}` : name;
    seen.push({ name, version: child && child.version ? child.version : null, depth: full.split('>').length });
    walk(child, full);
  }
};
walk(ls, '');

const total = seen.length;
const direct = seen.filter((d) => d.depth === 1).length;
const transitive = total - direct;

const byVer = new Map();
for (const d of seen) {
  if (!d.version) continue;
  if (!byVer.has(d.version)) byVer.set(d.version, new Set());
  byVer.get(d.version).add(d.name);
}
const dupGroups = [...byVer.entries()].filter(([, s]) => s.size > 1);

// npm ls JSON 顶层 keys，用来判定「空树」是真实的空还是被裁剪
const topKeys = Object.keys(ls).sort();

console.log(JSON.stringify({
  源文件: lsPath,
  npmLs顶层键: topKeys,
  树中出现过dependencies键: 'dependencies' in ls,
  依赖总数: total,
  直接依赖: direct,
  传递依赖: transitive,
  packageJson直接声明数: directNames.size,
  packageJson直接依赖名: [...directNames],
  重复版本组: dupGroups.length,
  重复版本明细: dupGroups.map(([v, s]) => ({ version: v, 包: [...s] })),
}, null, 2));
