// android_hook.js — Android 目标运行时插桩（Java 层 + native 层），Frida 17 兼容
// 用法: frida -U -f TARGET_PKG -l android_hook.js --no-pause
//       frida -U -n TARGET_PROC -l android_hook.js
'use strict';

var CFG = {
  javaClass: 'TARGET_CLASS',      // 例: com.example.app.LoginActivity（占位符，按目标替换）
  javaMethod: 'TARGET_METHOD',    // 例: checkPassword
  nativeSym: 'strcmp'             // 例: strcmp / memcmp / strncmp
};

function banner(tag, msg) { console.log('[' + tag + '] ' + msg); }
banner('android_hook', 'Frida ' + Frida.version + ' / ' + Process.arch + ' pid=' + Process.id);

/* ---------- 1) Java 层：方法参数/返回值 ---------- */
if (Java.available) {
  Java.perform(function () {
    banner('java', 'Java VM 可用');
    try {
      var K = Java.use(CFG.javaClass);
      var m = K[CFG.javaMethod];
      if (m && m.overloads && m.overloads.length) {
        m.overloads.forEach(function (ov) {
          ov.implementation = function () {
            var args = Array.prototype.slice.call(arguments);
            var r;
            banner('java_enter', CFG.javaClass + '.' + CFG.javaMethod + ' args=' + JSON.stringify(args.map(String)));
            r = ov.apply(this, arguments);
            banner('java_leave', CFG.javaClass + '.' + CFG.javaMethod + ' ret=' + String(r));
            return r;
          };
        });
        banner('java', '已挂 ' + CFG.javaClass + '.' + CFG.javaMethod + ' (' + m.overloads.length + ' 个重载)');
      } else {
        banner('java_warn', CFG.javaClass + '.' + CFG.javaMethod + ' 未找到，检查类名与混淆后的方法名');
      }
    } catch (e) {
      banner('java_error', String(e));
    }
    // 兜底：钩 String.equals，观察明文比较
    try {
      var JString = Java.use('java.lang.String');
      JString.equals.implementation = function (o) {
        var r = this.equals(o);
        banner('str_eq', JSON.stringify(String(this)) + ' == ' + JSON.stringify(String(o)) + ' -> ' + r);
        return r;
      };
      banner('java', '已挂 java.lang.String.equals');
    } catch (e2) { banner('java_error', 'String.equals: ' + String(e2)); }
  });
} else {
  banner('java', '当前进程无 Java VM（纯 native 进程），跳过 Java 层');
}

/* ---------- 2) native 层：libc 符号 + 调用栈 ---------- */
function resolve(name) {
  if (typeof Module.findGlobalExportByName === 'function') return Module.findGlobalExportByName(name);
  if (typeof Module.getGlobalExportByName === 'function') {
    try { return Module.getGlobalExportByName(name); } catch (e) { /* fallthrough */ }
  }
  return Module.findExportByName(null, name);
}

var np = resolve(CFG.nativeSym);
banner('native', CFG.nativeSym + ' @ ' + np);
if (np) {
  Interceptor.attach(np, {
    onEnter: function (args) {
      var a = null, b = null;
      try { a = args[0].readUtf8String(); } catch (e) {}
      try { b = args[1].readUtf8String(); } catch (e) {}
      banner('native_enter', CFG.nativeSym + ' a=' + a + ' b=' + b);
      try {
        var bt = Thread.backtrace(this.context, Backtracer.ACCURATE)
          .map(DebugSymbol.fromAddress).slice(0, 6).map(String);
        banner('native_bt', bt.join(' <- '));
      } catch (e) {}
      send({ event: 'native', sym: CFG.nativeSym, a: a, b: b });
    },
    onLeave: function (r) {
      banner('native_leave', CFG.nativeSym + ' ret=' + r.toInt32());
      send({ event: 'native_ret', sym: CFG.nativeSym, ret: r.toInt32() });
    }
  });
  banner('native', '已挂 ' + CFG.nativeSym);
} else {
  banner('native_warn', CFG.nativeSym + ' 未解析到（可能未加载或已被静态链接）');
}

/* ---------- 3) 模块加载事件 ---------- */
try {
  var dlopen = resolve('android_dlopen_ext') || resolve('__dl__ZL10dlopen_extPKciPK17android_dlextinfoPKv') || resolve('dlopen');
  if (dlopen) {
    Interceptor.attach(dlopen, {
      onEnter: function (args) { try { this.p = args[0].readCString(); } catch (e) { this.p = null; } },
      onLeave: function (r) { if (this.p) banner('dlopen', this.p + ' -> ' + r); }
    });
    banner('hook', '已挂 dlopen，可观察 .so 动态装载（脱壳/加固判定用）');
  }
} catch (e) { banner('hook_error', String(e)); }
