#!/usr/bin/env bash
# restore-dev-env.sh — 幂等重建 Ubuntu 24.04 (aarch64 / Android 容器) 上的编译与开发环境
# 用法: bash restore-dev-env.sh [--with-rust] [--with-go] [--with-jdk] [--ssh-zip PATH]
set -uo pipefail

WITH_RUST=0; WITH_GO=0; WITH_JDK=0; SSH_ZIP=""
while [ $# -gt 0 ]; do
  case "$1" in
    --with-rust) WITH_RUST=1 ;;
    --with-go)   WITH_GO=1 ;;
    --with-jdk)  WITH_JDK=1 ;;
    --ssh-zip)   SSH_ZIP="${2:-}"; shift ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
  shift
done

log() { printf '\n=== %s ===\n' "$*"; }
has() { command -v "$1" >/dev/null 2>&1; }

log "0. 基线信息"
echo "distro : $(. /etc/os-release; echo "$PRETTY_NAME")"
echo "arch   : $(uname -m)   kernel: $(uname -r)"
echo "uid    : $(id -u) (0=root 才能用 apt)"

# ---------- 1. SSH / Git 凭据 ----------
if [ -n "$SSH_ZIP" ] && [ -f "$SSH_ZIP" ]; then
  log "1. 恢复 ~/.ssh 与 ~/.gitconfig"
  TMP="$(mktemp -d)"; cp "$SSH_ZIP" "$TMP/id.zip"
  python3 -c "import zipfile,sys; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])" \
      "$TMP/id.zip" "$TMP/out"
  install -d -m 700 "$HOME/.ssh"
  [ -f "$TMP/out/.ssh/id_ed25519" ]     && install -m 600 "$TMP/out/.ssh/id_ed25519"     "$HOME/.ssh/id_ed25519"
  [ -f "$TMP/out/.ssh/id_ed25519.pub" ] && install -m 644 "$TMP/out/.ssh/id_ed25519.pub" "$HOME/.ssh/id_ed25519.pub"
  [ -f "$TMP/out/.ssh/known_hosts" ]    && install -m 644 "$TMP/out/.ssh/known_hosts"    "$HOME/.ssh/known_hosts"
  [ -f "$TMP/out/.gitconfig" ]          && install -m 644 "$TMP/out/.gitconfig"          "$HOME/.gitconfig"
  touch "$HOME/.ssh/config"; chmod 600 "$HOME/.ssh/config"
  rm -rf "$TMP"
  git config --global --list
else
  log "1. 跳过凭据恢复（未给 --ssh-zip）"
fi

# ---------- 2. apt 源与核心编译链 ----------
log "2. apt install 编译链"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y --no-install-recommends \
  build-essential gcc g++ make cmake ninja-build pkg-config \
  autoconf automake libtool m4 bison flex \
  binutils binutils-dev \
  unzip zip xz-utils zstd tar \
  jq wget file rsync tmux htop less \
  openssh-client ca-certificates \
  python3-pip python3-venv python3-dev \
  ripgrep gdb strace ltrace

# ---------- 3. 语言运行时 ----------
log "3. 语言运行时"
if ! has rustc && [ "$WITH_RUST" = 1 ]; then
  curl -fsSL https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain stable
  . "$HOME/.cargo/env"
fi
if ! has go && [ "$WITH_GO" = 1 ]; then
  GO_VER="$(curl -fsSL https://go.dev/VERSION?m=text | head -1)"
  curl -fsSL "https://go.dev/dl/${GO_VER}.linux-arm64.tar.gz" -o /tmp/go.tgz \
    && rm -rf /usr/local/go && tar -C /usr/local -xzf /tmp/go.tgz && rm -f /tmp/go.tgz
  grep -q '/usr/local/go/bin' "$HOME/.bashrc" 2>/dev/null || echo 'export PATH=$PATH:/usr/local/go/bin:$HOME/go/bin' >> "$HOME/.bashrc"
  export PATH=$PATH:/usr/local/go/bin
fi
if ! has javac && [ "$WITH_JDK" = 1 ]; then
  apt-get install -y --no-install-recommends default-jdk-headless
fi

log "4. Python 工具层"
has pipx || python3 -m pip install --break-system-packages -q pipx
has uv   || python3 -m pip install --break-system-packages -q uv
python3 -m pipx ensurepath >/dev/null 2>&1 || true

log "5. 完成，运行 verify-env.sh 复核"
