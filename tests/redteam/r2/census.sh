#!/usr/bin/env bash
# R2 凭据与密钥面只读普查 (authorized own-container redteam R2)
# 约束：只读。不打印任何明文秘密；命中值只出 sha256 前 12 位 / 长度 / 路径 / 权限位 / owner。
# 不复制私钥，不导出 cookie，不联网，不改权限位，不动任何文件。
set -u
LC_ALL=C; export LC_ALL

SECTION(){ printf '\n===== %s =====\n' "$1"; }
h12(){ if [ -r "$1" ]; then sha256sum -- "$1" 2>/dev/null | cut -c1-12; else echo "UNREADABLE"; fi; }
hsz(){ if [ -r "$1" ]; then stat -c%s -- "$1" 2>/dev/null; else echo "-"; fi; }
st1(){ stat -c 'mode=%a owner=%U:%G size=%s mtime=%y type=%F' -- "$1" 2>/dev/null || echo "STAT_FAILED $1"; }
vhash(){ printf '%s' "$1" | sha256sum | cut -c1-12; }
vlen(){ printf '%s' "$1" | wc -c; }

SECTION "0 身份与宿主"
echo "uid_gid: $(id)"
echo "uname: $(uname -a)"
echo "os: $(grep -E '^PRETTY_NAME' /etc/os-release)"
echo "HOME=${HOME} PWD=$(pwd)"
echo "scan_roots=${ROOT_SCAN:-/root /home /opt /srv}"
echo "date_utc: $(date -u +%Y-%m-%dT%H:%M:%SZ)"

# ---------------------------------------------------------------- 1 SSH 面
SECTION "1 SSH 面"
for D in /root/.ssh "$HOME/.ssh"; do
  [ -e "$D" ] || { echo "DIR_ABSENT $D"; continue; }
  echo "--- DIR $D"; st1 "$D"
  ls -A "$D" 2>/dev/null | sed 's/^/  name: /'
  find "$D" -maxdepth 1 -type f -printf '  stat: %p %m %u:%g %s\n' 2>/dev/null | sort
done
echo "--- 私钥指纹/位数/类型 (comment 字段已剥离)"
for D in /root/.ssh "$HOME/.ssh"; do
  [ -d "$D" ] || continue
  for f in "$D"/*; do
    [ -f "$f" ] || continue
    case "$(basename "$f")" in
      *.pub|known_hosts*|config|authorized_keys*|*.old) continue;;
    esac
    head -c 40 "$f" 2>/dev/null | grep -q 'PRIVATE KEY' || continue
    fp=$(ssh-keygen -l -f "$f" </dev/null 2>/dev/null | awk '{print $1" "$2" "$NF}')
    echo "  key: $f"
    echo "    fp_bits_type: ${fp:-UNPARSABLE}"
    echo "    sha256_12: $(h12 "$f")  bytes: $(hsz "$f")  $(st1 "$f")"
    err=$(ssh-keygen -y -P '' -f "$f" </dev/null >/dev/null 2>/tmp/.r2kerr; echo $?)
    if [ "$err" = "0" ]; then echo "    passphrase: NONE(明文私钥, 可用空口令解出公钥)";
    elif grep -qi 'passphrase' /tmp/.r2kerr 2>/dev/null; then echo "    passphrase: PRESENT(空口令解出失败)";
    else echo "    passphrase: UNKNOWN(非 OpenSSH 格式或不可解析)"; fi
    rm -f /tmp/.r2kerr
  done
done
echo "--- 公钥指纹 (仅 fingerprint, 不带 comment)"
find /root/.ssh "$HOME/.ssh" -maxdepth 1 -name '*.pub' 2>/dev/null | while read -r p; do
  echo "  pub: $p -> $(ssh-keygen -l -f "$p" </dev/null 2>/dev/null | awk '{print $1" "$2" "$NF}')"
done
echo "--- authorized_keys 条目"
for f in /root/.ssh/authorized_keys /root/.ssh/authorized_keys2 "$HOME/.ssh/authorized_keys"; do
  [ -f "$f" ] || continue
  echo "  file: $f  lines_total=$(wc -l <"$f")  nonblank=$(grep -cvE '^\s*(#|$)' "$f")"
  echo "  keytype_dist: $(grep -vE '^\s*(#|$)' "$f" | awk '{for(i=1;i<=NF;i++) if($i ~ /^(ssh-|ecdsa-|sk-)/){print $i; break}}' | sort | uniq -c | tr '\n' ';')"
  echo "  options_prefixed(含逗号前导选项): $(grep -cvE '^\s*(#|$)' "$f" | tr -d '\n') -> $(awk '!/^\s*(#|$)/ && $1 !~ /^(ssh-|ecdsa-|sk-)/' "$f" | wc -l)"
  echo "  sha256_12: $(h12 "$f")  $(st1 "$f")"
done
echo "--- known_hosts"
for f in /root/.ssh/known_hosts /root/.ssh/known_hosts2; do
  [ -f "$f" ] || continue
  echo "  file: $f  lines=$(wc -l <"$f")  uniq_hosts=$(cut -d' ' -f1 "$f" | sort -u | wc -l)  hashed_entries=$(cut -d' ' -f1 "$f" | grep -c '^|1|')  sha256_12=$(h12 "$f")"
done
echo "--- ssh_config / 是否配置 IdentityFile 与 StrictHostKeyChecking"
for f in /etc/ssh/ssh_config /root/.ssh/config; do
  [ -f "$f" ] || { echo "  absent: $f"; continue; }
  echo "  $f: IdentityFile=$(grep -ci 'identityfile' "$f") StrictHostKeyChecking=$(grep -ci 'stricthostkeychecking' "$f") Host=$(grep -ci '^host ' "$f")"
done

# ------------------------------------------------------- 2 凭据文件面
SECTION "2 凭据文件面 (存在性/权限位/owner/长度/sha256 前12)"
CREDS=".git-credentials .config/git/credentials .netrc .docker/config.json .npmrc .config/pip/pip.conf .aws/credentials .aws/config .kube/config .pypirc .config/gh/hosts.yml .gem/credentials .vault-token .wget-hsts .curlrc .msmtprc .pgpass .my.cnf"
for base in /root "$HOME"; do
  for rel in $CREDS; do
    f="$base/$rel"
    [ -e "$f" ] || continue
    echo "HIT $f  sha256_12=$(h12 "$f")  bytes=$(hsz "$f")"
    st1 "$f" | sed 's/^/    /'
    case "$(basename "$f")" in
      config.json|pip.conf|credentials|config|hosts.yml)
        python3 - "$f" <<'PY' 2>/dev/null | sed 's/^/    field: /'
import json,sys
try: d=json.load(open(sys.argv[1]))
except Exception as e: print("NOT_JSON"); raise SystemExit
def walk(o,p="",depth=0):
    if depth>3: return
    if isinstance(o,dict):
        for k,v in o.items():
            print(("%s.%s"%(p,k)).lstrip("."))
            walk(v,("%s.%s"%(p,k)).lstrip("."),depth+1)
    elif isinstance(o,list):
        for i,v in enumerate(o[:3]): walk(v,"%s[%d]"%(p,i),depth+1)
walk(d)
PY
        ;;
      *) echo "    field: $(grep -oE '^[[:space:]]*[A-Za-z_][A-Za-z0-9_.-]*[[:space:]]*[:=]' "$f" 2>/dev/null | tr -d ' :=' | sort -u | tr '\n' ',')" ;;
    esac
  done
done
echo "--- .env / *.env 候选 (排除 node_modules/.git, 深度<=5)"
find /root /home /opt /srv -maxdepth 5 \
  \( -name node_modules -o -name .git -o -name .cache -o -name .venv -o -name venv \) -prune -o \
  -type f \( -name '.env' -o -name '.env.*' -o -name '*.env' \) -print 2>/dev/null | sort | while read -r f; do
    echo "  ENVFILE $f  sha256_12=$(h12 "$f")  bytes=$(hsz "$f")  $(st1 "$f")"
    echo "    keys: $(grep -oE '^[[:space:]]*(export[[:space:]]+)?[A-Za-z_][A-Za-z0-9_]*' "$f" 2>/dev/null | awk '{print $NF}' | sort -u | tr '\n' ',' | cut -c1-400)"
    echo "    secretname_hits: $(grep -icE '(SECRET|TOKEN|PASSWORD|PASSWD|API_?KEY|PRIVATE_?KEY|CREDENTIAL)' "$f")"
done
echo "--- git credential helper 配置"
git config --system --get-all credential.helper 2>/dev/null | sed 's/^/  system.helper: /'
git config --global --get-all credential.helper 2>/dev/null | sed 's/^/  global.helper: /'
[ -f /root/.gitconfig ] && echo "  /root/.gitconfig sha256_12=$(h12 /root/.gitconfig) $(st1 /root/.gitconfig)"

# -------------------------------------------- 3 私钥与证书面
SECTION "3 私钥与证书面 (深度<=6, 排除 node_modules/.git/.cache)"
find /root /home /opt /srv -maxdepth 6 \
  \( -name node_modules -o -name .git -o -name .cache -o -name .venv -o -name venv -o -name site-packages \) -prune -o \
  -type f \( -name '*.pem' -o -name '*.key' -o -name '*.p12' -o -name '*.pfx' -o -name '*.jks' -o -name '*.keystore' -o -name 'id_rsa*' -o -name 'id_ed25519*' -o -name 'id_ecdsa*' -o -name 'id_dsa*' \) -print 2>/dev/null | sort > /tmp/.r2keys
echo "total_candidates=$(wc -l < /tmp/.r2keys)"
echo "--- 按后缀统计"
sed 's/.*\.//' /tmp/.r2keys | sort | uniq -c | sed 's/^/  /'
echo "--- 权限位分布"
while read -r f; do stat -c '%a' "$f" 2>/dev/null; done < /tmp/.r2keys | sort | uniq -c | sed 's/^/  mode /'
echo "--- 明细 (前 60 条)"
n=0; while read -r f; do
  n=$((n+1)); [ $n -gt 60 ] && { echo "  ... 截断, 共 $(wc -l </tmp/.r2keys) 条"; break; }
  echo "  $f  sha256_12=$(h12 "$f")  $(st1 "$f")"
done < /tmp/.r2keys
echo "--- X.509 证书有效期 (可解析的 pem/crt)"
find /root /home /opt /srv /etc/ssl -maxdepth 6 \( -name node_modules -o -name .git \) -prune -o -type f \( -name '*.pem' -o -name '*.crt' \) -print 2>/dev/null | sort | head -40 | while read -r f; do
  e=$(openssl x509 -in "$f" -noout -enddate 2>/dev/null) || continue
  echo "  CERT $f  $e  subject_cn=$(openssl x509 -in "$f" -noout -subject 2>/dev/null | sed 's/.*CN *= *//' | cut -c1-60)"
done

# ---------------------------------------------------------------- 4 DSH 面
SECTION "4 DSH 面"
for D in /root/.dsh "$HOME/.dsh"; do
  [ -d "$D" ] || { echo "DIR_ABSENT $D"; continue; }
  echo "--- DIR $D"; st1 "$D"
  find "$D" -maxdepth 2 -printf '%y %p %m %u:%g %s\n' 2>/dev/null | sort -k2 | sed 's/^/  /'
done
echo "--- token/secret 形态文件 (值不打印)"
find /root/.dsh "$HOME/.dsh" -maxdepth 3 -type f 2>/dev/null | while read -r f; do
  b=$(basename "$f")
  case "$b" in *token*|*secret*|*cred*|*key*|*.pem|*.json)
    echo "  FILE $f  bytes=$(hsz "$f")  lines=$(wc -l <"$f" 2>/dev/null)  sha256_12=$(h12 "$f")  $(st1 "$f")";;
  esac
done
echo "--- plugin-activations.json / 配置类 JSON 的字段名 (仅键名)"
find /root/.dsh "$HOME/.dsh" -maxdepth 2 -name '*.json' -type f 2>/dev/null | sort | while read -r f; do
  echo "  JSON $f"
  python3 - "$f" <<'PY' 2>/dev/null | sed 's/^/    key: /'
import json,sys
try: d=json.load(open(sys.argv[1]))
except Exception: print("(not-json)"); raise SystemExit
def walk(o,p="",depth=0):
    if depth>3: return
    if isinstance(o,dict):
        for k,v in o.items():
            print(("%s.%s"%(p,k)).lstrip(".")); walk(v,("%s.%s"%(p,k)).lstrip("."),depth+1)
    elif isinstance(o,list):
        for i,v in enumerate(o[:2]): walk(v,"%s[%d]"%(p,i),depth+1)
walk(d)
PY
done
echo "--- 敏感字段名命中 (token/secret/password/key/cookie/credential)"
find /root/.dsh "$HOME/.dsh" -maxdepth 2 -type f 2>/dev/null | while read -r f; do
  c=$(grep -oiE '"[A-Za-z0-9_]*(token|secret|password|apikey|api_key|credential|cookie|privatekey)[A-Za-z0-9_]*"' "$f" 2>/dev/null | sort -u | tr '\n' ' ')
  [ -n "$c" ] && echo "  $f -> $c"
done

# --------------------------------------------------- 5 环境与历史面
SECTION "5 环境变量面 (值只出长度与前12位哈希)"
env | grep -E '^[A-Za-z_][A-Za-z0-9_]*=' | while IFS= read -r line; do
  name=${line%%=*}; val=${line#*=}
  printf '%s' "$name" | grep -qiE 'token|secret|passw|passwd|_key|apikey|api_key|credential|auth|session|cookie' || continue
  echo "  ENVVAR $name  val_len=$(vlen "$val")  val_sha256_12=$(vhash "$val")"
done
echo "  total_env_vars=$(env | grep -cE '^[A-Za-z_][A-Za-z0-9_]*=')"
echo "  matched_secretlike_names=$(env | grep -E '^[A-Za-z_][A-Za-z0-9_]*=' | cut -d= -f1 | grep -ciE 'token|secret|passw|passwd|_key|apikey|api_key|credential|auth|session|cookie')"

SECTION "5b shell 历史面 (只出计数与类型, 不贴原文)"
for f in /root/.bash_history /root/.zsh_history /root/.python_history /root/.mysql_history /root/.psql_history /root/.node_repl_history /root/.wget-hsts; do
  [ -f "$f" ] || { echo "  absent: $f"; continue; }
  echo "  FILE $f  lines=$(wc -l <"$f")  sha256_12=$(h12 "$f")  $(st1 "$f")"
  echo "    password_assign: $(grep -ciE '(password|passwd|pwd)[[:space:]]*=' "$f")"
  echo "    token_flags    : $(grep -ciE '(--token|-t[[:space:]]|--api-key|--secret|--password|--pass|-p[[:space:]])' "$f")"
  echo "    bearer_forms   : $(grep -ciE '(bearer|authorization:|curl.*-u[[:space:]])' "$f")"
  echo "    export_secret  : $(grep -ciE 'export[[:space:]]+[A-Z_]*(TOKEN|SECRET|KEY|PASS)' "$f")"
  echo "    ssh_hosts      : $(grep -coE 'ssh[[:space:]]+[A-Za-z0-9._-]+@' "$f")"
  echo "    url_with_creds : $(grep -coE '[a-z]+://[^/[:space:]:]+:[^/[:space:]@]+@' "$f")"
done

# ------------------------------------------------------- 6 台账汇总
SECTION "6 汇总台账"
echo "ssh_priv_keys=$(grep -c . /tmp/.r2keys 2>/dev/null || echo 0)  (私钥+证书候选总数, 见第3节)"
echo "cred_hits=$(
  for base in /root "$HOME"; do for rel in $CREDS; do [ -e "$base/$rel" ] && echo x; done; done | wc -l)"
echo "envfiles=$(find /root /home /opt /srv -maxdepth 5 \( -name node_modules -o -name .git -o -name .cache \) -prune -o -type f \( -name '.env' -o -name '.env.*' -o -name '*.env' \) -print 2>/dev/null | wc -l)"
echo "dsh_files=$(find /root/.dsh "$HOME/.dsh" -maxdepth 3 -type f 2>/dev/null | wc -l)"
rm -f /tmp/.r2keys
echo "===== END ====="
