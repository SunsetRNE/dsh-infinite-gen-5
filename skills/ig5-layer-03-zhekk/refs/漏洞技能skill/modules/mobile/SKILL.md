# 移动安全模块 (Mobile)

> Android/iOS 渗透测试 — ADB/Frida/APK反编译/SSL Pinning/移动取证
> 本机优势：Android 原生 + ADB 1.0.41 + Frida 17.16.4 + apktool/jadx

## 知识锚点（Playbook + H1 案例）

> 移动安全测试前先查阅 playbook 确认攻击面，H1 案例提供真实漏洞参考，Frida 脚本库提供现成 Hook 载荷。

### Playbook（攻击手册）

| 方向 | Playbook 路径 |
|------|--------------|
| 移动安全 | `references/playbooks/mobile.md` |

### H1 真实案例（按弱点分类）

| 漏洞类型 | H1 案例路径 |
|----------|------------|
| Android组件导出 | `references/h1-reports/by-weakness/improper-export-of-android-application-components.md` |
| 明文存储敏感信息 | `references/h1-reports/by-weakness/cleartext-storage-of-sensitive-information.md` |
| 不安全存储 | `references/h1-reports/by-weakness/insecure-storage-of-sensitive-information.md` |
| 证书校验不当 | `references/h1-reports/by-weakness/improper-certificate-validation.md` |
| 凭据保护不足 | `references/h1-reports/by-weakness/insufficiently-protected-credentials.md` |
| 硬编码凭据 | `references/h1-reports/by-weakness/use-of-hard-coded-credentials.md` |
| 不当输入验证 | `references/h1-reports/by-weakness/improper-input-validation.md` |

### Payload 库

| 用途 | Payload 路径 |
|------|-------------|
| Frida Hook脚本 | `payloads/mobile/frida-scripts.md` |
| WAF绕过（API测试） | `payloads/bypass/waf-bypass.md` |

## ADB 完整工作流

### 设备连接
```bash
adb devices -l
adb shell getprop ro.build.version.sdk
adb shell getprop ro.product.cpu.abi
```

### 应用枚举
```bash
adb shell pm list packages -3              # 第三方应用
adb shell pm list packages | grep -i "bank\|pay\|wallet\|finance"
adb shell pm path {package}                # APK路径
adb pull /data/app/{path}/base.apk ./target.apk
```

### 应用信息
```bash
adb shell dumpsys package {pkg} | grep -A20 "Activity"
adb shell dumpsys package {pkg} | grep -A20 "Service"
adb shell dumpsys package {pkg} | grep -A20 "Receiver"
adb shell dumpsys package {pkg} | grep -A20 "Provider"
adb shell dumpsys package {pkg} | grep "permission"
```

### 动态组件测试
```bash
adb shell am start -n {pkg}/{activity}
adb shell am broadcast -a {action} --es key "value"
adb shell content query --uri content://{provider}/users
adb shell content insert --uri content://{provider} --bind key:s:value
```

## APK 逆向 — grep 十大攻击面

```bash
apktool d target.apk -o apk_out/
jadx target.apk -d jadx_out/

# 1. API端点
grep -r "http://\|https://" jadx_out/ | grep -oP 'https?://[a-zA-Z0-9./_-]+' | sort -u
# 2. 硬编码凭据
grep -r "api_key\|secret\|token\|password\|key\|authorization\|bearer" jadx_out/
# 3. 加密逻辑
grep -r "AES\|RSA\|DES\|MD5\|SHA\|encrypt\|decrypt\|Cipher\|MessageDigest" jadx_out/
# 4. Native函数
grep -r "native\|loadLibrary\|System.load" jadx_out/
# 5. WebView漏洞
grep -r "WebView\|addJavascriptInterface\|setAllowUniversalAccess\|setAllowFileAccess" jadx_out/
grep -r "setJavaScriptEnabled.*true\|loadUrl.*http" jadx_out/
# 6. 导出组件
grep -r "android:exported=\"true\"" apk_out/AndroidManifest.xml
# 7. 文件路径
grep -r "/data/data\|/sdcard\|getExternalStorage\|getFilesDir" jadx_out/
# 8. URL Scheme
grep -r "intent-filter.*BROWSABLE\|intent-filter.*VIEW\|scheme\|host" jadx_out/
# 9. 广播接收器
grep -r "BroadcastReceiver\|onReceive\|sendBroadcast" jadx_out/
# 10. 数据库操作
grep -r "SQLiteDatabase\|execSQL\|rawQuery\|ContentValues" jadx_out/
```

## Frida 动态插桩

```javascript
// hook_crypto.js — Hook 加密函数抓密钥
Java.perform(function() {
    var Cipher = Java.use("javax.crypto.Cipher");
    Cipher.doFinal.overload("[B").implementation = function(data) {
        console.log("[Cipher] 输入: " + bytesToHex(data));
        var result = this.doFinal(data);
        console.log("[Cipher] 输出: " + bytesToHex(result));
        return result;
    };
});

// hook_okhttp.js — 抓取所有HTTP请求
Java.perform(function() {
    var Request = Java.use("okhttp3.Request");
    console.log("[OkHttp] " + Request.method() + " " + Request.url().toString());
});
```

```bash
frida -U -l ssl_pinning.js -f {package}    # SSL Pinning绕过
frida -U -l hook_crypto.js {package}        # Hook加密
frida-dexdump -U -f {package}              # 脱壳
```

## 移动端常见漏洞

```bash
# 导出组件未授权: adb shell am start -n {package}/.AdminActivity
# Content Provider: adb shell content query --uri content://{provider}/users
# WebView: file://读任意文件(需setJavaScriptEnabled+addJavascriptInterface+setAllowUniversalAccess)
# 不安全存储: adb shell run-as {pkg} cat /data/data/{pkg}/shared_prefs/*.xml
# 日志泄露: adb logcat -d | grep -i "password\|token\|secret\|key"
# 深度链接: adb shell am start -a VIEW -d "{scheme}://{host}?{evil}"
# 备份攻击: adb backup -f backup.ab {package}
```

## 本机环境速查

```
已安装: adb✅ frida 17.16.4✅ apktool✅ jadx✅
缺失: objection❌ → Frida脚本替代
      androguard❌ → jadx替代
```

## 反爬钩子

> 移动安全测试的反爬/防护场景主要集中在 App 端防护（SSL Pinning/Root检测/反调试）和服务端 API 防护。

| 场景 | 触发条件 | 应对策略 |
|------|----------|----------|
| SSL Pinning | 抓包无响应/证书错误 | Frida Hook 信任管理器 / `frida -U -l ssl_pinning.js` |
| Root检测 | App检测到su/Magisk/Xposed/Frida | Frida Hook File.exists / PackageManager.getPackageInfo |
| 反调试(ptrace) | 无法attach gdb/Frida | Frida -f spawn 模式启动 / Hook ptrace 返回值 |
| 反Frida检测 | App检测Frida端口/线程名 | frida-gadget 注入 / 修改 Frida 端口 / Hook 检测函数 |
| 代码混淆(ProGuard) | 类名方法名变为a/b/c | 字符串定位 + Frida动态Hook + jadx交叉引用 |
| 加固保护(360/腾讯/梆梆) | jadx看不到源码 | frida-dexdump 脱壳 → 再分析 |
| API请求被WAF拦截 | App后端API触发WAF规则 | 模拟正常App流量(User-Agent/签名) + 限速 |
| 完整性校验 | 重打包后闪退 | 分析校验逻辑 + Hook绕过 / 不重打包用Frida动态修改 |

完整对抗手册：`references/methodology/06-anti-antibot.md`