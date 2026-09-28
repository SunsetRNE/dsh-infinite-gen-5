// decode_hex.cpp —— 从 stdin 读 hex，走 FrameDecoder 解析并打印字段（反向互操作用）
#include "frame.hpp"
#include <cstdio>
#include <iostream>
#include <string>
int main() {
    std::string hex, all;
    while (std::getline(std::cin, hex)) all += hex;
    std::vector<std::uint8_t> raw;
    for (std::size_t i = 0; i + 1 < all.size(); i += 2) raw.push_back((std::uint8_t)std::stoul(all.substr(i, 2), nullptr, 16));
    ig5::FrameDecoder dec; dec.feed(raw);
    int n = 0;
    while (auto f = dec.next()) {
        ++n;
        std::string pl(f->payload.begin(), f->payload.end());
        std::printf("cpp_decoded: opcode=%u flags=%u len=%zu payload=%s\n",
                    (unsigned)f->opcode, (unsigned)f->flags, f->payload.size(), pl.c_str());
    }
    if (n == 0) std::printf("cpp_decoded: none (err=%s)\n", dec.last_error().c_str());
    return 0;
}
