// selftest.cpp —— 验证件：帧编解码的 6 项断言（无磁盘写入，退出码 = 失败数）
#include "frame.hpp"
#include <cstdio>
#include <cstring>
#include <string>

using namespace ig5;
static int fails = 0;

static void check(bool ok, const char* name, const char* detail = "") {
    if (!ok) ++fails;
    std::printf("%-42s %s %s\n", name, ok ? "PASS" : "FAIL", detail);
}
static std::vector<std::uint8_t> bytes_of(const std::string& s) {
    return std::vector<std::uint8_t>(s.begin(), s.end());
}

int main() {
    // 1) CRC32 标准检验值（CRC 校验向量 "123456789" → CRC_CHECK_STR）
    const auto v = bytes_of("123456789");
    const std::uint32_t got = crc32(v);
    std::printf("%-42s CRC=%08X\n", "1 crc32 vector", got);
    check(got == CRC_CHECK_STR, "1 crc32(\"123456789\") == 校验值");

    // 2) 编解码往返
    Frame a{7, 0, bytes_of("HELLO_PAYLOAD")};
    auto wire = encode_frame(a);
    FrameDecoder d0; d0.feed(wire);
    auto r0 = d0.next();
    check(r0 && r0->opcode == a.opcode && r0->payload == a.payload &&
          !d0.next().has_value(), "2 round-trip / 无多余帧");

    // 3) 逐字节滴灌（半包重组）
    FrameDecoder d1; std::optional<Frame> r1;
    for (std::uint8_t b : wire) { d1.feed(std::span<const std::uint8_t>(&b, 1)); if (auto f = d1.next()) r1 = f; }
    check(r1 && r1->payload == a.payload, "3 1-byte drip feed 重组");

    // 4) payload 单比特翻转 → CRC 拒绝
    auto bad = wire; bad[kHeaderSize + 2] ^= 1u;
    FrameDecoder d2; d2.feed(bad);
    check(!d2.next().has_value() && d2.last_error() == "crc mismatch: drop", "4 位翻转被 CRC 拦下", d2.last_error().c_str());

    // 5) 长度字段越界 → 不预分配、整帧丢弃
    auto evil = wire; const std::uint32_t huge = (std::uint32_t)kMaxPayload + 1u;
    evil[8] = (std::uint8_t)huge; evil[9] = (std::uint8_t)(huge >> 8);
    evil[10] = (std::uint8_t)(huge >> 16); evil[11] = (std::uint8_t)(huge >> 24);
    FrameDecoder d3; d3.feed(evil);
    check(!d3.next().has_value() && d3.last_error() == "oversized frame: drop", "5 越界长度字段被丢弃", d3.last_error().c_str());

    // 6) 一次性喂入「垃圾前缀 + 两帧」→ 重新对齐后取回 2 帧
    auto two = wire; auto w2 = encode_frame(Frame{9, 0, bytes_of("SECOND")}); two.insert(two.end(), w2.begin(), w2.end());
    auto noisy = bytes_of("JUNK");
    noisy.insert(noisy.end(), two.begin(), two.end());
    FrameDecoder d4; d4.feed(noisy);
    int n = 0; while (d4.next()) ++n;
    check(n == 2, "6 12-byte 垃圾前缀下重同步取 2 帧");

    // 7) 超限载荷编码侧拒绝
    bool threw = false;
    try { encode_frame(Frame{1, 0, std::vector<std::uint8_t>(kMaxPayload + 1, 0)}); }
    catch (const std::runtime_error&) { threw = true; }
    check(threw, "7 encode 超限抛 runtime_error");

    std::printf("FAILS=%d\n", fails);
    return fails;
}
