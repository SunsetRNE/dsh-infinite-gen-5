// peverify.cpp — 用同一份 pefile.hpp 在 Linux 上核验 PE 解析：阳性（导出名集合完全一致）+ 阴性（缺失的名字必须判失败）
// 用法: peverify IMAGE [EXPECTED_EXPORT ...]
// 退出码: 0=名字集合一致 / 1=不一致 / 2=用法错 / 4=读不到 / 5=不是 PE / 6=没有导出表
#include "pefile.hpp"

#include <algorithm>
#include <iostream>
#include <set>
#include <string>
#include <vector>

int main(int argc, char** argv) {
    if (argc < 2) {
        std::cerr << "usage: peverify IMAGE [EXPECTED_EXPORT ...]\n";
        return 2;
    }
    pe::Image img;
    if (!img.load(argv[1])) { std::cout << "LOAD-FAIL " << argv[1] << "\n"; return 4; }
    if (!img.parse())       { std::cout << "NOT-PE " << argv[1] << "\n"; return 5; }

    const auto exps = img.exports();
    std::cout << "IMAGE " << img.path()
              << " arch=" << (img.is64() ? "PE32+" : "PE32")
              << " imageBase=0x" << std::hex << img.imageBase() << std::dec
              << " sections=" << img.sections().size()
              << " exports=" << exps.size() << "\n";
    for (const auto& e : exps) {
        auto off = img.rvaToOffset(e.rva);
        std::cout << "  export name=" << e.name
                  << " ordinal=" << e.ordinal
                  << " rva=0x" << std::hex << e.rva << std::dec
                  << " fileOff=0x" << std::hex << (off ? *off : 0) << std::dec
                  << (off ? "" : " (unmapped)") << "\n";
    }
    if (exps.empty()) { std::cout << "NO-EXPORTS " << img.path() << "\n"; return 6; }

    std::set<std::string> got;
    for (const auto& e : exps) got.insert(e.name);
    std::set<std::string> want(argv + 2, argv + argc);
    std::vector<std::string> missing, extra;
    for (const auto& w : want) if (!got.count(w)) missing.push_back(w);
    for (const auto& g : got)  if (!want.count(g)) extra.push_back(g);

    if (!want.empty() && (missing.empty() && extra.empty())) {
        std::cout << "PEVERIFY OK exports=" << got.size() << " matched=" << want.size() << "\n";
        return 0;
    }
    std::cout << "PEVERIFY MISMATCH missing=" << missing.size() << " extra=" << extra.size() << "\n";
    for (const auto& m : missing) std::cout << "  missing=" << m << "\n";
    for (const auto& x : extra)   std::cout << "  extra=" << x << "\n";
    return 1;
}
