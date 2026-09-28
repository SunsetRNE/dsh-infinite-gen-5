// win_persist.cpp —— 持久化两条路径（HKCU Run 免管理员 / ONLOGON 计划任务），均带清除函数
#include "ig5_win.hpp"
#include <cstdio>

#pragma comment(lib, "advapi32.lib")

namespace ig5 {
namespace {
constexpr wchar_t kRunKeyPath[] = L"Software\\Microsoft\\Windows\\CurrentVersion\\Run";

std::string werr(const char* what) {
    char b[192];
    std::snprintf(b, sizeof b, "%s failed: last_error=%lu", what, GetLastError());
    return b;
}

// 命令行引号规则：Windows 反斜杠需在引号前成对转义
std::wstring quote_arg(const std::wstring& s) {
    std::wstring out = L"\"";
    std::size_t bs = 0;
    for (wchar_t c : s) {
        if (c == L'\\') { ++bs; out.push_back(c); continue; }
        if (c == L'"') { out.append(bs, L'\\'); out.append(L"\\\""); bs = 0; continue; }
        bs = 0; out.push_back(c);
    }
    out.append(bs, L'\\');
    out.push_back(L'"');
    return out;
}

bool run_wait(const std::wstring& cmdline, DWORD timeout_ms, DWORD& exit_code, std::string& err) {
    std::wstring mutable_cmd = cmdline;                 // CreateProcessW 需要可写缓冲
    STARTUPINFOW si{}; si.cb = sizeof si;
    PROCESS_INFORMATION pi{};
    if (!CreateProcessW(nullptr, mutable_cmd.data(), nullptr, nullptr, FALSE, CREATE_NO_WINDOW,
                        nullptr, nullptr, &si, &pi)) { err = werr("CreateProcessW"); return false; }
    const DWORD w = WaitForSingleObject(pi.hProcess, timeout_ms);
    if (w == WAIT_TIMEOUT) {
        TerminateProcess(pi.hProcess, 1);
        CloseHandle(pi.hThread); CloseHandle(pi.hProcess);
        err = "child process timeout";
        return false;
    }
    GetExitCodeProcess(pi.hProcess, &exit_code);
    CloseHandle(pi.hThread); CloseHandle(pi.hProcess);
    return true;
}
}  // namespace

bool persist_registry_run(const std::wstring& exe, const std::wstring& value_name, std::string& err) {
    HKEY key = nullptr;
    const LSTATUS rc = RegCreateKeyExW(HKEY_CURRENT_USER, kRunKeyPath, 0, nullptr,
                                       REG_OPTION_NON_VOLATILE, KEY_SET_VALUE, nullptr, &key, nullptr);
    if (rc != ERROR_SUCCESS) { err = "RegCreateKeyExW failed: code=" + std::to_string(rc); return false; }
    const DWORD bytes = static_cast<DWORD>((exe.size() + 1) * sizeof(wchar_t));
    const LSTATUS rs = RegSetValueExW(key, value_name.c_str(), 0, REG_SZ,
                                      reinterpret_cast<const BYTE*>(exe.c_str()), bytes);
    RegCloseKey(key);
    if (rs != ERROR_SUCCESS) { err = "RegSetValueExW failed: code=" + std::to_string(rs); return false; }
    return true;
}

bool persist_remove_run(const std::wstring& value_name, std::string& err) {
    HKEY key = nullptr;
    const LSTATUS rc = RegOpenKeyExW(HKEY_CURRENT_USER, kRunKeyPath, 0, KEY_SET_VALUE, &key);
    if (rc != ERROR_SUCCESS) { err = "RegOpenKeyExW failed: code=" + std::to_string(rc); return false; }
    const LSTATUS ds = RegDeleteValueW(key, value_name.c_str());
    RegCloseKey(key);
    if (ds != ERROR_SUCCESS && ds != ERROR_FILE_NOT_FOUND) { err = "RegDeleteValueW failed: code=" + std::to_string(ds); return false; }
    return true;
}

// schtasks /Create /F 覆盖同名任务；/RL LIMITED 免提权即可注册当前用户登录触发
bool persist_schtask_onlogon(const std::wstring& exe, const std::wstring& task_name, std::string& err) {
    const std::wstring cmd = L"schtasks.exe /Create /F /TN " + quote_arg(task_name) +
                             L" /TR " + quote_arg(exe) + L" /SC ONLOGON /RL LIMITED";
    DWORD code = 0;
    if (!run_wait(cmd, 20000, code, err)) return false;
    if (code != 0) { err = "schtasks /Create exit_code=" + std::to_string(code); return false; }
    return true;
}

bool persist_remove_task(const std::wstring& task_name, std::string& err) {
    const std::wstring cmd = L"schtasks.exe /Delete /F /TN " + quote_arg(task_name);
    DWORD code = 0;
    if (!run_wait(cmd, 20000, code, err)) return false;
    if (code != 0) { err = "schtasks /Delete exit_code=" + std::to_string(code); return false; }
    return true;
}

// 子进程执行：匿名管道回读 stdout+stderr，全部驻留内存
bool run_capture(const std::wstring& cmdline, std::string& out_utf8, std::string& err, DWORD timeout_ms) {
    SECURITY_ATTRIBUTES sa{};
    sa.nLength = sizeof sa;
    sa.bInheritHandle = TRUE;
    HANDLE rd = nullptr, wr = nullptr;
    if (!CreatePipe(&rd, &wr, &sa, 0)) { err = werr("CreatePipe"); return false; }
    SetHandleInformation(rd, HANDLE_FLAG_INHERIT, 0);

    std::wstring mutable_cmd = cmdline;
    STARTUPINFOW si{}; si.cb = sizeof si;
    si.dwFlags = STARTF_USESTDHANDLES | STARTF_USESHOWWINDOW;
    si.wShowWindow = SW_HIDE;
    si.hStdOutput = wr; si.hStdError = wr; si.hStdInput = nullptr;
    PROCESS_INFORMATION pi{};
    if (!CreateProcessW(nullptr, mutable_cmd.data(), nullptr, nullptr, TRUE, CREATE_NO_WINDOW,
                        nullptr, nullptr, &si, &pi)) {
        CloseHandle(rd); CloseHandle(wr); err = werr("CreateProcessW"); return false;
    }
    CloseHandle(wr);                                     // 父进程必须关掉写端，否则 ReadFile 不返回 EOF

    char buf[4096]; DWORD got = 0;
    const DWORD deadline = GetTickCount() + timeout_ms;
    for (;;) {
        if (!ReadFile(rd, buf, sizeof buf, &got, nullptr) || got == 0) break;
        out_utf8.append(buf, got);
        if (GetTickCount() > deadline) { err = "run_capture timeout"; break; }
    }
    WaitForSingleObject(pi.hProcess, 5000);
    CloseHandle(pi.hThread); CloseHandle(pi.hProcess); CloseHandle(rd);
    return err.empty();
}

}  // namespace ig5
