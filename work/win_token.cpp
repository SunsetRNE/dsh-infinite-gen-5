// win_token.cpp —— 身份/权限：完整性级别、管理员组成员、特权启用、UAC 提权重启
#include "ig5_win.hpp"
#include <sddl.h>
#include <shellapi.h>
#include <cstdio>

#pragma comment(lib, "advapi32.lib")
#pragma comment(lib, "shell32.lib")

namespace ig5 {
namespace {
std::string werr(const char* what) {
    char b[160];
    std::snprintf(b, sizeof b, "%s failed: last_error=%lu", what, GetLastError());
    return b;
}
}  // namespace

bool token_is_elevated(bool& elevated, std::string& err) {
    HANDLE tok = nullptr;
    if (!OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &tok)) { err = werr("OpenProcessToken"); return false; }
    TOKEN_ELEVATION te{};
    DWORD len = 0;
    const BOOL ok = GetTokenInformation(tok, TokenElevation, &te, sizeof te, &len);
    CloseHandle(tok);
    if (!ok) { err = werr("GetTokenInformation(TokenElevation)"); return false; }
    elevated = te.TokenIsElevated != 0;
    return true;
}

bool token_integrity(std::string& level, std::string& err) {
    HANDLE tok = nullptr;
    if (!OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &tok)) { err = werr("OpenProcessToken"); return false; }
    DWORD len = 0;
    GetTokenInformation(tok, TokenIntegrityLevel, nullptr, 0, &len);   // 先取长度
    std::vector<std::uint8_t> buf(len);
    const BOOL ok = GetTokenInformation(tok, TokenIntegrityLevel, buf.data(), len, &len);
    CloseHandle(tok);
    if (!ok) { err = werr("GetTokenInformation(TokenIntegrityLevel)"); return false; }

    auto* tml = reinterpret_cast<TOKEN_MANDATORY_LABEL*>(buf.data());
    const DWORD rid = *GetSidSubAuthority(tml->Label.Sid, *GetSidSubAuthorityCount(tml->Label.Sid) - 1);
    if (rid < SECURITY_MANDATORY_MEDIUM_RID)        level = "low";
    else if (rid < SECURITY_MANDATORY_HIGH_RID)     level = "medium";
    else if (rid < SECURITY_MANDATORY_SYSTEM_RID)   level = "high";
    else                                            level = "system";
    return true;
}

bool token_in_admin_group(bool& in_admin, std::string& err) {
    SID_IDENTIFIER_AUTHORITY nt = SECURITY_NT_AUTHORITY;
    PSID admin = nullptr;
    if (!AllocateAndInitializeSid(&nt, 2, SECURITY_BUILTIN_DOMAIN_RID, DOMAIN_ALIAS_RID_ADMINS,
                                  0, 0, 0, 0, 0, 0, &admin)) { err = werr("AllocateAndInitializeSid"); return false; }
    BOOL member = FALSE;
    const BOOL ok = CheckTokenMembership(nullptr, admin, &member);
    FreeSid(admin);
    if (!ok) { err = werr("CheckTokenMembership"); return false; }
    in_admin = member != FALSE;
    return true;
}

// privilege_name: L"SeDebugPrivilege" / L"SeImpersonatePrivilege" / L"SeBackupPrivilege"
bool token_enable(std::wstring& privilege_name, bool& enabled, std::string& err) {
    HANDLE tok = nullptr;
    if (!OpenProcessToken(GetCurrentProcess(), TOKEN_ADJUST_PRIVILEGES | TOKEN_QUERY, &tok)) {
        err = werr("OpenProcessToken(ADJUST)"); return false;
    }
    LUID luid{};
    if (!LookupPrivilegeValueW(nullptr, privilege_name.c_str(), &luid)) {
        CloseHandle(tok); err = werr("LookupPrivilegeValueW"); return false;
    }
    TOKEN_PRIVILEGES tp{};
    tp.PrivilegeCount = 1;
    tp.Privileges[0].Luid = luid;
    tp.Privileges[0].Attributes = SE_PRIVILEGE_ENABLED;
    const BOOL ok = AdjustTokenPrivileges(tok, FALSE, &tp, sizeof tp, nullptr, nullptr);
    const DWORD le = GetLastError();
    CloseHandle(tok);
    if (!ok) { err = werr("AdjustTokenPrivileges"); return false; }
    enabled = (le == ERROR_SUCCESS);            // ERROR_NOT_ALL_ASSIGNED 表示令牌里没有该特权
    return true;
}

bool relaunch_elevated(const std::wstring& exe, std::string& err) {
    SHELLEXECUTEINFOW sei{};
    sei.cbSize = sizeof sei;
    sei.fMask  = SEE_MASK_NOCLOSEPROCESS | SEE_MASK_NOASYNC;
    sei.lpVerb = L"runas";                      // 触发 UAC 同意框
    sei.lpFile = exe.c_str();
    sei.nShow  = SW_SHOWNORMAL;
    if (!ShellExecuteExW(&sei)) { err = werr("ShellExecuteExW(runas)"); return false; }
    if (sei.hProcess) CloseHandle(sei.hProcess);
    return true;
}

}  // namespace ig5
