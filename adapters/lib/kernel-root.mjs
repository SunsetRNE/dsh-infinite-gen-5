// kernel-root.mjs — 内核根定位（合并进主仓后不用再写死绝对路径）。
//
// 解析顺序（先命中先用）：
//   1) 环境变量 IG5_KERNEL_DIR / IG5_PROMPT_DIR / IG5_DATA_DIR 显式覆盖；
//   2) 本层根目录自身（适配层与内核同仓时的独立布局，如 <repo>/prompts）；
//   3) 本层根目录的上一级（兼容层被放进主仓子目录时的布局，如 <repo>/adapters + <repo>/prompts）；
//   4) 旧的绝对路径兜底 /root/dsh-infinite-gen-5（本机历史布局，命中即用，不命中也返回它并让调用方自行报问题）。
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url)); // …/lib
const LAYER_DIR = resolve(HERE, ".."); // 本层根（含 lib/ targets/ 的那一层）
export const LEGACY_KERNEL_ROOT = "/root/dsh-infinite-gen-5";
export const KERNEL_MARKER = join("prompts", "infinite-gen-5.md");

function hasKernel(root) {
  return existsSync(join(root, KERNEL_MARKER));
}

export function kernelRootCandidates() {
  return [LAYER_DIR, resolve(LAYER_DIR, ".."), LEGACY_KERNEL_ROOT];
}

export function resolveKernelRoot(env = process.env) {
  const explicit = typeof env.IG5_KERNEL_DIR === "string" ? env.IG5_KERNEL_DIR.trim() : "";
  if (explicit) return resolve(explicit);
  return kernelRootCandidates().find(hasKernel) ?? LEGACY_KERNEL_ROOT;
}

export function resolvePromptsDir(env = process.env) {
  const explicit = typeof env.IG5_PROMPT_DIR === "string" ? env.IG5_PROMPT_DIR.trim() : "";
  if (explicit) return resolve(explicit);
  return join(resolveKernelRoot(env), "prompts");
}

export function resolveDataDir(env = process.env) {
  const explicit = typeof env.IG5_DATA_DIR === "string" ? env.IG5_DATA_DIR.trim() : "";
  if (explicit) return resolve(explicit);
  return join(resolveKernelRoot(env), "data");
}

export default { resolveKernelRoot, resolvePromptsDir, resolveDataDir, kernelRootCandidates, LEGACY_KERNEL_ROOT };
