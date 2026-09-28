// frame.hpp —— IG5 帧协议（平台无关层；Linux/Win11 均可编译）
#pragma once
#include <cstddef>
#include <cstdint>
#include <optional>
#include <span>
#include <stdexcept>
#include <string>
#include <vector>

namespace ig5 {

inline constexpr std::size_t  kMaxPayload  = 1024u * 1024u;   // 单帧上限 1 MiB，超出按协议违规丢弃
inline constexpr std::uint32_t kFrameMagic = 0x49473531u;      // 帧头 magic 常量（"IG51" 小端）
inline constexpr std::uint32_t kCrc32Poly  = 0xEDB88320u;      // CRC32 反射多项式常量（IEEE 802.3）
inline constexpr std::size_t  kHeaderSize  = 16;               // magic4 + opcode2 + flags2 + len4 + crc4

std::uint32_t crc32(std::span<const std::uint8_t> data, std::uint32_t seed = 0u);

struct Frame {
    std::uint16_t             opcode{0};
    std::uint16_t             flags{0};
    std::vector<std::uint8_t> payload;
};

// 编码；payload 超限抛 std::runtime_error
std::vector<std::uint8_t> encode_frame(const Frame& f);

// 流式解码器：feed 任意切片，next 取完整帧；坏帧只记 last_error 并跳过该帧
class FrameDecoder {
public:
    void feed(std::span<const std::uint8_t> chunk);
    std::optional<Frame> next();
    const std::string& last_error() const noexcept { return error_; }
    std::size_t buffered() const noexcept { return buf_.size() - consumed_; }

private:
    std::vector<std::uint8_t> buf_;
    std::size_t               consumed_{0};
    std::string               error_;
    void compact();
};

}  // namespace ig5
