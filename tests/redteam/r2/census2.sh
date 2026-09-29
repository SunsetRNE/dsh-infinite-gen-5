#!/usr/bin/env bash
# R2 补充普查 — 只读，不打印明文秘密。
set -u
LC_ALL=C; export LC_ALL
S(){ printf '\n===== %s =====\n' "$1"; }
h12(){ [ -r "$1" ] && sha256sum -- "$1" 2>/dev/null | cut -c1-12 || echo UNREADABLE; }
st1(){ stat -c 'mode=%a owner=%U:%G size=%s mtime=%y' -- "$1" 2>/dev/null || echo STAT_FAILED; }

S "A 凭据类文件广扫 (深度<=6, 排除 node_modules/.git)"
find /root /home /opt /srv /etc -maxdepth 6 \
  \( -name node_modules -o -name .git -o -name .cache -o -name site-packages \) -prune -o \
  -type f \( -name '.netrc' -o -name '.git-credentials' -o -name '_netrc' -o -name '.npmrc' \
     -o -name '.pypirc' -o -name '.docker' -path '*/.docker/config.json' \
     -o -name 'credentials' -o -name 'credentials.json' -o -name 'client_secret*.json' \
     -o -name 'terraform.tfstate*' -o -name '*.tfvars' -o -name '.vault-token' \
     -o -name 'hosts.yml' -path '*gh*' -o -name 'auth.json' -o -name '.pgpass' \
     -o -name '.my.cnf' -o -name 'secrets.*' -o -name '*.kdbx' -o -name '.htpasswd' \) \
  -print 2>/dev/null | sort | while read -r f; do
  echo "  HIT $f  sha256_12=$(h12 "$f")  $(st1 "$f")"
  echo "    keys: $(grep -oaE '^[[:space:]]*(export[[:space:]]+)?["A-Za-z_][A-Za-z0-9_.-]*["]?[[:space:]]*[:=]' "$f" 2>/dev/null | tr -d ' :="' | sort -u | tr '\n' ',' | cut -c1-300)"
done
echo "  (以上若为空 = 无命中)"

S "B .env 深扫 (限工作区, 深度<=8)"
find /root/Branchbase /root/dsh-infinite-gen-4 /root/dsh-infinite-gen-5 -maxdepth 8 \
  \( -name node_modules -o -name .git -o -name .venv -o -name venv -o -name .cache \) -prune -o \
  -type f \( -name '.env' -o -name '.env.*' -o -name '*.env' \) -print 2>/dev/null | sort | while read -r f; do
  echo "  ENVFILE $f  sha256_12=$(h12 "$f")  $(st1 "$f")"
done

S "C /root/.dsh 高价值文件的字段名与形态 (只出键名/字符类)"
for f in /root/.dsh/.credentials.yaml /root/.dsh/.dshw-turn.json /root/.dsh/plugin-activations.json /root/.dsh/.dshw-size.json; do
  [ -f "$f" ] || { echo "  absent: $f"; continue; }
  echo "  FILE $f  $(st1 "$f")  sha256_12=$(h12 "$f")"
  echo "    keys: $(grep -oaE '^[[:space:]-]*[A-Za-z_][A-Za-z0-9_.-]*[[:space:]]*:' "$f" 2>/dev/null | tr -d ' :-' | sort -u | tr '\n' ',')"
  echo "    json_topkeys: $(python3 -c "import json,sys;d=json.load(open(sys.argv[1]));print(','.join(sorted(d)) if isinstance(d,dict) else type(d).__name__)" "$f" 2>/dev/null || echo '(not-json)')"
done
echo "  --- .bridge_token 形态 (不含值)"
T=/root/.dsh/.bridge_token
if [ -r "$T" ]; then
  raw=$(cat "$T")
  printf '    bytes=%s  trailing_newline=%s\n' "$(stat -c%s "$T")" "$([ "$(tail -c1 "$T" | wc -l)" = "1" ] && echo yes || echo no)"
  printf '    charset=hex? %s  alnum? %s  base64ish? %s\n' \
    "$([ -z "$(printf '%s' "$raw" | tr -d '0-9a-fA-F')" ] && echo yes || echo no)" \
    "$([ -z "$(printf '%s' "$raw" | tr -d '0-9A-Za-z')" ] && echo yes || echo no)" \
    "$([ -z "$(printf '%s' "$raw" | tr -d '0-9A-Za-z+/=-')" ] && echo yes || echo no)"
  printf '    len=%s  sha256_12=%s\n' "$(printf '%s' "$raw" | wc -c)" "$(h12 "$T")"
  unset raw
fi

S "D 其余私钥的口令态 (空口令能否解出公钥)"
for f in /root/.sunsetlinux-keys/channel.key \
         /root/Branchbase/.local-gh/id_ed25519 \
         /root/dsh-infinite-gen-4/ig5-run-post3/lab/tls/root.key \
         /root/dsh-infinite-gen-4/ig5-run-post3/lab/tls/leaf.key \
         /root/.local/share/billion-context/ca/root-ca-key.pem; do
  [ -f "$f" ] || { echo "  absent: $f"; continue; }
  rc=0; ssh-keygen -y -P '' -f "$f" </dev/null >/dev/null 2>/tmp/.r2e || rc=$?
  if [ $rc = 0 ]; then s=NONE_OPENSSH;
  elif grep -qi passphrase /tmp/.r2e; then s=PRESENT;
  elif head -c 30 "$f" | grep -q 'PRIVATE KEY'; then s=PRESENT_OR_PEM_ENCRYPTED;
  else s=NOT_A_KEY_OR_HEX; fi
  echo "  KEY $f  passphrase=$s  bytes=$(stat -c%s "$f")  sha256_12=$(h12 "$f")  $(st1 "$f")"
done
rm -f /tmp/.r2e

S "E 全盘权限位矩阵 (仅上述命中集合)"
{ find /root/.ssh -maxdepth 1 -type f 2>/dev/null
  find /root/.sunsetlinux-keys /root/Branchbase/.local-gh /root/.local/share/billion-context/ca -maxdepth 1 -type f 2>/dev/null
  find /root/dsh-infinite-gen-4/ig5-run-post3/lab/tls -maxdepth 2 -type f \( -name '*.key' -o -name '*.crt' \) 2>/dev/null
  printf '%s\n' /root/.dsh/.bridge_token /root/.dsh/.credentials.yaml /root/.dsh/.anonymous-user-id /root/.dsh/plugin-activations.json /root/.gitconfig
} | sort -u | while read -r f; do printf '%s\t%s\n' "$(stat -c%a "$f" 2>/dev/null)" "$(stat -c%U:%G "$f" 2>/dev/null)"; done | sort | uniq -c | sed 's/^/  /'
echo "  --- 世界可读(644/664/666/777) 的命中文件:"
{ find /root/.ssh /root/.sunsetlinux-keys /root/Branchbase/.local-gh /root/.local/share/billion-context/ca -maxdepth 1 -type f 2>/dev/null; } | sort -u | while read -r f; do
  m=$(stat -c%a "$f"); case "$m" in *[2467]|*[2367]) echo "    $m $f";; esac
done

S "F cookie / 浏览器凭据面 (只出路径与计数)"
find /root /home -maxdepth 5 \( -name node_modules -o -name .git \) -prune -o \
  -type f \( -name 'Cookies' -o -name 'cookies.sqlite' -o -name 'Login Data' -o -name '*.cookie' -o -name 'cookies.txt' \) -print 2>/dev/null | sort | sed 's/^/  /'
echo "  (以上若为空 = 无命中)"

S "G git 配置里的 URL 形态 (打码显示)"
for f in /root/.gitconfig /root/.config/git/config /root/Branchbase/.git/config; do
  [ -f "$f" ] || continue
  echo "  $f: url_with_creds=$(grep -coE '[a-z]+://[^/[:space:]:]+:[^/[:space:]@]+@' "$f")  helper=$(grep -ci 'helper' "$f")  sha256_12=$(h12 "$f")"
done
echo "===== END2 ====="
