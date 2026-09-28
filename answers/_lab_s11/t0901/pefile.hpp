#pragma once
// pefile.hpp — 只读 PE 解析器（纯 C++17，不用任何 Windows API；Windows 与 Linux 通用）
// 用途：给 pecheck.cpp（Windows 侧内存/磁盘对照）与 peverify.cpp（Linux 侧核验）共用同一份解析逻辑。
#include <cstdint>
#include <cstring>
#include <fstream>
#include <optional>
#include <string>
#include <vector>

namespace pe {

struct Section {
    std::string name;
    uint32_t va = 0, vsize = 0, raw = 0, rawsize = 0;
};

struct ExportEntry {
    std::string name;
    uint32_t rva = 0;
    uint32_t ordinal = 0;
};

class Image {
public:
    bool load(const std::string& path) {
        std::ifstream fh(path, std::ios::binary);
        if (!fh) return false;
        bytes_.assign(std::istreambuf_iterator<char>(fh), std::istreambuf_iterator<char>());
        path_ = path;
        return !bytes_.empty();
    }

    bool parse() {
        if (bytes_.size() < 0x40 + 24) return false;
        if (u16(0) != 0x5a4d) return false;                 // MZ 魔数（常量表）
        const uint32_t peOff = u32(0x3c);                   // e_lfanew 偏移（PE 头固定位置）
        if (peOff + 24 > bytes_.size()) return false;
        if (u32(peOff) != 0x00004550) return false;         // "PE\0\0" 签名（magic）
        const uint16_t numSections = u16(peOff + 6);
        const uint16_t optSize     = u16(peOff + 20);
        const uint32_t optOff      = peOff + 24;
        if (optOff + optSize > bytes_.size()) return false;
        const uint16_t magic = u16(optOff);
        if (magic != 0x20b && magic != 0x10b) return false;  // 0x20b=PE32+（64 位）/ 0x10b=PE32（magic 常量）
        is64_          = (magic == 0x20b);
        imageBase_     = is64_ ? u64(optOff + 24) : u32(optOff + 28);
        sizeOfImage_   = u32(optOff + 56);
        sizeOfHeaders_ = u32(optOff + 60);
        const uint32_t ddOff = optOff + (is64_ ? 112 : 96);  // 数据目录起始（PE32+/PE32 布局常量）
        if (ddOff + 16 > optOff + optSize) return false;
        exportRva_  = u32(ddOff);
        exportSize_ = u32(ddOff + 4);
        const uint32_t secOff = optOff + optSize;
        sections_.clear();
        for (uint16_t i = 0; i < numSections; ++i) {
            const uint32_t o = secOff + i * 40u;             // 节表项固定 40 字节（IMAGE_SECTION_HEADER 常量）
            if (o + 40 > bytes_.size()) return false;
            Section s;
            char nm[9] = {0};
            for (int k = 0; k < 8; ++k) nm[k] = static_cast<char>(bytes_[o + k]);
            s.name    = nm;
            s.vsize   = u32(o + 8);
            s.va      = u32(o + 12);
            s.rawsize = u32(o + 16);
            s.raw     = u32(o + 20);
            sections_.push_back(s);
        }
        return true;
    }

    std::optional<uint32_t> rvaToOffset(uint32_t rva) const {
        if (rva < sizeOfHeaders_) return rva;
        for (const auto& s : sections_) {
            const uint32_t span = s.vsize > s.rawsize ? s.vsize : s.rawsize;
            if (rva >= s.va && rva < s.va + span) return s.raw + (rva - s.va);
        }
        return std::nullopt;
    }

    // 从 RVA 处取 n 字节（磁盘镜像视角）；越界则返回实际可用长度
    std::vector<uint8_t> readRva(uint32_t rva, size_t n) const {
        std::vector<uint8_t> out;
        auto off = rvaToOffset(rva);
        if (!off) return out;
        for (size_t i = 0; i < n && *off + i < bytes_.size(); ++i) out.push_back(bytes_[*off + i]);
        return out;
    }

    std::vector<ExportEntry> exports() const {
        std::vector<ExportEntry> out;
        if (!exportRva_ || exportSize_ == 0) return out;
        auto dirOff = rvaToOffset(exportRva_);
        if (!dirOff || *dirOff + 40 > bytes_.size()) return out;
        const uint32_t o        = *dirOff;
        const uint32_t base     = u32(o + 16);              // Ordinal Base（导出目录固定字段）
        const uint32_t funcRva  = u32(o + 28);              // AddressOfFunctions
        const uint32_t nameRva  = u32(o + 32);              // AddressOfNames
        const uint32_t ordRva   = u32(o + 36);              // AddressOfNameOrdinals
        const uint32_t nNames   = u32(o + 24);
        auto funcOff = rvaToOffset(funcRva);
        auto namesOff = rvaToOffset(nameRva);
        auto ordOff   = rvaToOffset(ordRva);
        if (!funcOff || !namesOff || !ordOff) return out;
        for (uint32_t i = 0; i < nNames; ++i) {
            auto strOff = rvaToOffset(u32(*namesOff + i * 4));
            if (!strOff) continue;
            const uint16_t idx = u16(*ordOff + i * 2);
            ExportEntry e;
            e.name    = cstr(*strOff);
            e.ordinal = base + idx;
            if (*funcOff + static_cast<uint32_t>(idx) * 4 + 4 <= bytes_.size())
                e.rva = u32(*funcOff + static_cast<uint32_t>(idx) * 4);
            out.push_back(e);
        }
        return out;
    }

    const std::vector<uint8_t>& raw() const { return bytes_; }
    const std::string& path() const { return path_; }
    uint64_t imageBase() const { return imageBase_; }
    uint32_t sizeOfImage() const { return sizeOfImage_; }
    bool is64() const { return is64_; }
    const std::vector<Section>& sections() const { return sections_; }

private:
    uint16_t u16(size_t o) const { uint16_t v = 0; std::memcpy(&v, bytes_.data() + o, 2); return v; }
    uint32_t u32(size_t o) const { uint32_t v = 0; std::memcpy(&v, bytes_.data() + o, 4); return v; }
    uint64_t u64(size_t o) const { uint64_t v = 0; std::memcpy(&v, bytes_.data() + o, 8); return v; }
    std::string cstr(size_t o) const {
        std::string s;
        while (o < bytes_.size() && bytes_[o] != 0 && s.size() < 512) s.push_back(static_cast<char>(bytes_[o++]));
        return s;
    }

    std::vector<uint8_t> bytes_;
    std::string path_;
    std::vector<Section> sections_;
    uint64_t imageBase_ = 0;
    uint32_t sizeOfImage_ = 0, sizeOfHeaders_ = 0, exportRva_ = 0, exportSize_ = 0;
    bool is64_ = false;
};

}  // namespace pe
