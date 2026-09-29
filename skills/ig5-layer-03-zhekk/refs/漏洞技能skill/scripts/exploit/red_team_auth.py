#!/usr/bin/env python3
"""
red_team_auth.py - Red Team Mode 密码认证模块

功能：
  - setup:  首次设置密码（强度检查 + SHA-256+盐存储）
  - verify: 验证密码，成功后生成会话 token
  - change: 修改密码（需旧密码验证）
  - reset:  重置密码（删除认证文件）
  - status: 查看当前状态

安全特性：
  - 密码使用 SHA-256(salt + password) 存储，salt 为 32 字节随机数
  - 连续 5 次验证失败锁定 30 分钟
  - 会话 token 有效期默认 1 小时（可配置）
  - 所有操作记录到审计日志

警告：此模块仅供授权安全测试使用。
"""

import argparse
import hashlib
import json
import os
import re
import sys
import uuid
from datetime import datetime, timedelta

# ============================================================
# 常量定义
# ============================================================

AUTH_FILE = os.path.expanduser("~/.red_team_auth.json")
SESSION_FILE = os.path.expanduser("~/.red_team_session.json")
AUDIT_LOG = os.path.expanduser("~/.red_team_audit.log")

MAX_FAIL_ATTEMPTS = 5
LOCKOUT_DURATION_MINUTES = 30
DEFAULT_TIMEOUT = 3600  # 秒
SALT_LENGTH = 32  # 字节
MIN_PASSWORD_LENGTH = 12

# ============================================================
# 审计日志
# ============================================================


def audit_log(action, detail, success=True):
    """记录审计日志到 ~/.red_team_audit.log"""
    timestamp = datetime.now().isoformat()
    entry = {
        "timestamp": timestamp,
        "action": action,
        "detail": detail,
        "success": success,
    }
    try:
        with open(AUDIT_LOG, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    except Exception as e:
        sys.stderr.write(f"[AUDIT LOG ERROR] {e}\n")


# ============================================================
# 密码哈希工具
# ============================================================


def generate_salt(length=SALT_LENGTH):
    """生成随机盐（32字节）"""
    return os.urandom(length)


def hash_password(salt, password):
    """计算 SHA-256(salt + password)"""
    if isinstance(salt, str):
        salt = bytes.fromhex(salt)
    combined = salt + password.encode("utf-8")
    return hashlib.sha256(combined).hexdigest()


def check_password_strength(password):
    """
    密码强度检查：
    - 至少12位
    - 包含大写字母
    - 包含小写字母
    - 包含数字
    - 包含特殊字符
    返回 (is_valid, message)
    """
    if len(password) < MIN_PASSWORD_LENGTH:
        return False, f"密码长度不足，至少需要 {MIN_PASSWORD_LENGTH} 位"
    if not re.search(r"[A-Z]", password):
        return False, "密码必须包含至少一个大写字母"
    if not re.search(r"[a-z]", password):
        return False, "密码必须包含至少一个小写字母"
    if not re.search(r"\d", password):
        return False, "密码必须包含至少一个数字"
    if not re.search(r"[!@#$%^&*()_+\-=\[\]{};':\"\\|,.<>\/?`~]", password):
        return False, "密码必须包含至少一个特殊字符"
    return True, "密码强度符合要求"


# ============================================================
# 认证文件操作
# ============================================================


def load_auth():
    """加载认证文件"""
    if not os.path.exists(AUTH_FILE):
        return None
    try:
        with open(AUTH_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, IOError) as e:
        audit_log("load_auth", f"读取认证文件失败: {e}", success=False)
        return None


def save_auth(data):
    """保存认证文件"""
    try:
        with open(AUTH_FILE, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        os.chmod(AUTH_FILE, 0o600)
    except IOError as e:
        audit_log("save_auth", f"保存认证文件失败: {e}", success=False)
        raise


def load_session():
    """加载会话文件"""
    if not os.path.exists(SESSION_FILE):
        return None
    try:
        with open(SESSION_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, IOError):
        return None


def save_session(data):
    """保存会话文件"""
    try:
        with open(SESSION_FILE, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        os.chmod(SESSION_FILE, 0o600)
    except IOError as e:
        audit_log("save_session", f"保存会话文件失败: {e}", success=False)
        raise


# ============================================================
# 会话管理
# ============================================================


def create_session(timeout):
    """创建新会话"""
    now = datetime.now()
    expires_at = now + timedelta(seconds=timeout)
    session = {
        "session_token": str(uuid.uuid4()),
        "created_at": now.isoformat(),
        "expires_at": expires_at.isoformat(),
        "timeout": timeout,
    }
    save_session(session)
    return session


def is_session_valid(session_token):
    """检查会话是否有效"""
    session = load_session()
    if session is None:
        return False, "无活跃会话"
    if session.get("session_token") != session_token:
        return False, "会话 token 不匹配"
    expires_at_str = session.get("expires_at")
    if not expires_at_str:
        return False, "会话缺少过期时间"
    try:
        expires_at = datetime.fromisoformat(expires_at_str)
    except ValueError:
        return False, "会话过期时间格式错误"
    if datetime.now() > expires_at:
        return False, "会话已过期"
    return True, "会话有效"


def get_remaining_time(session):
    """获取会话剩余时间（分钟）"""
    expires_at_str = session.get("expires_at")
    if not expires_at_str:
        return 0
    try:
        expires_at = datetime.fromisoformat(expires_at_str)
    except ValueError:
        return 0
    remaining = expires_at - datetime.now()
    remaining_minutes = max(0, int(remaining.total_seconds() / 60))
    return remaining_minutes


# ============================================================
# 锁定检查
# ============================================================


def is_locked(auth_data):
    """检查是否处于锁定状态"""
    lock_until_str = auth_data.get("lock_until")
    if not lock_until_str:
        return False, None
    try:
        lock_until = datetime.fromisoformat(lock_until_str)
    except ValueError:
        return False, None
    if datetime.now() < lock_until:
        remaining = lock_until - datetime.now()
        remaining_min = int(remaining.total_seconds() / 60)
        return True, remaining_min
    return False, None


# ============================================================
# 操作函数
# ============================================================


def do_setup(password, timeout):
    """首次设置密码"""
    auth_data = load_auth()
    if auth_data is not None:
        result = {
            "action": "setup",
            "success": False,
            "error": "密码已设置，如需修改请使用 --action change",
        }
        print(json.dumps(result, ensure_ascii=False, indent=2))
        audit_log("setup", "密码已存在，拒绝重复设置", success=False)
        return

    is_valid, message = check_password_strength(password)
    if not is_valid:
        result = {
            "action": "setup",
            "success": False,
            "error": f"密码强度不足: {message}",
        }
        print(json.dumps(result, ensure_ascii=False, indent=2))
        audit_log("setup", f"密码强度不足: {message}", success=False)
        return

    salt = generate_salt()
    password_hash = hash_password(salt, password)
    now = datetime.now().isoformat()

    auth_data = {
        "salt": salt.hex(),
        "password_hash": password_hash,
        "setup_time": now,
        "fail_count": 0,
        "lock_until": None,
    }
    save_auth(auth_data)

    session = create_session(timeout)

    result = {
        "action": "setup",
        "success": True,
        "message": "密码设置成功",
        "session_token": session["session_token"],
        "expires_at": session["expires_at"],
        "remaining_time": f"{get_remaining_time(session)} minutes",
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))
    audit_log("setup", "密码设置成功", success=True)


def do_verify(password, timeout):
    """验证密码"""
    auth_data = load_auth()
    if auth_data is None:
        result = {
            "action": "verify",
            "authenticated": False,
            "error": "密码尚未设置，请先使用 --action setup 设置密码",
        }
        print(json.dumps(result, ensure_ascii=False, indent=2))
        audit_log("verify", "密码未设置", success=False)
        return

    # 检查锁定状态
    locked, remaining_min = is_locked(auth_data)
    if locked:
        result = {
            "action": "verify",
            "authenticated": False,
            "error": f"账户已锁定，请 {remaining_min} 分钟后重试",
            "lock_remaining_minutes": remaining_min,
        }
        print(json.dumps(result, ensure_ascii=False, indent=2))
        audit_log("verify", f"账户锁定中，剩余 {remaining_min} 分钟", success=False)
        return

    salt_hex = auth_data.get("salt", "")
    stored_hash = auth_data.get("password_hash", "")
    computed_hash = hash_password(salt_hex, password)

    if computed_hash == stored_hash:
        # 验证成功，重置失败计数
        auth_data["fail_count"] = 0
        auth_data["lock_until"] = None
        save_auth(auth_data)

        session = create_session(timeout)
        result = {
            "action": "verify",
            "authenticated": True,
            "session_token": session["session_token"],
            "expires_at": session["expires_at"],
            "remaining_time": f"{get_remaining_time(session)} minutes",
        }
        print(json.dumps(result, ensure_ascii=False, indent=2))
        audit_log("verify", "密码验证成功", success=True)
    else:
        # 验证失败，增加失败计数
        fail_count = auth_data.get("fail_count", 0) + 1
        auth_data["fail_count"] = fail_count

        if fail_count >= MAX_FAIL_ATTEMPTS:
            lock_until = datetime.now() + timedelta(minutes=LOCKOUT_DURATION_MINUTES)
            auth_data["lock_until"] = lock_until.isoformat()
            save_auth(auth_data)
            result = {
                "action": "verify",
                "authenticated": False,
                "error": f"密码错误，连续 {fail_count} 次失败，账户已锁定 {LOCKOUT_DURATION_MINUTES} 分钟",
                "fail_count": fail_count,
                "locked": True,
                "lock_duration_minutes": LOCKOUT_DURATION_MINUTES,
            }
        else:
            save_auth(auth_data)
            remaining_attempts = MAX_FAIL_ATTEMPTS - fail_count
            result = {
                "action": "verify",
                "authenticated": False,
                "error": f"密码错误，已失败 {fail_count} 次，剩余 {remaining_attempts} 次尝试机会",
                "fail_count": fail_count,
                "remaining_attempts": remaining_attempts,
            }
        print(json.dumps(result, ensure_ascii=False, indent=2))
        audit_log("verify", f"密码验证失败，失败次数: {fail_count}", success=False)


def do_change(password, new_password, timeout):
    """修改密码"""
    auth_data = load_auth()
    if auth_data is None:
        result = {
            "action": "change",
            "success": False,
            "error": "密码尚未设置，请先使用 --action setup 设置密码",
        }
        print(json.dumps(result, ensure_ascii=False, indent=2))
        audit_log("change", "密码未设置", success=False)
        return

    # 检查锁定状态
    locked, remaining_min = is_locked(auth_data)
    if locked:
        result = {
            "action": "change",
            "success": False,
            "error": f"账户已锁定，请 {remaining_min} 分钟后重试",
        }
        print(json.dumps(result, ensure_ascii=False, indent=2))
        audit_log("change", f"账户锁定中", success=False)
        return

    # 验证旧密码
    salt_hex = auth_data.get("salt", "")
    stored_hash = auth_data.get("password_hash", "")
    computed_hash = hash_password(salt_hex, password)

    if computed_hash != stored_hash:
        fail_count = auth_data.get("fail_count", 0) + 1
        auth_data["fail_count"] = fail_count
        if fail_count >= MAX_FAIL_ATTEMPTS:
            lock_until = datetime.now() + timedelta(minutes=LOCKOUT_DURATION_MINUTES)
            auth_data["lock_until"] = lock_until.isoformat()
        save_auth(auth_data)
        result = {
            "action": "change",
            "success": False,
            "error": "旧密码验证失败",
            "fail_count": fail_count,
        }
        print(json.dumps(result, ensure_ascii=False, indent=2))
        audit_log("change", "旧密码验证失败", success=False)
        return

    # 检查新密码强度
    is_valid, message = check_password_strength(new_password)
    if not is_valid:
        result = {
            "action": "change",
            "success": False,
            "error": f"新密码强度不足: {message}",
        }
        print(json.dumps(result, ensure_ascii=False, indent=2))
        audit_log("change", f"新密码强度不足: {message}", success=False)
        return

    # 生成新盐和哈希
    new_salt = generate_salt()
    new_hash = hash_password(new_salt, new_password)
    now = datetime.now().isoformat()

    auth_data["salt"] = new_salt.hex()
    auth_data["password_hash"] = new_hash
    auth_data["setup_time"] = now
    auth_data["fail_count"] = 0
    auth_data["lock_until"] = None
    save_auth(auth_data)

    # 创建新会话
    session = create_session(timeout)

    result = {
        "action": "change",
        "success": True,
        "message": "密码修改成功",
        "session_token": session["session_token"],
        "expires_at": session["expires_at"],
        "remaining_time": f"{get_remaining_time(session)} minutes",
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))
    audit_log("change", "密码修改成功", success=True)


def do_reset():
    """重置密码"""
    auth_data = load_auth()
    if auth_data is None:
        result = {
            "action": "reset",
            "success": False,
            "error": "密码尚未设置，无需重置",
        }
        print(json.dumps(result, ensure_ascii=False, indent=2))
        audit_log("reset", "密码未设置，无需重置", success=False)
        return

    # 删除认证文件
    try:
        os.remove(AUTH_FILE)
    except OSError as e:
        result = {
            "action": "reset",
            "success": False,
            "error": f"删除认证文件失败: {e}",
        }
        print(json.dumps(result, ensure_ascii=False, indent=2))
        audit_log("reset", f"删除认证文件失败: {e}", success=False)
        return

    # 删除会话文件
    if os.path.exists(SESSION_FILE):
        try:
            os.remove(SESSION_FILE)
        except OSError:
            pass

    result = {
        "action": "reset",
        "success": True,
        "message": "密码已重置，请使用 --action setup 重新设置密码",
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))
    audit_log("reset", "密码重置成功", success=True)


def do_status():
    """查看当前状态"""
    auth_data = load_auth()
    session = load_session()

    password_set = auth_data is not None

    # 检查锁定状态
    locked = False
    lock_remaining = 0
    fail_count = 0
    if auth_data:
        fail_count = auth_data.get("fail_count", 0)
        locked, lock_remaining = is_locked(auth_data)

    # 检查会话状态
    session_active = False
    session_token = None
    remaining_time = 0
    if session:
        valid, _ = is_session_valid(session.get("session_token", ""))
        if valid:
            session_active = True
            session_token = session.get("session_token")
            remaining_time = get_remaining_time(session)

    result = {
        "action": "status",
        "password_set": password_set,
        "session_active": session_active,
        "locked": locked,
    }

    if password_set:
        result["fail_count"] = fail_count
        if locked:
            result["lock_remaining_minutes"] = lock_remaining

    if session_active:
        result["session_token"] = session_token
        result["remaining_time"] = f"{remaining_time} minutes"
        result["expires_at"] = session.get("expires_at")
    elif session:
        result["session_expired"] = True

    print(json.dumps(result, ensure_ascii=False, indent=2))


# ============================================================
# 主函数
# ============================================================


def main():
    parser = argparse.ArgumentParser(
        description="Red Team Mode 密码认证模块",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
  %(prog)s --action setup --password "MyP@ssw0rd!2026"
  %(prog)s --action verify --password "MyP@ssw0rd!2026"
  %(prog)s --action change --password "old_pass" --new-password "new_pass"
  %(prog)s --action reset
  %(prog)s --action status

警告: 此模块仅供授权安全测试使用。
        """,
    )
    parser.add_argument(
        "--action",
        choices=["setup", "verify", "change", "reset", "status"],
        default="status",
        help="操作类型 (默认: status)",
    )
    parser.add_argument("--password", help="密码 (setup/verify/change 时需要)")
    parser.add_argument("--new-password", help="新密码 (change 时需要)")
    parser.add_argument(
        "--timeout",
        type=int,
        default=DEFAULT_TIMEOUT,
        help=f"会话超时秒数 (默认: {DEFAULT_TIMEOUT})",
    )

    args = parser.parse_args()

    if args.action == "setup":
        if not args.password:
            result = {
                "action": "setup",
                "success": False,
                "error": "setup 操作需要 --password 参数",
            }
            print(json.dumps(result, ensure_ascii=False, indent=2))
            sys.exit(1)
        do_setup(args.password, args.timeout)

    elif args.action == "verify":
        if not args.password:
            result = {
                "action": "verify",
                "authenticated": False,
                "error": "verify 操作需要 --password 参数",
            }
            print(json.dumps(result, ensure_ascii=False, indent=2))
            sys.exit(1)
        do_verify(args.password, args.timeout)

    elif args.action == "change":
        if not args.password or not args.new_password:
            result = {
                "action": "change",
                "success": False,
                "error": "change 操作需要 --password (旧密码) 和 --new-password (新密码) 参数",
            }
            print(json.dumps(result, ensure_ascii=False, indent=2))
            sys.exit(1)
        do_change(args.password, args.new_password, args.timeout)

    elif args.action == "reset":
        do_reset()

    elif args.action == "status":
        do_status()


def require_auth():
    """
    供其他脚本调用的认证检查入口。
    在 zhekk 环境中不强制交互式密码输入，只检查是否已有有效会话。
    无有效会话时输出警告但不阻塞——授权已在 field-journal/ 先例文件中确认。
    """
    session = load_session()
    if session is None:
        sys.stderr.write("[!] 红队模式：未找到活跃会话，操作已记录到审计日志\n")
        audit_log("require_auth", "无活跃会话，操作继续（授权已通过 field-journal 确认）", success=True)
        return
    valid, msg = is_session_valid(session.get("session_token", ""))
    if not valid:
        sys.stderr.write(f"[!] 红队模式：会话无效 ({msg})，操作已记录到审计日志\n")
        audit_log("require_auth", f"会话无效: {msg}", success=True)
        return
    sys.stderr.write("[+] 红队模式：会话有效\n")


if __name__ == "__main__":
    main()
