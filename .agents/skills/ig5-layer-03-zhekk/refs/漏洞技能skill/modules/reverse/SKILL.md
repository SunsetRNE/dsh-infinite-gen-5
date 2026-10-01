# 逆向工程模块 (Reverse Engineering)

> 环境：radare2✅ gdb✅ objdump✅ strings✅ frida✅ jadx✅ apktool✅
> 目标：ELF/So/APK/固件/二进制 — 从静态分析到动态调试到代码修改

---

## 知识锚点（Playbook + H1 案例）

> 逆向分析前先查阅 playbook 确认分析路径，H1 案例提供真实漏洞模式参考，Frida 脚本库提供现成 Hook 载荷。

### Playbook（攻击手册）

| 方向 | Playbook 路径 |
|------|--------------|
| 移动安全 | `references/playbooks/mobile.md` |

### H1 真实案例（按弱点分类）

| 漏洞类型 | H1 案例路径 |
|----------|------------|
| Android组件导出 | `references/h1-reports/by-weakness/improper-export-of-android-application-components.md` |
| 硬编码凭据 | `references/h1-reports/by-weakness/use-of-hard-coded-credentials.md` |
| 硬编码密钥 | `references/h1-reports/by-weakness/use-of-hard-coded-cryptographic-key.md` |
| 明文存储敏感信息 | `references/h1-reports/by-weakness/cleartext-storage-of-sensitive-information.md` |
| 不安全存储 | `references/h1-reports/by-weakness/insecure-storage-of-sensitive-information.md` |
| 弱加密算法 | `references/h1-reports/by-weakness/use-of-a-broken-or-risky-cryptographic-algorithm.md` |
| 证书校验不当 | `references/h1-reports/by-weakness/improper-certificate-validation.md` |

### Payload 库

| 用途 | Payload 路径 |
|------|-------------|
| Frida Hook脚本 | `payloads/mobile/frida-scripts.md` |

---

## 底层原理：逆向不是"看代码"，是"恢复设计意图"

```
二进制 → 反汇编(机器码→汇编) → 反编译(汇编→高级语言) → 理解逻辑 → 修改行为

ARM64 核心概念（当前设备架构）：
- 寄存器: x0-x30(通用), sp(栈), pc(程序计数器), lr(x30, 返回地址)
- 调用约定: x0-x7 传参, x0 返回值, x8 间接结果
- 指令集: ARMv8-A, 支持 A64(64位) 和 A32/T32(32位)
- 关键指令: B/BL(跳转), RET(返回), ADRP/ADD(地址加载), LDR/STR(内存读写), CMP/CBZ/CBNZ(比较/条件跳转)
```

### 逆向思维框架

```
拿到一个二进制，按这个顺序问：

1. 它是什么格式？
   ELF? Mach-O? PE? 裸二进制? 固件镜像?
   → file / readelf / rabin2

2. 它是怎么编译的？
   什么语言? 什么编译器? 开了什么保护?
   → strings找特征 / rabin2 -I 看架构 / checksec看保护

3. 它的入口在哪？怎么执行到关键逻辑？
   main? JNI_OnLoad? .init_array? 动态注册?
   → readelf -s 看符号表 / objdump -d 看入口 / 字符串交叉引用找关键函数

4. 关键函数做了什么？
   输入→处理→输出，数据流是什么?
   → 静态分析(radare2/jadx) + 动态调试(gdb/Frida)

5. 怎么修改它？
   改跳转条件? Hook函数? 替换so? 重打包APK?
```

---

## 静态分析：不运行代码，从文件里提取一切

### ELF / So 分析

```bash
# 1. 格式识别
file libnative.so                    # 架构、链接方式
readelf -h libnative.so              # ELF头：入口点、程序头偏移
readelf -l libnative.so              # 段表：哪些段可读可写可执行
readelf -s libnative.so              # 符号表：导出的函数名
readelf -d libnative.so              # 动态段：依赖哪些so
readelf -r libnative.so              # 重定位表：哪些外部函数被调用

# 2. 字符串提取（最重要的一步）
strings libnative.so | grep -iE "key|secret|password|token|encrypt|decrypt|AES|DES|RSA|MD5|SHA|Base64|url|http|api|native|JNI"
strings libnative.so | grep -iE "error|fail|success|denied|bypass|root|debug|frida|xposed|magisk"
strings libnative.so | grep -oE '[A-Za-z0-9+/]{20,}={0,2}'  # Base64 编码字符串

# 3. 反汇编（radare2）
r2 -A libnative.so                   # 自动分析
  > afl                              # 列出所有函数
  > axt @@ sym.*                     # 交叉引用分析
  > pdf @ main                       # 反汇编 main 函数
  > iz                               # 列出所有字符串及地址
  > axt @@ str.*                     # 哪些函数引用了这些字符串
  > VV @ 0x...                       # 可视化模式
  > s sym.JNI_OnLoad; pdf            # 分析 JNI 入口

# 4. 反汇编（objdump，不需要交互）
objdump -d libnative.so              # 完整反汇编
objdump -d libnative.so | grep -A5 "JNI_OnLoad"  # 定位 JNI 入口
objdump -d -M intel libnative.so | grep -B3 -A3 "bl "  # 定位函数调用
```

### APK 分析

```bash
# 1. 反编译
jadx target.apk -d jadx_out/                          # Java层 → 可读源码
apktool d target.apk -o apktool_out/                  # Smali层 + 资源
unzip -l target.apk | grep "\.so$"                    # 列出所有 native 库

# 2. 快速定位关键代码
grep -r "http\|https\|api" jadx_out/sources/          # 网络请求
grep -r "encrypt\|decrypt\|AES\|RSA\|MD5\|SHA" jadx_out/sources/  # 加密逻辑
grep -r "SharedPreferences\|SQLite\|FileOutputStream" jadx_out/sources/  # 数据存储
grep -r "getSystemService\|checkSelfPermission" jadx_out/sources/  # 权限使用
grep -r "loadLibrary\|System.load" jadx_out/sources/  # Native 方法声明

# 3. 分析 Native 层
# 先找到 Java 层的 native 声明
grep -r "native " jadx_out/sources/ | grep -v "/R/"
# 然后在 So 里找对应的 JNI 函数，函数名规则：
# Java_com_example_app_ClassName_methodName
strings lib/arm64-v8a/*.so | grep "^Java_"
```

---

## 动态分析：运行时观察和修改

### Frida Hook（最强大的动态分析手段）

```javascript
// 环境：本机 Frida 17.16.4 ✅，USB 连接 Android 设备

// === 1. SSL Pinning 绕过（最常用） ===
Java.perform(function() {
    // 信任所有证书
    var TrustManager = Java.use('javax.net.ssl.X509TrustManager');
    TrustManager.checkServerTrusted.implementation = function(chain, authType) {
        console.log('[+] SSL Pinning bypassed');
    };
    // OkHttp 3.x
    try {
        var OkHttpClient = Java.use('okhttp3.OkHttpClient$Builder');
        OkHttpClient.hostnameVerifier.implementation = function(verifier) {
            return Java.use('javax.net.ssl.HostnameVerifier').class;
        };
    } catch(e) {}
});

// === 2. Root 检测绕过 ===
Java.perform(function() {
    // su 文件检测
    var File = Java.use('java.io.File');
    File.exists.implementation = function() {
        var path = this.getPath();
        if (path.indexOf('su') >= 0 || path.indexOf('magisk') >= 0 ||
            path.indexOf('xposed') >= 0 || path.indexOf('frida') >= 0) {
            console.log('[+] Bypass root check: ' + path);
            return false;
        }
        return this.exists.call(this);
    };
    // 包名检测
    var PackageManager = Java.use('android.app.ApplicationPackageManager');
    PackageManager.getPackageInfo.implementation = function(pkg, flags) {
        if (pkg.indexOf('magisk') >= 0 || pkg.indexOf('frida') >= 0 ||
            pkg.indexOf('xposed') >= 0 || pkg.indexOf('supersu') >= 0) {
            console.log('[+] Bypass package check: ' + pkg);
            throw Java.use('android.content.pm.PackageManager$NameNotFoundException').$new();
        }
        return this.getPackageInfo.call(this, pkg, flags);
    };
});

// === 3. 加密函数 Hook ===
Java.perform(function() {
    var Cipher = Java.use('javax.crypto.Cipher');
    var orig_doFinal = Cipher.doFinal.overload('[B');
    orig_doFinal.implementation = function(input) {
        console.log('[+] Cipher mode: ' + this.getOpMode());
        console.log('[+] Input: ' + bytesToHex(input));
        var result = orig_doFinal.call(this, input);
        console.log('[+] Output: ' + bytesToHex(result));
        return result;
    };
    function bytesToHex(bytes) {
        var hex = [];
        for (var i = 0; i < bytes.length; i++) {
            hex.push(('0' + (bytes[i] & 0xFF).toString(16)).slice(-2));
        }
        return hex.join('');
    }
});

// === 4. Native 函数 Hook ===
Interceptor.attach(Module.findExportByName('libnative.so', 'check_signature'), {
    onEnter: function(args) {
        console.log('[+] check_signature called');
        console.log('    arg0: ' + args[0]);
        console.log('    arg1: ' + Memory.readUtf8String(args[1]));
    },
    onLeave: function(retval) {
        console.log('[+] Original return: ' + retval);
        retval.replace(0);  // 强制返回 0 (成功)
        console.log('[+] Modified return: 0');
    }
});

// === 5. 内存搜索和修改 ===
var pattern = '48 65 6c 6c 6f';  // "Hello" 的 hex
var results = Memory.scanSync(Module.findBaseAddress('libnative.so'), 
    Process.pointerSize * 0x10000, pattern);
results.forEach(function(match) {
    console.log('[+] Found pattern at: ' + match.address);
    // 修改内存
    Memory.writeByteArray(match.address, [0x00, 0x00, 0x00, 0x00, 0x00]);
});
```

### GDB 动态调试（So 级调试）

```bash
# 本机 gdb ✅ 已安装

# 1. 启动调试
gdb -q ./binary
  > break *0x1234                    # 在地址设断点
  > break main                       # 在函数设断点
  > run                              # 运行
  > info registers                   # 查看寄存器
  > x/10x $sp                        # 查看栈 10 个 word
  > x/s $x0                          # 查看 x0 指向的字符串
  > disassemble main                 # 反汇编 main
  > stepi                            # 单步执行一条指令
  > continue                         # 继续运行

# 2. 远程调试（调试 Android 设备上的进程）
gdbserver :1234 --attach $(pidof com.target.app)
# 在 proot 终端：
gdb -q
  > target remote 127.0.0.1:1234
  > info sharedlibrary              # 列出加载的 so
  > add-symbol-file libnative.so 0x...  # 加载符号
```

---

## 常见保护机制及绕过

```
保护机制                  检测方法                        绕过方法
────────────────────────────────────────────────────────────────
SSL Pinning              抓包无响应/证书错误              Frida Hook 绕过
Root 检测                检测 su/magisk/xposed/frida      Frida Hook 绕过
代码混淆(ProGuard)       类名方法名变为 a/b/c             耐心分析 + 字符串定位
字符串加密                strings 无有用输出               Frida Hook 解密函数
反调试(ptrace)           无法 attach gdb                  Frida -f spawn 模式
完整性校验               重打包后闪退                     分析校验逻辑 + Hook 绕过
加固(360/腾讯/梆梆)       jadx 看不到源码                  脱壳: frida-dexdump
模拟器检测                检测 /dev/qemu_pipe 等            Frida Hook 绕过
```

---

## 决策树：拿到一个目标，该怎么做

```
目标是什么？
├── APK 应用
│   ├── 有源码（开源/自研） → jadx 反编译 → grep 关键词 → 静态分析
│   ├── 无源码但未加固 → jadx 看 Java + apktool 看 Smali + Frida 动态
│   └── 加固/混淆 → frida-dexdump 脱壳 → 再分析
├── ELF 可执行文件
│   ├── 有符号 → objdump -d + strings → 定位关键函数 → gdb 调试
│   └── 无符号/stripped → strings 定位 → 交叉引用 → gdb 动态跟踪
├── .so 库文件
│   ├── 有 JNI 函数 → strings 找 Java_ 前缀 → Frida Hook 入口
│   └── 纯 C/C++ 库 → readelf 看导出 → Frida Interceptor 或 gdb
└── 固件/裸二进制
    ├── binwalk -e 提取 → file 识别各组件 → 逐个分析
    └── 未知格式 → hexdump 看 magic bytes → 搜索文件格式签名
```

---

## 实战流程：从 APK 到漏洞

```bash
# 1. 获取 APK
adb shell pm list packages | grep target
adb shell pm path com.target.app
adb pull /data/app/.../base.apk target.apk

# 2. 静态分析
jadx target.apk -d jadx_out/
grep -r "http" jadx_out/sources/ | grep -v "schemas.android"  # 找 API 端点
grep -r "password\|token\|secret\|key" jadx_out/sources/      # 找硬编码凭据
apktool d target.apk -o apktool_out/
grep -r "android:exported=\"true\"" apktool_out/              # 找导出组件

# 3. 动态分析
adb install target.apk
frida -U -l bypass_pinning.js -f com.target.app --no-pause
# 在另一终端观察日志
frida -U com.target.app -l hook_crypto.js

# 4. 修改和重打包
apktool d target.apk -o mod/
# 修改 Smali 代码或资源
apktool b mod/ -o modified.apk
# 生成自签名证书
keytool -genkey -v -keystore debug.keystore -alias debug -keyalg RSA -keysize 2048 -validity 365 -storepass android -keypass android -dname "CN=Debug"
jarsigner -keystore debug.keystore -storepass android modified.apk debug
adb install modified.apk
```

---

## 本机环境速查

```
已安装: radare2✅ gdb✅ objdump✅ strings✅ frida 17.16.4✅ jadx✅ apktool✅
缺失:   IDA Pro (商业) / Ghidra (需Java GUI) / x64dbg (Windows)
替代:   radare2 + gdb + Frida 组合覆盖大部分逆向需求

ARM64 注意: 本机分析的二进制基本是 ARM64，不需要 qemu 转换
            但 x86_64 二进制需要 qemu-x86_64-static 运行
```

---

## 反爬钩子

> 逆向工程的反爬/防护场景主要集中在二进制层面的保护机制（反调试/反Frida/混淆/加固），需在分析前识别并准备绕过策略。

| 场景 | 触发条件 | 应对策略 |
|------|----------|----------|
| SSL Pinning | 抓包无响应/证书错误 | Frida Hook 信任管理器 / OkHttp hostnameVerifier |
| Root/Frida检测 | App检测到su/Magisk/Frida | Frida Hook File.exists / PackageManager / 端口检测函数 |
| 反调试(ptrace) | 无法attach gdb/Frida | Frida -f spawn 模式 / Hook ptrace 返回值 |
| 代码混淆(ProGuard) | 类名方法名变为a/b/c | strings定位 + 交叉引用 + Frida动态Hook解密函数 |
| 字符串加密 | strings无有用输出 | Frida Hook解密函数 / 动态断点捕获明文 |
| 加固保护(360/腾讯/梆梆) | jadx看不到源码 | frida-dexdump脱壳 → 再分析 |
| 完整性校验 | 重打包后闪退 | 分析校验逻辑 + Hook绕过 / 不重打包用Frida动态修改 |
| 模拟器检测 | 检测/dev/qemu_pipe等 | Frida Hook检测函数返回值 |

完整对抗手册：`references/methodology/06-anti-antibot.md`

---

## 经验回写

每次逆向任务完成后，记录：
- 目标类型和架构
- 发现的关键函数和字符串
- 使用的 Hook 脚本（保存到 `payloads/mobile/`）
- 绕过的保护机制和方法