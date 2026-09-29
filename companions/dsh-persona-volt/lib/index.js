/**
 * @volt/dsh-persona-volt — runtime persona section.
 *
 * 形态：真 Cordis 插件（inject + apply + Config），不是声明式 bundle。
 *
 * 为什么用运行时 section 而不是 patch 覆盖 config.persona：
 *   patch 走 `- id: system-prompt` 覆盖行 config —— 装完还需要这行 patch 被加载。
 *   本插件走 `ctx.systemPrompt.section()` —— apply() 是插件生命周期钩子，
 *   只要插件在 dsh.profile.bundles 里，apply() 就自动执行、section 自动注册。
 *   **接入即生效，不依赖任何额外配置。**
 *
 * section 名的选择（已对 dsh-system-prompt 源码实证）：
 *   - `deployment:persona` 已被 @deepseek-ai/dsh-system-prompt 无条件注册，
 *     同层重名会 throw（NamedEntries 保护）。不能占。
 *   - 官方自己的 @deepseek-ai/dsh-app-boot 就用自定义名 `harness:source` +
 *     order -99 往全局 prompt 加内容 —— 同样手法，官方背书。
 *   - 本插件用 `volt:persona` + order -98：
 *     harness:identity(-100) → harness:source(-99) → volt:persona(-98) → persona(0)
 *     人格正文因此在部署 persona 之前落位，优先级更高。
 *
 * @module @volt/dsh-persona-volt
 */

import z from '@deepseek-ai/schemastery';

/**
 * Cordis 插件名。
 */
const name = 'volt-persona';

/** 依赖的 Cordis 服务：本行只贡献 system prompt，需要 systemPrompt 服务在场。 */
const inject = ['systemPrompt'];

/** 本插件注册的 prompt section 名（独立命名，不与官方 persona 槽冲突）。 */
const VOLT_SECTION = 'volt:persona';

/**
 * 落位序号。必须在 harness:identity(-100) / harness:source(-99) 之后、
 * deployment persona(0) 之前 —— 越小的 order 越靠前。
 */
const VOLT_ORDER = -98;

/**
 * 插件配置 schema。
 *
 * 必须是 schemastery 的 schema 实例（带 .validate()），不是纯对象 ——
 * Cordis 的 resolveConfig 会调 config-schema.validate() 做校验与默认值填充。
 * 传纯对象会在 resolveConfig 里抛 "Cannot read properties of undefined (reading 'validate')"。
 * 官方 @deepseek-ai/dsh-persona 同款写法。
 */
const Config = z.object({
  text: z.string().required(),
});

/**
 * 挂载 VOLT persona section。
 *
 * 用 ctx.effect() 包裹注册，确保插件卸载/patch 热重载时 section 被正确 disposer 回收
 * （官方 dsh-persona 与 dsh-app-boot 同款写法）。
 *
 * @param {object} ctx - Cordis 上下文，需已注入 systemPrompt 服务。
 * @param {{ text: string }} config - 人格正文。
 */
export function apply(ctx, config) {
  ctx.effect(
    () =>
      ctx.systemPrompt.section({
        name: VOLT_SECTION,
        order: VOLT_ORDER,
        text: config.text,
      }),
    'volt-persona.section()',
  );
}

export { Config, name, inject, VOLT_ORDER, VOLT_SECTION };
