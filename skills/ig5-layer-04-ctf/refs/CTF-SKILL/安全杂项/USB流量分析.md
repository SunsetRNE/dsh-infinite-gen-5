# USB 流量分析（USB Traffic Analysis）

## 概述

USB 流量分析是 CTF 中常见的取证类型，通过分析 USB 协议的数据包来还原键盘输入、鼠标移动、数位板绘画等内容。USB 流量通常以 PCAP 格式记录，捕获在 USB 总线上的通信数据。理解 USB 协议的基本结构和 HID（Human Interface Device）规范是分析的关键。

## USB 协议基础

**USB 传输结构**：
- 数据包包含设备地址、端点、传输类型等
- 每个 USB 设备由多个配置（Configuration）、接口（Interface）和端点（Endpoint）组成
- HID 设备通过中断传输（Interrupt Transfer）发送输入报告

**Wireshark USB 过滤**：
```
usb
usb.transfer_type == 0x01  # 中断传输
usb.device_address == 2    # 按设备地址过滤
usb.endpoint_number == 0x81  # 按端点过滤
```

## 常见类型

### 键盘流量分析

USB 键盘使用 HID 协议报告按键，每个报告包含 8 字节：
- 字节 0：修饰键（Ctrl、Shift、Alt、GUI）
- 字节 1：保留
- 字节 2-7：同时按下的按键（最多 6 个）

**按键转换**：
```python
# USB HID 按键码到 ASCII 的映射
hid_map = {
    0x04: 'A', 0x05: 'B', 0x06: 'C', 0x07: 'D',
    0x08: 'E', 0x09: 'F', 0x0A: 'G', 0x0B: 'H',
    0x0C: 'I', 0x0D: 'J', 0x0E: 'K', 0x0F: 'L',
    0x10: 'M', 0x11: 'N', 0x12: 'O', 0x13: 'P',
    0x14: 'Q', 0x15: 'R', 0x16: 'S', 0x17: 'T',
    0x18: 'U', 0x19: 'V', 0x1A: 'W', 0x1B: 'X',
    0x1C: 'Y', 0x1D: 'Z',
    0x1E: '1', 0x1F: '2', 0x20: '3', 0x21: '4',
    0x22: '5', 0x23: '6', 0x24: '7', 0x25: '8',
    0x26: '9', 0x27: '0',
    0x28: 'Enter', 0x29: 'Esc', 0x2A: 'Backspace',
    0x2B: 'Tab', 0x2C: 'Space', 0x2D: '-', 0x2E: '=',
    0x2F: '[', 0x30: ']', 0x31: '\\', 0x33: ';',
    0x34: "'", 0x36: ',', 0x37: '.', 0x38: '/'
}
```

### 鼠标流量分析

USB 鼠标报告包含：
- 字节 0：按键状态（左键、右键、中键）
- 字节 1：X 轴移动
- 字节 2：Y 轴移动
- 可选字节：滚轮等

### 数位板流量分析
数位板（Digitizer Tablet）报告包含笔的 X/Y 坐标、压力、倾斜角度、笔触状态等。

**分析方式**：
- 提取坐标数据
- 使用 Python 或工具还原为图像

### 手柄流量分析
游戏手柄的 USB 报告包含按键状态、摇杆位置、扳机压力等。

### 打印机流量分析
USB 打印机流量可能包含打印的文档内容，以 Page Description Language（如 PCL、PostScript）或原始数据形式传输。

## 相关工具

- **Wireshark**：USB 流量捕获和分析
- **`tshark`**：命令行 PCAP 分析
- **`usbhid-dump`**：USB HID 设备转储
- **`usbmon`**：Linux USB 监控
- **Python**：`scapy` USB 解析、`tshark` JSON 输出处理

## 防御建议

USB 流量分析主要来自取证角度。在防御中：
- 限制物理 USB 端口的访问
- 监控异常的 USB 设备行为
- 使用 USB 设备白名单

## 示例思路

```python
# 键盘流量还原
import subprocess
import json

# 用 tshark 提取 USB 数据
result = subprocess.run([
    'tshark', '-r', 'usb.pcap', '-T', 'json',
    '-Y', 'usbhid.data'
], capture_output=True, text=True)
data = json.loads(result.stdout)

# 还原按键
hid_map = {0x04: 'a', 0x05: 'b', ...}
shift_map = {0x04: 'A', 0x05: 'B', ...}

keys = []
for packet in data:
    layers = packet['_source']['layers']
    hid_data = layers['usbhid.data']
    bytes_data = bytes.fromhex(hid_data.replace(':', ''))
    modifier = bytes_data[0]
    keycode = bytes_data[2]
    if keycode == 0:
        continue
    if modifier & 0x02 or modifier & 0x20:  # Shift
        keys.append(shift_map.get(keycode, ''))
    else:
        keys.append(hid_map.get(keycode, ''))

print(''.join(keys))
```

## 相关技能

- [WEB流量分析](WEB流量分析.md)
- [其他流量分析](其他流量分析.md)
- [流量分析](../应急响应/流量分析.md)
- [无线安全](../物联网安全/无线安全.md)
