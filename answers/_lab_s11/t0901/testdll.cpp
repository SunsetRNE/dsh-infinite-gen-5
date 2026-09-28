// testdll.cpp — 验证用目标 PE：产出三个已知导出名，供 peverify 做「导出表解析正确性」的阳性对照
// 编译（本机实测用的交叉编译命令）: x86_64-w64-mingw32-g++ -std=c++17 -O2 -shared -o testdll.dll testdll.cpp
#include <cstdint>

extern "C" {

__declspec(dllexport) int pev_alpha(int x) { return x + 1; }
__declspec(dllexport) int pev_beta(int x)  { return x * 2; }
__declspec(dllexport) const char* pev_gamma() { return "peverify"; }

}
