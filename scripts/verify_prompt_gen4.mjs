// ⚠️ 遗留重定向（legacy redirect）— 本文件已更名为 verify_prompt_gen5.mjs。
// 保留此文件只为让旧命令 `node scripts/verify_prompt_gen4.mjs` 继续可用，
// 断言逻辑已 100% 迁移到新文件，此处不含任何独立断言。
console.warn(
  "[deprecated] scripts/verify_prompt_gen4.mjs 已更名为 scripts/verify_prompt_gen5.mjs，请改用新路径。",
);
await import("./verify_prompt_gen5.mjs");
