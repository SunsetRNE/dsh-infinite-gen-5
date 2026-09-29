# Android 逆向 (Android Reversing)

## 概述

Android 逆向是指对 Android 应用程序（APK）进行分析、理解和修改的技术总称。随着 Android 设备的普及和移动安全需求的增长，Android 逆向已成为 CTF 和安全研究中不可或缺的技能。

一个典型的 Android 应用包含两大部分: DEX 字节码层（Java/Kotlin 代码编译而成）和 Native 层（C/C++ 代码编译的 `.so` 文件）。完整地分析一个 Android 应用需要同时掌握这两个层面的逆向技术。

---

## 常见分析手法

### 1. DEX 逆向
DEX (Dalvik Executable) 是 Android 应用的字节码格式，存储在 `classes.dex`（及其他 `classes2.dex`、`classes3.dex` 等）文件中。

**DEX 文件结构**:
```
+------------------+
| DEX Header       | (魔数 "dex\n035\0")
+------------------+
| String Table     | (字符串池)
+------------------+
| Type Table       | (类型索引)
+------------------+
| Proto Table      | (方法原型描述)
+------------------+
| Field Table      | (字段定义)
+------------------+
| Method Table     | (方法定义)
+------------------+
| Class Def Table  | (类定义)
+------------------+
| Data Section     | (字节码、注解、调试信息等)
+------------------+
```

**反编译工具**:

| 工具 | 说明 | 特点 |
|------|------|------|
| **JADX** | 首选工具，将 DEX 反编译为可读的 Java 源码 | 开源免费，GUI+CLI |
| **JEB** | 商业反编译工具 | 支持 DEX + Native 混合分析，调试功能强 |
| **GDA** | 国内开发的 Android 反编译工具 | 支持 DEX/APK/DLL 反编译 |
| **jad** / **CFR** | Java .class 反编译 | 可间接用于 DEX（需先转 .jar） |
| **enjarify** | DEX -> .jar 转换 | Google 开源工具 |
| **dex2jar** | DEX -> .jar 转换 + jd-gui 查看 | 经典方案 |

**关键分析点**:
- **`AndroidManifest.xml`**: 应用的声明文件，描述组件、权限、入口 Activity、intent-filter 等。
- **`MainActivity`**: 通常是应用的入口 Activity。
- **`onCreate` 方法**: Activity 初始化时的入口，通常绑定布局、初始化组件。
- **`OnClick` 监听器**: 按钮点击事件，往往是关键逻辑的触发点。
- **`ProGuard` 混淆**: `a.a.a` 等无意义类名和方法名。JADX 可进行反混淆处理。
- **字符串加密**: 通常的加密后的字符串在 `strings.xml` 或代码中。

### 2. Native 逆向
Native 层代码（`.so` 文件）使用 C/C++ 编写，通过 JNI (Java Native Interface) 与 Java 层交互。

**JNI 函数命名规则**:
```
Java_<package>_<class>_<method>(JNIEnv*, jobject, ...)
```
例如: `Java_com_example_app_MainActivity_checkPassword`

**Native 层分析工具**:
- **IDA Pro**: 支持 ARM/ARM64/x86 架构的 .so 文件分析。
- **Ghidra**: 免费替代品，对 ARM 分析能力足够。
- **baksmali**: 将 DEX 转为 SMALI，便于手动阅读和修改。

**Native 层常见用途**:
- **关键算法实现**: RSA/AES 等密码学操作（防止从 DEX 中直接提取密钥）。
- **核心验证逻辑**: 密码校验、许可验证、签名校验。
- **反调试**: ptrace 检测、`/proc/self/status` 检测、`/system/bin/su` 检测。
- **代码加固**: 使用 `__attribute__((constructor))` 在 so 加载时执行初始化。
- **反 Root / 反模拟器**: 检测运行环境。

**JNI 调用分析**:
- `FindClass`: 获取 Java 类的引用。
- `GetMethodID / GetStaticMethodID`: 获取 Java 方法 ID。
- `CallVoidMethod / CallStaticObjectMethod`: 调用 Java 方法。
- `GetStringUTFChars / NewStringUTF`: 字符串转换。
- `GetIntField / SetIntField`: 字段操作。

### 3. 其他 Android 程序逆向

**资源文件分析**:
- `Resources.arsc`: 编译后的资源索引表，包含字符串、布局、颜色等资源的 ID 映射。
- `res/` 目录: 布局 XML（`activity_main.xml` 等）、图片、原始文件等。
- 使用 **apktool** 可以解包资源并转换为可读的格式。

**Signature / 签名校验**:
- APK 的签名信息存储在 `META-INF/` 目录:
  - `MANIFEST.MF`: 列出所有文件的摘要。
  - `CERT.SF`: 签名属性文件。
  - `CERT.RSA`: 签名证书和签名数据。
- 应用可能内置签名校验（比较签名的哈希或证书指纹），防止重打包。

**反编译与重打包**:
```bash
# 解包
apktool d target.apk -o output/

# 修改（SMALI 层面或资源层面）

# 重打包
apktool b output/ -o repackaged.apk

# 重新签名（未签名的 APK 无法安装运行）
jarsigner -sigalg SHA1withRSA -digestalg SHA1 -keystore my.keystore repackaged.apk alias_name

# Zipalign（优化对齐）
zipalign -v 4 repackaged.apk final.apk
```

**OAT / ART 虚拟机**:
- Android 5.0+ 使用 ART 虚拟机，DEX 在安装时被编译为 OAT (Optimized Android Transfer) 文件（基于 ELF 格式）。
- OAT 文件包含原生机器码（AOT 编译），逆向 OAT 需要结合 DEX 和 ARM 指令集。
- 工具: `oat2dex` / `vdexExtractor` 将 OAT 转回 DEX。

**Android 内核和系统逆向**:
- 分析 Android 内核模块（如 Binder 驱动、ashmem、ion）。
- 分析系统服务（如 `system_server`、SurfaceFlinger、MediaServer）。
- CTF 中出现较少，属于高阶移动安全分析范畴。

---

## 动态分析技术

**Frida**:
- 跨平台动态插桩框架，支持 Hook Java 和 Native 函数。
- JavaScript 或 Python 编写 Hook 脚本。
- **典型用法**:
  ```javascript
  // Hook Java 方法
  Java.perform(function() {
      var MainActivity = Java.use('com.example.app.MainActivity');
      MainActivity.checkPassword.implementation = function(password) {
          console.log('password = ' + password);
          return this.checkPassword(password);
      };
  });

  // Hook Native 函数
  Interceptor.attach(Module.findExportByName('libnative.so', 'Java_com_example_app_check'), {
      onEnter: function(args) { console.log(args[2].readCString()); }
  });
  ```
- **objection**: 基于 Frida 的运行时安全评估工具，支持自动化 SSL Pinning 绕过等。

**Xposed / LSPosed**:
- 框架级 Hook 方案，可永久修改系统或应用的 Java 方法。
- 适合深度定制和分析，但需要 Root 环境。

**Android Studio 调试器**:
- 使用 Android Studio 的 APK 分析工具（Profile or Debug APK）调试应用。
- 需要应用 `android:debuggable="true"`。

**其他动态分析工具**:
- **Drozer**: Android 安全评估框架，测试组件暴露、权限、Intent 等。
- **Androguard**: Python 编写的 Android 逆向分析框架，支持静态+动态分析。

---

## 相关工具

| 类别 | 工具 | 用途 |
|------|------|------|
| 反编译 | JADX / JEB / GDA | DEX -> Java 源码 |
| 解包 | apktool | APK 解包/重打包 |
| 汇编/反汇编 | baksmali / smali | DEX <-> SMALI |
| Native 分析 | IDA Pro / Ghidra | .so 文件逆向 |
| 动态插桩 | Frida / objection | Java + Native Hook |
| 框架 Hook | Xposed / LSPosed | Java 层持久化 Hook |
| 分析框架 | Androguard / Drozer | 自动化安全分析 |
| 资源提取 | Resource Hacker / Android Studio | XML/图片/资源 |

---

## 防御/对抗建议

- **代码混淆**: 启用 ProGuard / R8 / DexGuard 混淆 Java/Kotlin 代码。
- **加固方案**: 使用腾讯加固（Legu）、360 加固、梆梆加固等加固服务（保护 DEX + Native 层）。
- **Native 层保护**: 
  - 关键逻辑放在 Native 层。
  - 使用 `llvm-obfuscator` 混淆 Native 代码。
  - 对 JNI 函数名进行编码/哈希混淆。
- **反调试**: 在 Native 层集成 ptrace、TracerPid、时间差等多重反调试。
- **完整性校验**: 校验 APK 签名、文件哈希、DEX 完整性，防止重打包和篡改。
- **Root 检测**: 检测 `su` 文件、`Superuser.apk`、Magisk 等 Root 环境。
- **模拟器检测**: 检测 Build 属性（`ro.product.board`、`ro.build.fingerprint` 等）、IP 地址范围、运行环境特征。

---

## 相关技能

- [逆向分析基础](逆向分析基础.md)
- [可执行文件逆向](可执行文件逆向.md)
- [低级语言分析](低级语言分析.md)
- [Java](../Web安全/Java.md)
- [固件分析](../物联网安全/固件分析.md)
