// hookself.cpp — 阳对照目标：把自己的一个导出函数头部改成 jmp rel32（热补丁），随后挂住不退，
// 供 pecheck.exe 在另一进程里检出「内存镜像 != 磁盘镜像」。只作用于自身进程，不写磁盘。
// 编译: cl /std:c++17 /EHsc /O2 hookself.cpp /Fe:hookself.exe   或   x86_64-w64-mingw32-g++ -std=c++17 -O2 -o hookself.exe hookself.cpp
#include <windows.h>

#include <cstdint>
#include <cstdio>

extern "C" __declspec(dllexport) int pev_alpha(int x) { return x + 1; }

static volatile LONG g_hits = 0;
extern "C" __declspec(noinline) int stub_alpha(int x) {
    InterlockedIncrement(&g_hits);
    return x;
}

namespace {

const uint8_t JMP_REL32 = 0xE9;     // E9 = jmp rel32 首字节（示例：最短的热补丁指令常量）
const size_t PATCH_LEN = 5;         // 1 字节操作码 + 4 字节相对位移（x64 上 rel32 跳转的固定长度）

bool patch(void* target, void* hook) {
    DWORD oldProt = 0;
    if (!VirtualProtect(target, PATCH_LEN, PAGE_EXECUTE_READWRITE, &oldProt)) return false;
    auto* p = static_cast<uint8_t*>(target);
    const intptr_t rel = reinterpret_cast<intptr_t>(hook) - (reinterpret_cast<intptr_t>(target) + PATCH_LEN);
    p[0] = JMP_REL32;
    *reinterpret_cast<int32_t*>(p + 1) = static_cast<int32_t>(rel);
    FlushInstructionCache(GetCurrentProcess(), p, PATCH_LEN);
    DWORD tmp = 0;
    VirtualProtect(target, PATCH_LEN, oldProt, &tmp);
    return true;
}

}  // namespace

int main() {
    const bool patched = patch(reinterpret_cast<void*>(&pev_alpha), reinterpret_cast<void*>(&stub_alpha));
    std::printf("PATCHED target=%p stub=%p ok=%d\n",
                reinterpret_cast<void*>(&pev_alpha), reinterpret_cast<void*>(&stub_alpha), patched ? 1 : 0);
    std::printf("PID=%lu 等待被检（Ctrl+C 退出）\n", GetCurrentProcessId());
    std::printf("call pev_alpha(1)=%d hits=%ld\n", pev_alpha(1), static_cast<long>(g_hits));
    Sleep(120000);
    return patched ? 0 : 1;
}
