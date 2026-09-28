#include "frame.hpp"
#include <cstring>

namespace ig5 {
namespace {

std::uint32_t rd32(const std::uint8_t* p) {
    return static_cast<std::uint32_t>(p[0]) | (static_cast<std::uint32_t>(p[1]) << 8) |
           (static_cast<std::uint32_t>(p[2]) << 16) | (static_cast<std::uint32_t>(p[3]) << 24);
}
std::uint16_t rd16(const std::uint8_t* p) {
    return static_cast<std::uint16_t>(static_cast<std::uint16_t>(p[0]) | (static_cast<std::uint16_t>(p[1]) << 8));
}
void wr32(std::uint8_t* p, std::uint32_t v) {
    p[0] = static_cast<std::uint8_t>(v);         p[1] = static_cast<std::uint8_t>(v >> 8);
    p[2] = static_cast<std::uint8_t>(v >> 16);   p[3] = static_cast<std::uint8_t>(v >> 24);
}
void wr16(std::uint8_t* p, std::uint16_t v) {
    p[0] = static_cast<std::uint8_t>(v);         p[1] = static_cast<std::uint8_t>(v >> 8);
}

}  // namespace

std::uint32_t crc32(std::span<const std::uint8_t> data, std::uint32_t seed) {
    std::uint32_t c = ~seed;
    for (std::uint8_t b : data) {
        c ^= b;
        for (int i = 0; i < 8; ++i) c = (c & 1u) ? ((c >> 1) ^ kCrc32Poly) : (c >> 1);
    }
    return ~c;
}

std::vector<std::uint8_t> encode_frame(const Frame& f) {
    if (f.payload.size() > kMaxPayload)
        throw std::runtime_error("encode_frame: payload exceeds kMaxPayload");

    std::vector<std::uint8_t> out(kHeaderSize + f.payload.size());
    wr32(out.data() + 0, kFrameMagic);
    wr16(out.data() + 4, f.opcode);
    wr16(out.data() + 6, f.flags);
    wr32(out.data() + 8, static_cast<std::uint32_t>(f.payload.size()));
    if (!f.payload.empty())
        std::memcpy(out.data() + kHeaderSize, f.payload.data(), f.payload.size());

    // CRC 链式：先对 12 字节帧头求值，再以该值为种子续算 payload
    const std::uint32_t hdr = crc32(std::span<const std::uint8_t>(out.data(), 12));
    const std::uint32_t sum = crc32(std::span<const std::uint8_t>(out.data() + kHeaderSize, f.payload.size()), hdr);
    wr32(out.data() + 12, sum);
    return out;
}

void FrameDecoder::compact() {
    if (consumed_ == 0) return;
    buf_.erase(buf_.begin(), buf_.begin() + static_cast<std::ptrdiff_t>(consumed_));
    consumed_ = 0;
}

void FrameDecoder::feed(std::span<const std::uint8_t> chunk) {
    buf_.insert(buf_.end(), chunk.begin(), chunk.end());
}

std::optional<Frame> FrameDecoder::next() {
    for (;;) {
        if (buffered() < kHeaderSize) return std::nullopt;
        const std::uint8_t* h = buf_.data() + consumed_;

        if (rd32(h) != kFrameMagic) {          // 失步：丢弃一字节重新对齐
            error_ = "bad magic: resync";
            ++consumed_; compact(); continue;
        }
        const std::uint32_t len = rd32(h + 8);
        if (len > kMaxPayload) {               // 长度字段被污染：整帧丢弃，不预分配
            error_ = "oversized frame: drop";
            consumed_ += kHeaderSize; compact(); continue;
        }
        if (buffered() < kHeaderSize + len) return std::nullopt;   // 半包，等下一片

        const std::uint32_t hdr = crc32(std::span<const std::uint8_t>(h, 12));
        const std::uint32_t sum = crc32(std::span<const std::uint8_t>(h + kHeaderSize, len), hdr);
        if (sum != rd32(h + 12)) {
            error_ = "crc mismatch: drop";
            consumed_ += kHeaderSize + len; compact(); continue;
        }

        Frame f;
        f.opcode = rd16(h + 4);
        f.flags  = rd16(h + 6);
        f.payload.assign(h + kHeaderSize, h + kHeaderSize + len);
        consumed_ += kHeaderSize + len; compact();
        return f;
    }
}

}  // namespace ig5
