// 无限五代 · 发布工件（Release Artifact）
//
// 借的是 gpt-instruct 的**协议**，不是它的素材：
//   - 版本档案（zip / 单文件 markdown），每个归档自带 SHA256
//   - 部署前后快照 + 字段级回滚（只动自己写的那个键）
//   - A / B / C 三级门禁，每级有硬门槛与判据
//   - 「不跨身份拼接成绩」：模型 / 推理等级 / 载体任一不同，结果不可比
//
// 本文件只做工件与门禁的**纯函数**部分，不碰任何宿主的配置写法（那是适配层的事）。

import { createHash } from "node:crypto";

export function sha256(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** 门禁三级：级别 → 判据。判据是字符串，必须能被 verify 脚本逐条断言。 */
export const GATES = Object.freeze({
  A: {
    id: "A",
    name: "静态门禁",
    require: [
      "内核与惰性章节自洽：每条常驻指针都有对应 unit",
      "惰性 unit 的 order 唯一且都有触发词",
      "编译产物指纹在本轮构建内可复现（同输入两次构建字节一致）",
      "适配器契约校验 0 错误",
      "常驻字节 ≤ 宿主预算",
    ],
  },
  B: {
    id: "B",
    name: "行为门禁",
    require: [
      "五态注入：宿主缺任一能力位时，降级动作有明确定义而非静默失效",
      "同源去重：宿主内已存在同源载荷时，让位且不重复计费",
      "首行即名：产出首行是 ## 标题或代码围栏",
      "双块在场：可跑实现 + 验证命令两块齐全",
      "四态在场：带时间/版本断言的回答末尾有四行校准",
    ],
  },
  C: {
    id: "C",
    name: "回归门禁",
    require: [
      "同模型 + 同推理等级 + 同载体下对比，禁止跨身份拼接",
      "逐题回执四态（deliver / pivot / boundary / miss），同题多份只取第一条",
      "边界层的题只读位置、不计产量",
      "真实模型失败与网络/容量/账号中断分开记录",
    ],
  },
});

export const ARTIFACT_SCHEMA = 1;

/**
 * 生成发布工件。extra 里任何值都会被算进 digest ——
 * 这样「换了目标目录」也算一次真实变更，不会出现两份内容不同却同 digest 的归档。
 */
export function buildArtifact({ id, kernelVersion, payload, extra = {}, targetVersion }) {
  const payloadSha = sha256(payload);
  const extraCanonical = JSON.stringify(extra, Object.keys(extra).sort());
  return Object.freeze({
    schema: ARTIFACT_SCHEMA,
    id,
    kernelVersion,
    targetVersion: targetVersion ?? null,
    payloadBytes: Buffer.byteLength(payload, "utf8"),
    payloadSha256: payloadSha,
    extraSha256: sha256(extraCanonical),
    digest: sha256(`${id}\u0001${kernelVersion}\u0001${payloadSha}\u0001${sha256(extraCanonical)}`),
    gates: Object.fromEntries(Object.values(GATES).map((g) => [g.id, { name: g.name, require: g.require }])),
  });
}

export function serializeArtifact(artifact) {
  return `${JSON.stringify(artifact, null, 2)}\n`;
}

/**
 * 校验工件：拿实际载荷重新算一遍，任何不一致都列出来。
 * 这是「发布前 A 级门禁」的可执行部分 —— 不带证据的归档不允许发出。
 */
export function verifyArtifact(artifact, payload) {
  const problems = [];
  if (!artifact || typeof artifact !== "object") return ["工件不是对象"];
  if (artifact.schema !== ARTIFACT_SCHEMA) problems.push(`schema 应为 ${ARTIFACT_SCHEMA}，实为 ${artifact.schema}`);
  if (!artifact.digest || !/^[0-9a-f]{64}$/.test(artifact.digest)) problems.push("digest 不是 64 位十六进制");

  const actualBytes = Buffer.byteLength(payload, "utf8");
  if (actualBytes !== artifact.payloadBytes) {
    problems.push(`payloadBytes 不符：声明 ${artifact.payloadBytes}，实测 ${actualBytes}`);
  }
  const actualSha = sha256(payload);
  if (actualSha !== artifact.payloadSha256) {
    problems.push(`payloadSha256 不符：声明 ${String(artifact.payloadSha256).slice(0, 12)}，实测 ${actualSha.slice(0, 12)}`);
  }
  const expectedDigest = sha256(
    `${artifact.id}\u0001${artifact.kernelVersion}\u0001${artifact.payloadSha256}\u0001${artifact.extraSha256}`,
  );
  if (expectedDigest !== artifact.digest) problems.push("digest 与本工件其余字段不匹配（被改过）");
  for (const gate of Object.values(GATES)) {
    if (!artifact.gates || !artifact.gates[gate.id]) problems.push(`缺少门禁声明 ${gate.id}`);
  }
  return problems;
}

/** 快照 + 字段级回滚的最小实现：只记录自己写过的键，回滚时只还原那一个键。 */
export function makeRollback({ key, previous, written }) {
  return Object.freeze({
    key,
    previous: previous ?? null,
    written,
    plan: previous == null ? `回滚：删除 ${key}` : `回滚：把 ${key} 还原为 ${JSON.stringify(previous)}`,
  });
}

/** 身份元组：门禁 C 的可比性判据。三要素任一不同 → 成绩不可比。 */
export function identityOf({ model, reasoning, carrier }) {
  if (!model || !reasoning || !carrier) throw new Error("identity 需要 model / reasoning / carrier 三要素");
  return Object.freeze({ model, reasoning, carrier, tuple: `${model}|${reasoning}|${carrier}` });
}

export function comparable(a, b) {
  return identityOf(a).tuple === identityOf(b).tuple;
}
