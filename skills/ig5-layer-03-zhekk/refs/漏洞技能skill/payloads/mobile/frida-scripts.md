# Frida 脚本库

> 针对 Android 移动安全。直接复制使用。

## SSL Pinning 绕过

```javascript
// 通用 SSL Pinning 绕过
Java.perform(function() {
    var TrustManagerImpl = Java.use('com.android.org.conscrypt.TrustManagerImpl');
    TrustManagerImpl.verifyChain.implementation = function(untrustedChain, trustAnchorChain, host, clientAuth, ocspData, tlsSctData) {
        console.log('[SSL] Bypass: ' + host);
        return untrustedChain;
    };
});
```

## Hook Cipher — 抓加密密钥

```javascript
Java.perform(function() {
    var Cipher = Java.use("javax.crypto.Cipher");
    var String = Java.use("java.lang.String");

    Cipher.doFinal.overload("[B").implementation = function(data) {
        console.log("[Cipher] 输入: " + bytesToHex(data));
        var result = this.doFinal(data);
        console.log("[Cipher] 输出: " + bytesToHex(result));
        return result;
    };

    Cipher.init.overload("int", "java.security.Key").implementation = function(mode, key) {
        console.log("[Cipher.init] 模式: " + mode + " 密钥: " + bytesToHex(key.getEncoded()));
        return this.init(mode, key);
    };
});

function bytesToHex(bytes) {
    var hex = [];
    for (var i = 0; i < bytes.length; i++) {
        hex.push(('0' + (bytes[i] & 0xFF).toString(16)).slice(-2));
    }
    return hex.join('');
}
```

## Hook OkHttp — 抓 API 请求

```javascript
Java.perform(function() {
    var Request = Java.use("okhttp3.Request");
    var RequestBody = Java.use("okhttp3.RequestBody");
    
    var OriginalUrl = Request.url;
    OriginalUrl.implementation = function() {
        var url = this.url();
        console.log("[OkHttp] " + this.method() + " " + url.toString());
        return url;
    };
});
```

## Hook 系统服务

```javascript
Java.perform(function() {
    var ActivityManager = Java.use("android.app.ActivityManager");
    var Runtime = Java.use("java.lang.Runtime");
    
    // Hook exec
    Runtime.exec.overload("[Ljava.lang.String;").implementation = function(cmd) {
        console.log("[Runtime.exec] " + cmd[0]);
        return this.exec(cmd);
    };
});
```

## 脱壳脚本

```javascript
// 通用脱壳
Java.perform(function() {
    var DexFile = Java.use("dalvik.system.DexFile");
    DexFile.loadDex.implementation = function(sourcePathName, outputPathName, flags) {
        console.log("[DexFile] " + sourcePathName + " -> " + outputPathName);
        return this.loadDex(sourcePathName, outputPathName, flags);
    };
});
```

## 本地使用

```bash
frida -U -l ssl_pinning.js -f {package}
frida -U -l hook_crypto.js {package}
frida -U -l hook_okhttp.js {package}
frida-dexdump -U -f {package}  # 脱壳
```

## 环境说明

本机 Frida 17.16.4 已安装，支持 USB 连接 Android 设备