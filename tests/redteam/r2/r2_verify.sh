#!/usr/bin/env bash
# r2_verify.sh — 「凭据与密钥面」普查的独立验证件（只读）
# 契约：不复制私钥 / 不导出 cookie / 不联网外发 / 不改权限位 / 不动任何文件
#       输出只含 sha256 前 12 位、字节数、权限位、owner、路径；不打印任何明文秘密
set -uo pipefail
H="${HOME:-/root}"
h12()  { sha256sum -- "$1" 2>/dev/null | cut -c1-12; }
meta() { if [ -e "$1" ]; then
           printf '%s\t%s\t%s\t%s\t%s\n' "$(h12 "$1")" "$(stat -c%s "$1")" "$(stat -c%a "$1")" "$(stat -c%U:%G "$1")" "$1"
         else printf 'ABSENT\t-\t-\t-\t%s\n' "$1"; fi; }
hr() { printf '%s\n' "------------------------------------------------------------"; }

echo "== V0 环境指纹 =="
printf 'uid=%s  kernel=%s  os=%s\n' "$(id -u)" "$(uname -r)" \
  "$(. /etc/os-release 2>/dev/null && echo "$PRETTY_NAME")"

echo; echo "== V1 SSH 面 =="
printf 'dir_mode=%s dir_owner=%s\n' "$(stat -c%a "$H/.ssh")" "$(stat -c%U:%G "$H/.ssh")"
for f in "$H/.ssh/id_ed25519" "$H/.ssh/id_ed25519.pub" "$H/.ssh/known_hosts" "$H/.ssh/known_hosts.old"; do meta "$f"; done
printf 'authorized_keys_entries=%s\n' "$(cat "$H/.ssh/authorized_keys" 2>/dev/null | grep -cvE '^\s*(#|$)')"
printf 'known_hosts_lines=%s  uniq_host_tokens=%s  hashed_host_entries=%s\n' \
  "$(wc -l < "$H/.ssh/known_hosts" 2>/dev/null)" \
  "$(awk '{print $1}' "$H/.ssh/known_hosts" 2>/dev/null | sort -u | wc -l)" \
  "$(grep -c '^|1|' "$H/.ssh/known_hosts" 2>/dev/null)"
printf 'key_type=%s\n' "$(ssh-keygen -l -f "$H/.ssh/id_ed25519" 2>/dev/null | awk '{print $1" "$2" "$NF}')"
if ssh-keygen -y -P '' -f "$H/.ssh/id_ed25519" </dev/null >/dev/null 2>&1; then
  echo "passphrase=NONE"
else
  echo "passphrase=PRESENT_OR_UNREADABLE"
fi

echo; echo "== V2 凭据文件面（固定清单）=="
FIXED=".git-credentials .config/git/credentials .netrc .docker/config.json .npmrc .config/pip/pip.conf .aws/credentials .aws/config .kube/config .pypirc .config/gh/hosts.yml .gem/credentials .vault-token .wget-hsts .curlrc .msmtprc .pgpass .my.cnf .gitconfig"
cred_hits=0
for r in $FIXED; do if [ -e "$H/$r" ]; then cred_hits=$((cred_hits+1)); meta "$H/$r"; fi; done
printf 'cred_hits=%s\n' "$cred_hits"
printf 'gitconfig_url_with_creds=%s  gitconfig_helper=%s\n' \
  "$(git config --file "$H/.gitconfig" --get-regexp 'url\..*\.insteadof' 2>/dev/null | wc -l)" \
  "$(git config --file "$H/.gitconfig" --get credential.helper 2>/dev/null | wc -l)"

echo; echo "== V3 私钥与证书面 =="
find "$H" -maxdepth 6 \
  \( -name node_modules -o -name .git -o -name .cache -o -name .venv -o -name site-packages \) -prune -o \
  -type f \( -name '*.pem' -o -name '*.key' -o -name '*.p12' -o -name '*.jks' -o -name '*.keystore' \
             -o -name 'id_rsa*' -o -name 'id_ed25519*' \) -print 2>/dev/null \
| sort | while read -r f; do meta "$f"; done
printf 'perm_matrix:\n'
find "$H" -maxdepth 6 \
  \( -name node_modules -o -name .git -o -name .cache -o -name .venv -o -name site-packages \) -prune -o \
  -type f \( -name '*.pem' -o -name '*.key' -o -name '*.p12' -o -name '*.jks' -o -name '*.keystore' \
             -o -name 'id_rsa*' -o -name 'id_ed25519*' -o -name '*.pub' \) -print 2>/dev/null \
| xargs -r stat -c '%a %U:%G' | sort | uniq -c | sort -rn
printf 'world_readable:\n'
find "$H" -maxdepth 6 \
  \( -name node_modules -o -name .git \) -prune -o \
  -type f -perm -o=r \( -name '*.pem' -o -name '*.key' -o -name '*.pub' -o -name 'id_ed25519*' -o -name '*.label' \) -print 2>/dev/null

echo; echo "== V4 DSH 面 =="
printf 'dir_mode=%s owner=%s\n' "$(stat -c%a "$H/.dsh")" "$(stat -c%U:%G "$H/.dsh")"
for f in .dsh/.bridge_token .dsh/.credentials.yaml .dsh/.anonymous-user-id .dsh/plugin-activations.json; do meta "$H/$f"; done
printf 'bridge_token: len=%s nonhex_chars=%s\n' \
  "$(wc -c < "$H/.dsh/.bridge_token" 2>/dev/null)" \
  "$(tr -d '0-9a-fA-F\n' < "$H/.dsh/.bridge_token" 2>/dev/null | wc -c)"
printf 'credentials_yaml_field_names=%s\n' \
  "$(grep -oaE '^[[:space:]]*[A-Za-z_][A-Za-z0-9_]*' "$H/.dsh/.credentials.yaml" 2>/dev/null | tr -d ' ' | sort -u | tr '\n' ',' )"
printf 'plugin_activations_top_keys=%s\n' \
  "$(grep -oaE '^[[:space:]]{0,2}"[A-Za-z_]+"' "$H/.dsh/plugin-activations.json" 2>/dev/null | tr -d ' "' | sort -u | tr '\n' ',')"

echo; echo "== V5 环境与历史面 =="
printf 'env_total=%s  secret_like_names=%s\n' \
  "$(env | wc -l)" \
  "$(env | cut -d= -f1 | grep -cEi 'token|secret|passwo?r?d|api_?key|credential')"
printf 'secret_like_name_list=%s\n' \
  "$(env | cut -d= -f1 | grep -Ei 'token|secret|passwo?r?d|api_?key|credential' | tr '\n' ',')"
for f in .bash_history .zsh_history .python_history .mysql_history .psql_history; do meta "$H/$f"; done
BH="$H/.bash_history"
printf 'hist_password_assign=%s token_flags=%s bearer_forms=%s export_secret=%s url_with_creds=%s\n' \
  "$(grep -cEi '(^|[^a-z_])passwo?rd[[:space:]]*=' "$BH" 2>/dev/null)" \
  "$(grep -cE -- '--(token|password|secret)[ =]' "$BH" 2>/dev/null)" \
  "$(grep -cEi 'bearer[[:space:]]+[A-Za-z0-9._-]{8,}' "$BH" 2>/dev/null)" \
  "$(grep -cEi 'export[[:space:]]+[A-Z_]*(TOKEN|SECRET|KEY|PASSWORD)' "$BH" 2>/dev/null)" \
  "$(grep -cEi '[a-z]+://[^/[:space:]]+:[^@[:space:]]+@' "$BH" 2>/dev/null)"

echo; echo "== V6 自检断言 =="
d="$H/.ssh"
[ "$(stat -c%a "$d")" = "700" ] && echo "PASS ssh_dir_mode_700" || echo "FAIL ssh_dir_mode_700"
[ ! -e "$d/authorized_keys" ]     && echo "PASS inbound_keyset_empty" || echo "FAIL inbound_keyset_empty"
ssh-keygen -y -P '' -f "$d/id_ed25519" </dev/null >/dev/null 2>&1 \
  && echo "PASS id_ed25519_no_passphrase" || echo "FAIL id_ed25519_no_passphrase"
[ "$(stat -c%a "$H/.dsh/.bridge_token")" = "600" ] && echo "PASS bridge_token_mode_600" || echo "FAIL bridge_token_mode_600"
[ "$(stat -c%a "$H/.dsh/.credentials.yaml")" = "600" ] && echo "PASS credentials_yaml_mode_600" || echo "FAIL credentials_yaml_mode_600"
grep -qaE 'password|passwd' "$H/.dsh/plugin-activations.json" \
  && echo "FAIL plugin_activations_holds_secret_field" || echo "PASS plugin_activations_no_secret_field"
echo "note: 本脚本只读，未修改任何权限位与文件内容"
