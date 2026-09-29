# 隐写分析模块 (Steganography)

> 环境：binwalk✅ foremost✅ strings✅ python3✅ tcpdump✅
> 目标：检测和提取隐藏在图片/音频/文件/网络流量中的信息

---

## 知识锚点（Playbook + H1 案例）

> 隐写分析发现的隐藏数据，本质是信息泄露的一种隐蔽形式，对接 playbook 可复用报告框架。

### 关联 Playbook

- `references/playbooks/info-disclosure.md` — 隐写提取出的凭据/密钥/敏感数据，走信息泄露 playbook 的"隐蔽通道"分支

### 关联 H1 案例（references/h1-reports/by-weakness/）

- `information-disclosure.md` — 通过隐写通道泄露的敏感信息
- `cleartext-storage-of-sensitive-information.md` — 在图片元数据、文件尾部、LSB 中明文存储敏感数据

### Payload / 工具

- LSB 提取 / 零宽字符检测 / 编码解码 / 文件尾部提取：脚本已内联于下方各分析段落，直接复制执行
- 工具链：binwalk（嵌入检测）→ foremost（文件恢复）→ python3+PIL（LSB/EXIF）→ strings（文本提取）→ tshark（流量隐写）

## 底层原理：隐写不是"加密"，是"藏在眼皮底下"

```
加密：明文 → 算法 → 密文（看起来像乱码，引起怀疑）
隐写：明文 → 嵌入载体 → 载体（看起来正常，不引起怀疑）

隐写的核心矛盾：
- 嵌入容量 vs 不可检测性（藏得越多越容易被发现）
- 鲁棒性 vs 不可感知性（抗压缩/裁剪 vs 肉眼不可见）

常见嵌入位置：
1. 像素最低有效位(LSB)：每个像素的最后一个bit，改变不被人眼察觉
2. 变换域(DCT/DWT)：JPEG压缩后的频域系数，改变微小系数
3. 文件元数据：EXIF/IPTC/XMP，图片不自带显示但可以存储任意数据
4. 文件结构：在文件末尾追加数据，图片查看器忽略尾部
5. 音频频谱：高频/低频区域嵌入，人耳听不到
6. 网络协议：TCP ISN/DNS TXT/HTTP Header/ICMP payload
```

### 隐写分析决策树

```
发现可疑文件，该怎么做？

1. 它是什么格式？
   file unknown.bin → 确定真实格式
   格式不对？可能是伪装（改扩展名）

2. 文件大小正常吗？
   同类图片对比：这个PNG是否比正常大很多？
   用 binwalk 看是否有嵌入式文件

3. 有没有隐藏文件？
   binwalk -e 提取嵌入文件
   foremost 恢复被删除/覆盖的文件
   strings 提取所有可读文本

4. 有没有元数据异常？
   exiftool 查看所有元数据
   特别注意：Artist/Comment/Description/UserComment 字段

5. 像素/音频有没有LSB隐藏？
   zsteg 检测图片LSB
   LSB提取脚本
   音频频谱分析

6. 有没有编码/密码？
   base64/base32/base58/hex 解码
   摩斯密码/培根密码/零宽字符检测
```

---

## 图片隐写分析

### 1. 快速检查

```bash
# 文件基本信息
file suspicious.png
identify -verbose suspicious.png  # 如果无 ImageMagick，用 python3
python3 -c "
from PIL import Image
img = Image.open('suspicious.png')
print(f'Format: {img.format}, Size: {img.size}, Mode: {img.mode}')
print(f'Info: {img.info}')
"

# 文件大小异常检测
ls -la suspicious.png
# 对比同分辨率图片的大小，如果明显偏大，可能有隐藏数据

# 嵌入文件检测
binwalk suspicious.png
binwalk -e suspicious.png              # 提取嵌入文件
binwalk -Me suspicious.png             # 递归提取

# 字符串提取
strings suspicious.png | grep -iE "flag|password|secret|key|CTF|hidden|{" 
strings suspicious.png | grep -oE '[A-Za-z0-9+/]{20,}={0,2}'  # Base64
strings suspicious.png | grep -oE '[0-9a-fA-F]{32,}'          # Hex
```

### 2. LSB（最低有效位）隐写检测

```python
# 本机 pillow ✅

from PIL import Image
import sys

img = Image.open('suspicious.png')
pixels = list(img.getdata())

# 方法1：提取所有像素的 LSB
for plane in range(3):  # R, G, B
    bits = ''
    for pixel in pixels:
        bits += str(pixel[plane] & 1)
    # 每8位转一个字符
    chars = []
    for i in range(0, len(bits) - 8, 8):
        byte = int(bits[i:i+8], 2)
        if 32 <= byte <= 126:  # 可打印字符
            chars.append(chr(byte))
    result = ''.join(chars)
    if len(result) > 20 and not result.startswith('\x00'*10):
        print(f"Plane {plane}: {result[:200]}")

# 方法2：LSB 可视化（看哪些位平面有异常）
# 正常图片的 LSB 看起来是随机噪声
# 如果 LSB 有明显的规律/图案，很可能是隐写
for plane in range(3):
    lsb_img = Image.new('1', img.size)
    lsb_pixels = [(pixel[plane] & 1) * 255 for pixel in pixels]
    lsb_img.putdata(lsb_pixels)
    lsb_img.save(f'lsb_plane_{plane}.png')
    print(f"Saved LSB plane {plane} visualization")

# 方法3：检查 LSB 的统计分布
# 正常图片：LSB 0 和 1 各约 50%
# 隐写后：可能偏离 50%
for plane in range(3):
    zeros = sum(1 for p in pixels if (p[plane] & 1) == 0)
    ones = len(pixels) - zeros
    ratio = zeros / len(pixels)
    print(f"Plane {plane}: 0={zeros} 1={ones} ratio={ratio:.3f}")
    if ratio < 0.45 or ratio > 0.55:
        print(f"  !! Plane {plane} LSB 分布异常！")
```

### 3. 元数据提取

```bash
# exiftool 如果未安装，用 python3 pillow
python3 << 'EOF'
from PIL import Image
from PIL.ExifTags import TAGS, GPSTAGS
import os

def get_exif(img_path):
    img = Image.open(img_path)
    exif_data = img._getexif()
    if not exif_data:
        print("无 EXIF 数据")
        return
    
    for tag_id, value in exif_data.items():
        tag = TAGS.get(tag_id, tag_id)
        # GPS 数据特殊处理
        if tag == 'GPSInfo':
            gps = {}
            for key in value:
                gps_key = GPSTAGS.get(key, key)
                gps[gps_key] = value[key]
            print(f"GPS: {gps}")
        elif tag in ('MakerNote', 'UserComment'):
            # 这些字段经常藏数据
            if isinstance(value, bytes):
                print(f"{tag}: {value[:200]}")
            else:
                print(f"{tag}: {str(value)[:200]}")
        else:
            print(f"{tag}: {value}")

get_exif('suspicious.png')
EOF

# 查看所有元数据（包括非EXIF）
python3 -c "
from PIL import Image
img = Image.open('suspicious.png')
for k, v in img.info.items():
    print(f'{k}: {str(v)[:200]}')
"
```

### 4. 文件末尾追加数据检测

```bash
# 图片在文件末尾之后可能还有数据
# 用 binwalk 看结构
binwalk suspicious.png

# 手动提取尾部数据
python3 << 'EOF'
with open('suspicious.png', 'rb') as f:
    data = f.read()

# PNG 文件结束标记：IEND 块
png_end = b'IEND\xaeB`\x82'
pos = data.find(png_end)
if pos >= 0:
    trailer = data[pos + len(png_end):]
    if len(trailer) > 0:
        print(f"发现尾部数据: {len(trailer)} bytes")
        print(f"Hex: {trailer[:100].hex()}")
        print(f"Text: {trailer[:200]}")
        # 保存尾部数据
        with open('trailer_extracted.bin', 'wb') as f:
            f.write(trailer)
        print("已保存到 trailer_extracted.bin")
EOF
```

---

## 音频隐写分析

```bash
# 1. 频谱图分析（最常用）
# sox 如果未安装，用 python3 scipy
python3 << 'EOF'
import wave, struct, math

with wave.open('suspicious.wav', 'rb') as w:
    frames = w.readframes(w.getnframes())
    # 简单频谱分析：提取高频部分
    samples = struct.unpack(f'<{w.getnframes()}h', frames)
    
    # 找高频信号（可能藏了数据）
    high_freq = [s for s in samples if abs(s) > 10000]
    if high_freq:
        print(f"高频信号: {len(high_freq)} 个样本")
    
    # 找极低振幅（LSB 可能在这里）
    low_amp = [s for s in samples if abs(s) < 10]
    if low_amp:
        print(f"极低振幅: {len(low_amp)} 个样本")
        # 提取这些样本的 LSB
        bits = ''.join(str(s & 1) for s in low_amp[:1000])
        print(f"LSB bits: {bits[:200]}")
EOF

# 2. 元数据
python3 -c "
import subprocess
result = subprocess.run(['exiftool', 'suspicious.wav'], capture_output=True, text=True)
print(result.stdout)
" 2>/dev/null || python3 -c "
# 手动解析 WAV 头
with open('suspicious.wav', 'rb') as f:
    header = f.read(44)
    print(f'ChunkID: {header[0:4]}')
    print(f'ChunkSize: {int.from_bytes(header[4:8], \"little\")}')
    print(f'Format: {header[8:12]}')
    # 头部之后的数据
    extra = f.read()
    print(f'Extra data after header: {len(extra)} bytes')
" 2>/dev/null

# 3. 莫尔斯码/双音多频检测
# 如果音频是规律的嘀嗒声，可能是莫尔斯码
```

---

## 编码隐写分析

```python
# 最常见的编码隐写形式

import base64, re, codecs

data = "可疑的编码字符串"

# 1. Base64 系列
for encoding in ['base64', 'base32', 'base16', 'base85']:
    try:
        decoded = base64.b64decode(data)  # 等
        print(f"{encoding}: {decoded}")
    except:
        pass

# 2. Hex 解码
if re.match(r'^[0-9a-fA-F]+$', data):
    try:
        print(f"Hex: {bytes.fromhex(data)}")
    except:
        pass

# 3. ROT13
print(f"ROT13: {codecs.decode(data, 'rot_13')}")

# 4. 零宽字符检测
# \u200b(零宽空格) \u200c(零宽非连接符) \u200d(零宽连接符)
# \uFEFF(零宽不换行空格) \u2060(词连接符) \u2061-2064(数学零宽)
zw_chars = {'\u200b': '0', '\u200c': '1', '\u200d': ' ', '\uFEFF': ' '}
if any(c in data for c in zw_chars):
    bits = ''.join(zw_chars.get(c, '') for c in data if c in zw_chars)
    print(f"零宽字符: {bits}")
    # 尝试解码为二进制
    for i in range(0, len(bits) - 8, 8):
        byte = int(bits.replace(' ', '')[i:i+8], 2)
        print(chr(byte), end='')

# 5. 摩尔斯码
morse_table = {
    '.-': 'A', '-...': 'B', '-.-.': 'C', '-..': 'D', '.': 'E',
    '..-.': 'F', '--.': 'G', '....': 'H', '..': 'I', '.---': 'J',
    '-.-': 'K', '.-..': 'L', '--': 'M', '-.': 'N', '---': 'O',
    '.--.': 'P', '--.-': 'Q', '.-.': 'R', '...': 'S', '-': 'T',
    '..-': 'U', '...-': 'V', '.--': 'W', '-..-': 'X', '-.--': 'Y',
    '--..': 'Z', '.----': '1', '..---': '2', '...--': '3',
    '....-': '4', '.....': '5', '-....': '6', '--...': '7',
    '---..': '8', '----.': '9', '-----': '0'
}
# 检测莫尔斯码模式
if re.match(r'^[.\- /]+$', data.strip()):
    decoded = ''.join(morse_table.get(c, c) for c in data.split())
    print(f"莫尔斯码: {decoded}")
```

---

## 网络流量隐写检测

```bash
# 用 tcpdump 抓包，然后分析
tcpdump -i any -w capture.pcap -c 1000

# 1. DNS 隧道检测
# 查询异常长的域名（可能是编码数据）
tshark -r capture.pcap -Y "dns" -T fields -e dns.qry.name | \
  awk 'length($0) > 50 {print length, $0}'

# 2. ICMP 隧道检测
# ICMP 包的 payload 通常很小，如果很大可能是隧道
tshark -r capture.pcap -Y "icmp" -T fields -e frame.len | \
  awk '$1 > 100 {print "大ICMP包:", $1}'

# 3. HTTP Header 隐写
# 检查异常的 Header 字段
tshark -r capture.pcap -Y "http" -T fields -e http.host -e http.user_agent \
  -e http.referer -e http.cookie | sort -u

# 4. TCP ISN 隐写
# 初始序列号可能有规律
tshark -r capture.pcap -Y "tcp.flags.syn==1 and tcp.flags.ack==0" \
  -T fields -e tcp.seq
```

---

## 本机环境速查

```
已安装: binwalk✅ foremost✅ strings✅ python3(PIL)✅ tcpdump✅ tshark✅
缺失:   zsteg (pip超时) / exiftool (apt install imagemagick 可能可用) / steghide / stegsolve
替代:   python3 PIL 替代 zsteg
        python3 手动解析 EXIF 替代 exiftool
        binwalk + foremost + strings 组合覆盖大部分隐写分析需求

注意: 音频频谱分析需要 sox 或 scipy
      安装: apt install sox 或 pip3 install --break-system-packages scipy
```

---

## 反爬钩子

> 隐写分析以本地文件处理为主，反爬场景集中在样本获取环节。

- **本地分析不涉及反爬**：图片/音频/文件/PCAP 的隐写检测全部在本地完成
- **下载样本可能遇反爬**：从 CTF 平台、样本库下载待分析文件时，可能遇到下载频率限制或登录验证
- **上传在线检测平台可能受限**：将可疑文件上传到在线隐写分析/沙箱平台时，可能有文件大小限制和反爬策略
- **应对策略**：详见 `references/methodology/06-anti-antibot.md`，本地检测保持原节奏，在线交互时使用认证并控制上传频率

## 经验回写

每次隐写分析任务完成后，记录：
- 文件类型和来源
- 使用的检测方法
- 发现的隐藏信息
- 编码/加密方式
- 提取脚本（保存到 payloads/）