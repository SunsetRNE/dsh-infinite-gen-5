// win_socket.cpp —— WS2 回连：DNS → 非阻塞 connect + select 超时 → 发送/接收
#include "ig5_win.hpp"
#include <cstdio>

namespace ig5 {
namespace {
std::string werr(const char* what, int code) {
    char b[192];
    std::snprintf(b, sizeof b, "%s failed: code=%d", what, code);
    return b;
}
bool would_block(int e) { return e == WSAEWOULDBLOCK || e == WSAEINPROGRESS; }
}  // namespace

bool win_net_startup(std::string& err) {
    WSADATA wsa{};
    const int rc = WSAStartup(MAKEWORD(2, 2), &wsa);
    if (rc != 0) { err = werr("WSAStartup", rc); return false; }
    return true;
}
void win_net_shutdown() { WSACleanup(); }

SocketLink::~SocketLink() { close_link(); }
void SocketLink::close_link() {
    if (sock_ != INVALID_SOCKET) { closesocket(sock_); sock_ = INVALID_SOCKET; }
}

bool SocketLink::connect_to(const Endpoint& ep, int timeout_ms, std::string& err) {
    close_link();
    addrinfo hints{};
    hints.ai_family   = AF_UNSPEC;
    hints.ai_socktype = SOCK_STREAM;
    hints.ai_protocol = IPPROTO_TCP;

    addrinfo* res = nullptr;
    const std::string port = std::to_string(ep.port);
    const int gr = getaddrinfo(ep.host.c_str(), port.c_str(), &hints, &res);
    if (gr != 0) { err = werr("getaddrinfo", gr); return false; }

    for (addrinfo* ai = res; ai; ai = ai->ai_next) {
        SOCKET s = socket(ai->ai_family, ai->ai_socktype, ai->ai_protocol);
        if (s == INVALID_SOCKET) continue;
        u_long nb = 1;
        if (ioctlsocket(s, FIONBIO, &nb) != 0) { closesocket(s); continue; }

        bool ok = false;
        if (connect(s, ai->ai_addr, (int)ai->ai_addrlen) == 0) {
            ok = true;                                   // 立即成功（同机/已就绪）
        } else if (would_block(WSAGetLastError())) {
            fd_set wf; FD_ZERO(&wf); FD_SET(s, &wf);
            timeval tv{timeout_ms / 1000, (timeout_ms % 1000) * 1000};
            const int sel = select(0, nullptr, &wf, nullptr, &tv);
            if (sel > 0) {
                int soerr = 0; int len = sizeof soerr;
                if (getsockopt(s, SOL_SOCKET, SO_ERROR, reinterpret_cast<char*>(&soerr), &len) == 0 && soerr == 0) ok = true;
            } else if (sel == 0) {
                err = "connect timeout";
            }
        }
        if (ok) { sock_ = s; freeaddrinfo(res); return true; }
        closesocket(s);
    }
    freeaddrinfo(res);
    if (err.empty()) err = "connect: all addresses failed";
    return false;
}

bool SocketLink::send_all(std::span<const std::uint8_t> data, std::string& err) {
    std::size_t sent = 0;
    while (sent < data.size()) {
        const int n = send(sock_, reinterpret_cast<const char*>(data.data() + sent),
                           static_cast<int>(data.size() - sent), 0);
        if (n > 0) { sent += static_cast<std::size_t>(n); continue; }
        const int e = WSAGetLastError();
        if (would_block(e)) {
            fd_set wf; FD_ZERO(&wf); FD_SET(sock_, &wf);
            timeval tv{5, 0};
            if (select(0, nullptr, &wf, nullptr, &tv) <= 0) { err = werr("send select", WSAGetLastError()); return false; }
            continue;
        }
        err = werr("send", e);
        return false;
    }
    return true;
}

int SocketLink::recv_some(std::span<std::uint8_t> out, int timeout_ms, std::string& err) {
    fd_set rf; FD_ZERO(&rf); FD_SET(sock_, &rf);
    timeval tv{timeout_ms / 1000, (timeout_ms % 1000) * 1000};
    const int sel = select(0, &rf, nullptr, nullptr, &tv);
    if (sel == 0) return -2;                                        // 空闲，交回调度循环
    if (sel < 0)  { err = werr("recv select", WSAGetLastError()); return -1; }

    const int n = recv(sock_, reinterpret_cast<char*>(out.data()), static_cast<int>(out.size()), 0);
    if (n > 0) return n;
    if (n == 0) return 0;                                           // 对端关闭
    const int e = WSAGetLastError();
    if (would_block(e)) return -2;
    err = werr("recv", e);
    return -1;
}

}  // namespace ig5
