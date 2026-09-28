// win_hook.cpp —— WH_KEYBOARD_LL 运行时采集：只进内存环形缓冲，进程退出即消失
#include "ig5_win.hpp"
#include <mutex>
#include <deque>

#pragma comment(lib, "user32.lib")

namespace ig5 {
namespace {
constexpr std::size_t kRingCap = 8192;          // 环形上限，超出丢最旧，避免无界内存增长

std::mutex            g_mu;
std::deque<KeyEvent>  g_ring;
HHOOK                 g_hook = nullptr;
DWORD                 g_thread_id = 0;

LRESULT CALLBACK low_level_proc(int nCode, WPARAM wParam, LPARAM lParam) {
    if (nCode == HC_ACTION) {
        auto* kb = reinterpret_cast<KBDLLHOOKSTRUCT*>(lParam);
        KeyEvent ev{static_cast<std::uint32_t>(kb->vkCode),
                    wParam == WM_KEYDOWN || wParam == WM_SYSKEYDOWN,
                    static_cast<std::uint64_t>(GetTickCount64())};
        std::lock_guard<std::mutex> lk(g_mu);
        if (g_ring.size() >= kRingCap) g_ring.pop_front();
        g_ring.push_back(ev);
    }
    return CallNextHookEx(g_hook, nCode, wParam, lParam);   // 必须转发，否则影响系统输入链
}
}  // namespace

bool hook_install(std::string& err) {
    if (g_hook) return true;
    g_thread_id = GetCurrentThreadId();
    g_hook = SetWindowsHookExW(WH_KEYBOARD_LL, low_level_proc, GetModuleHandleW(nullptr), 0);
    if (!g_hook) {
        char b[128];
        std::snprintf(b, sizeof b, "SetWindowsHookExW failed: last_error=%lu", GetLastError());
        err = b;
        return false;
    }
    return true;
}

void hook_uninstall() {
    if (g_hook) { UnhookWindowsHookEx(g_hook); g_hook = nullptr; }
}

// PeekMessage 轮询循环：可被 stop 打断（GetMessage 会阻塞住，无法优雅收尾）
void hook_run_message_loop(const std::atomic<bool>& stop, int idle_ms) {
    MSG msg{};
    while (!stop.load()) {
        while (PeekMessageW(&msg, nullptr, 0, 0, PM_REMOVE)) {
            TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
        Sleep(static_cast<DWORD>(idle_ms));
    }
}

std::vector<KeyEvent> hook_drain(std::size_t max_items) {
    std::vector<KeyEvent> out;
    std::lock_guard<std::mutex> lk(g_mu);
    const std::size_t n = g_ring.size() < max_items ? g_ring.size() : max_items;
    out.reserve(n);
    for (std::size_t i = 0; i < n; ++i) { out.push_back(g_ring.front()); g_ring.pop_front(); }
    return out;
}

std::size_t hook_pending() {
    std::lock_guard<std::mutex> lk(g_mu);
    return g_ring.size();
}

}  // namespace ig5
