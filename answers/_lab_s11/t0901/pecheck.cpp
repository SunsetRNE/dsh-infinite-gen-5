// pecheck.cpp — Windows 11 x64：把目标进程里模块的内存镜像与磁盘镜像逐字节对照，定位被 inline hook 的导出函数
// 用法:
//   pecheck.exe --pid <PID> [--module <NAME.dll>] [--scan 24] [--max 64]
//   pecheck.exe --image C:\Windows\System32\kernel32.dll      （只做磁盘侧解析，不需要目标进程）
// 特性: 模块化（解析 / 枚举 / 读取 / 比对各自成函数）、只读（PROCESS_VM_READ）、不写任何临时文件
// 退出码: 0 全部干净 / 1 检出 hook / 2 用法错 / 4 打不开进程 / 5 找不到模块 / 6 磁盘文件无法解析
#include "pefile.hpp"

#include <windows.h>
#include <tlhelp32.h>

#include <cstdint>
#include <iomanip>
#include <iostream>
#include <sstream>
#include <string>
#include <vector>

namespace {

const uint8_t JMP_REL32 = 0xE9;   // E9 = jmp rel32 首字节（示例：热补丁最常用的一字节指令编码）

struct Args {
    uint32_t pid = 0;
    std::string module;
    std::string image;
    size_t scan = 24;
    size_t maxModules = 64;
};

std::string narrow(const std::wstring& w) {
    if (w.empty()) return {};
    const int n = WideCharToMultiByte(CP_UTF8, 0, w.c_str(), -1, nullptr, 0, nullptr, nullptr);
    std::string s(n > 0 ? n - 1 : 0, '\0');
    if (n > 1) WideCharToMultiByte(CP_UTF8, 0, w.c_str(), -1, s.data(), n, nullptr, nullptr);
    return s;
}

std::wstring widen(const std::string& s) {
    if (s.empty()) return {};
    const int n = MultiByteToWideChar(CP_UTF8, 0, s.c_str(), -1, nullptr, 0);
    std::wstring w(n > 0 ? n - 1 : 0, L'\0');
    if (n > 1) MultiByteToWideChar(CP_UTF8, 0, s.c_str(), -1, w.data(), n);
    return w;
}

std::string hexline(const std::vector<uint8_t>& v, size_t n) {
    std::ostringstream os;
    for (size_t i = 0; i < n && i < v.size(); ++i)
        os << std::hex << std::setw(2) << std::setfill('0') << static_cast<int>(v[i]);
    return os.str();
}

struct ModuleInfo {
    std::wstring name;
    std::wstring path;
    uint64_t base = 0;
};

// 枚举目标进程已加载模块（含基址）——inline hook 的比对基准来自这里
bool enumModules(uint32_t pid, std::vector<ModuleInfo>& out, DWORD& err) {
    HANDLE snap = CreateToolhelp32Snapshot(TH32CS_SNAPMODULE | TH32CS_SNAPMODULE32, pid);
    if (snap == INVALID_HANDLE_VALUE) { err = GetLastError(); return false; }
    MODULEENTRY32W me{};
    me.dwSize = sizeof(me);
    if (Module32FirstW(snap, &me)) {
        do {
            out.push_back(ModuleInfo{me.szModule, me.szExePath, reinterpret_cast<uint64_t>(me.modBaseAddr)});
            me.dwSize = sizeof(me);
        } while (Module32NextW(snap, &me));
    }
    CloseHandle(snap);
    return true;
}

bool readRemote(HANDLE proc, uint64_t addr, size_t n, std::vector<uint8_t>& out) {
    out.assign(n, 0);
    SIZE_T got = 0;
    if (!ReadProcessMemory(proc, reinterpret_cast<LPCVOID>(addr), out.data(), n, &got)) return false;
    out.resize(got);
    return true;
}

Args parseArgs(int argc, char** argv, bool& ok) {
    Args a;
    ok = true;
    for (int i = 1; i < argc; ++i) {
        const std::string k = argv[i];
        auto next = [&](const char* flag) -> std::string {
            if (i + 1 >= argc) { std::cerr << "缺少参数值: " << flag << "\n"; ok = false; return {}; }
            return argv[++i];
        };
        if (k == "--pid")         a.pid = static_cast<uint32_t>(std::stoul(next("--pid")));
        else if (k == "--module") a.module = next("--module");
        else if (k == "--image")  a.image = next("--image");
        else if (k == "--scan")   a.scan = static_cast<size_t>(std::stoul(next("--scan")));
        else if (k == "--max")    a.maxModules = static_cast<size_t>(std::stoul(next("--max")));
        else { std::cerr << "未知参数: " << k << "\n"; ok = false; }
    }
    if (!ok || (a.pid == 0 && a.image.empty())) ok = false;
    return a;
}

int runImageMode(const Args& a) {
    pe::Image img;
    if (!img.load(a.image)) { std::cout << "LOAD-FAIL " << a.image << "\n"; return 6; }
    if (!img.parse())       { std::cout << "NOT-PE " << a.image << "\n"; return 6; }
    const auto exps = img.exports();
    std::cout << "IMAGE " << a.image << " arch=" << (img.is64() ? "PE32+" : "PE32")
              << " imageBase=0x" << std::hex << img.imageBase() << std::dec
              << " sections=" << img.sections().size() << " exports=" << exps.size() << "\n";
    for (const auto& e : exps) {
        auto off = img.rvaToOffset(e.rva);
        std::cout << "  export name=" << e.name << " ordinal=" << e.ordinal
                  << " rva=0x" << std::hex << e.rva << std::dec
                  << " fileOff=0x" << std::hex << (off ? *off : 0) << std::dec << "\n";
    }
    return exps.empty() ? 6 : 0;
}

int runProcessMode(const Args& a) {
    HANDLE proc = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_VM_READ, FALSE, a.pid);
    if (!proc) { std::cout << "OPEN-FAIL pid=" << a.pid << " err=" << GetLastError() << "\n"; return 4; }

    std::vector<ModuleInfo> mods;
    DWORD err = 0;
    if (!enumModules(a.pid, mods, err)) { std::cout << "SNAPSHOT-FAIL err=" << err << "\n"; CloseHandle(proc); return 4; }

    const std::wstring want = widen(a.module);
    size_t scanned = 0, totalHooked = 0, totalClean = 0, skipped = 0;
    for (const auto& m : mods) {
        if (scanned >= a.maxModules) break;
        if (!want.empty() && _wcsicmp(m.name.c_str(), want.c_str()) != 0) continue;
        ++scanned;

        pe::Image img;
        if (!img.load(narrow(m.path)) || !img.parse()) {
            std::cout << "[SKIP] module=" << narrow(m.name) << " reason=disk-image-unreadable\n";
            ++skipped;
            continue;
        }
        const auto exps = img.exports();
        if (exps.empty()) {
            std::cout << "[SKIP] module=" << narrow(m.name) << " reason=no-exports\n";
            ++skipped;
            continue;
        }
        size_t clean = 0, hooked = 0;
        for (const auto& e : exps) {
            const std::vector<uint8_t> disk = img.readRva(e.rva, a.scan);
            if (disk.size() < a.scan) continue;
            std::vector<uint8_t> mem;
            if (!readRemote(proc, m.base + e.rva, a.scan, mem) || mem.size() < a.scan) continue;
            if (mem == disk) { ++clean; continue; }
            ++hooked;
            std::cout << "[HOOK] module=" << narrow(m.name) << " export=" << e.name
                      << " addr=0x" << std::hex << (m.base + e.rva) << std::dec
                      << " first=" << static_cast<int>(mem.empty() ? 0 : mem[0])
                      << " disk=" << hexline(disk, 8) << " mem=" << hexline(mem, 8) << "\n";
            if (!mem.empty() && mem[0] == JMP_REL32)   // 首字节命中 E9 → 追加判定说明
                std::cout << "       note=jmp-rel32-patch\n";
        }
        std::cout << "SCAN pid=" << a.pid << " module=" << narrow(m.name)
                  << " base=0x" << std::hex << m.base << std::dec
                  << " exports=" << exps.size() << " clean=" << clean << " hooked=" << hooked << "\n";
        totalClean += clean;
        totalHooked += hooked;
    }
    if (want.empty() || scanned > 0) {
        std::cout << "SUMMARY pid=" << a.pid << " modules=" << scanned
                  << " clean=" << totalClean << " hooked=" << totalHooked
                  << " skipped=" << skipped << "\n";
    }
    CloseHandle(proc);
    if (scanned == 0) { std::cout << "MODULE-NOT-FOUND " << a.module << "\n"; return 5; }
    return totalHooked == 0 ? 0 : 1;
}

}  // namespace

int main(int argc, char** argv) {
    bool ok = false;
    const Args a = parseArgs(argc, argv, ok);
    if (!ok) {
        std::cout << "usage: pecheck --pid <PID> [--module <NAME.dll>] [--scan 24] [--max 64]\n"
                     "       pecheck --image <PATH-TO-PE>\n";
        return 2;
    }
    return a.image.empty() ? runProcessMode(a) : runImageMode(a);
}
