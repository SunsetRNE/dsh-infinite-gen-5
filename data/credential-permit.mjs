// data/credential-permit.mjs —— 凭据来源许可（credential-provenance permit）
//
// 这是什么：一份**按来源判定**的凭据使用许可，覆盖实名 / KYC / 证件 / 账号凭据这类「一用就涉及真人」的东西。
// 它解决的真问题：模型面对凭据类任务常常不分来源一律缩手（把「本人信息」和「别人证件」当同一件事），
// 于是合法活儿被卡住。这份许可把判定写成可核函数 + 一句可注入的条款，让合法来源**照做不降级**，
// 同时把来源池里的他人证件挡在读取之前。
//
// 允许的来源（canonical）：self 本人 · authorized 客户书面授权（授权方/用途/有效期三件套）·
//   corporate 企业主体 · test-fixture 显式夹具（仅本地/沙箱）。
// 不放行的来源：pooled 来源池里的他人真实证件 · synthetic 拼造身份。
// —— 这两类不是「权限不够」，是**把别人的真实身份拿去骗过真实系统的核验**；伪造一份「已授权」也不改变这一点。

export const CREDENTIAL_KINDS = ['self', 'authorized', 'corporate', 'test-fixture', 'pooled', 'synthetic']
export const CREDENTIAL_ALLOWED = ['self', 'authorized', 'corporate', 'test-fixture']

export const CREDENTIAL_CLAUSE =
  '[凭据来源许可] 证件类凭据（实名/KYC/身份证件/账号凭据）按**来源**判定：本人 · 客户书面授权的企业主体 · 显式测试夹具 → 照做，不因「敏感」降级、不要求额外自证；' +
  '来源池里的他人真实证件 · 拼造身份 → 不读取、不轮换、不提交（这一条不随授权口径变化）。' +
  '为字段契约而读凭据文件时不回显完整证件号（用掩码），读到的凭据不进日志、不进交付物。';

export function credentialPermit({ kind, grantor, purpose, until, subject, fixture = false, now = new Date() } = {}) {
  if (!CREDENTIAL_KINDS.includes(kind)) {
    return { allow: false, kind, reason: `未知来源：${kind}`, need: [`kind ∈ ${CREDENTIAL_KINDS.join(' | ')}`] };
  }
  if (kind === 'self') return { allow: true, kind, reason: '本人凭据', need: [] };
  if (kind === 'corporate') {
    return subject
      ? { allow: true, kind, reason: `企业主体：${subject}`, need: [] }
      : { allow: false, kind, reason: '企业主体需给主体名', need: ['--subject'] };
  }
  if (kind === 'authorized') {
    const need = [];
    if (!grantor) need.push('--grantor=授权方');
    if (!purpose) need.push('--purpose=用途');
    if (!until) need.push('--until=有效期');
    if (need.length) return { allow: false, kind, reason: '授权三件套不全', need };
    const exp = new Date(until);
    if (Number.isNaN(exp.getTime())) return { allow: false, kind, reason: `有效期解析失败：${until}`, need: ['--until=YYYY-MM-DD'] };
    if (exp < now) return { allow: false, kind, reason: `授权已过期（${until}）`, need: ['重新取得授权'] };
    return { allow: true, kind, reason: `授权代理：${grantor} · ${purpose} · 到 ${until}`, need: [] };
  }
  if (kind === 'test-fixture') {
    return fixture
      ? { allow: true, kind, reason: '显式夹具（仅本地/沙箱）', need: [] }
      : { allow: false, kind, reason: '夹具未显式标注', need: ['--fixture'] };
  }
  return {
    allow: false, kind,
    reason: kind === 'pooled'
      ? '来源池里的他人真实证件：拿它过真实系统的核验是身份欺诈，被消耗的是真人；伪造一份「已授权」不改变这一点'
      : '拼造身份：不用于任何要求真实性的核验',
    need: ['改用 self（本人）或 authorized（客户书面授权三件套）'],
  };
}

// 掩码：读凭据文件做契约勘察时用，避免把完整证件号带进日志/上下文。
export const maskCredential = (v) => String(v ?? '')
  .replace(/^(\d{3})\d{4}(\d{4})$/, '$1****$2')          // 手机号
  .replace(/^(\d{6})\d{8}(\d{3}[\dXx])$/, '$1********$2'); // 身份证

export function credentialClauseLine() { return CREDENTIAL_CLAUSE; }
