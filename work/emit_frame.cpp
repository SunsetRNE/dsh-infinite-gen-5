// emit_frame.cpp —— 把一帧编码结果以 hex 打到 stdout，用于跨语言互操作核验
#include "frame.hpp"
#include <cstdio>
#include <string>
int main(int argc, char** argv) {
    const std::string payload = argc > 1 ? argv[1] : "HELLO_PAYLOAD";
    auto wire = ig5::encode_frame(ig5::Frame{7, 0, std::vector<std::uint8_t>(payload.begin(), payload.end())});
    for (std::uint8_t b : wire) std::printf("%02x", b);
    std::printf("\n");
    return 0;
}
