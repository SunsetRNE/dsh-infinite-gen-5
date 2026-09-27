(() => {
  try {
    /* 无限五代 (dsh-infinite-gen-5) client half — 原生风格状态条 + 设置台 v0.11.1 */
    window.__ModuleLoader__.load({
      id: "dsh-infinite-gen-5",
      factory: (require) => {
        var module = { exports: {} };
        var exports = module.exports;
        Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

        var react = require("react");

        // ────────────────────────────────────────────────────────────────────
        // 位置（v0.5.2 的核心修正）
        //
        // v0.5.1 之前挂在 conversation.input.dock —— 那是「输入框之上」的那一列，
        // 官方 TodoPanel(id:"todo", order:0) 与队列(id:"queue", order:20) 也住在那
        // 一列。我们 order:30 排第三，于是徽标被夹在任务列表和输入框之间，生成任务
        // 时还会跟着任务列表一起把这一列顶动。
        //
        // 改成 conversation.composer.dock —— 那是输入框卡片**自己**的底部 dock 行
        // (InputBar.dock, justify-content:center; gap:12px)，原生「上下文计量器」
        // ContextMeter 就住在这里。同一排、同级、跟任务列表完全无关；生成期间
        // ContextMeter 让位，这一行正好空出来当运行指示器。
        //
        // 想换位置只改 SLOT_MODE：
        //   "composer" 输入框 dock 行，与上下文计量器同排（默认，推荐）
        //   "header"   会话标题栏右侧的 utilities 区（最"角落"）
        //   "zone"     旧的输入框上方那一列（不推荐，会与任务列表同列）
        // 三种槽位都由官方客户端在加载时声明；未声明的槽位不会报错，只是不渲染。
        // ────────────────────────────────────────────────────────────────────
        var SLOT_MODES = {
          composer: "conversation.composer.dock",
          header: "conversation.session.header.utilities",
          zone: "conversation.input.dock"
        };
        var SLOT_MODE = "composer";
        var SLOT_NAME = SLOT_MODES[SLOT_MODE] || SLOT_MODES.composer;
        var SLOT_ID = "armor5";
        var SLOT_ORDER = 30;

        var VERSION = "v0.12.3";
        var TITLE = "无限五代 " + VERSION;
        // 判决**不再自动淡出**：投影里的 verdict 一直有效，直到用户下一条发言
        // 才被重置成「执行中」。原先 3.2 秒后回落成空闲态，实际观感就是
        // 「命中提示一闪而过，还没看清就没了」。
        // 落笔时间由服务端投影给出（armor.at），所以刷新页面也还能看到最近判决。

        // 触发条形态（v0.8.1 起可切换；v0.8.0 及以前一律等价于 "full"）
        //   full    —— 常驻文字：空闲「无限五代」，判决「通过 · web(3) · 载荷 2」
        //   compact —— 短词：空闲/执行中只有一个圆点；判决只留状态词
        //              （通过/拒绝/兜底 + 领域短 id），数值全部收进浮层与 title
        //   glyph   —— 单字符（默认）：空闲/执行中只有一个圆点；判决只剩一个记号
        //              （✓ / ✕ / !，按 success/error 令牌着色），领域与数值全进浮层
        //   dot     —— 纯圆点：一切文字只在浮层与 title 里
        // 判决常驻、颜色仍走宿主 success/error 令牌 —— 亮着就说明它生效了。
        var TRIGGER_MODES = ["glyph", "compact", "full", "dot"];
        var TRIGGER_MODE = "glyph";

        // 判决的单字符代号。领域 id 是英文，跟状态词拼在一起读起来像句子
        // （「通过 injection」），单字符记号既最短又不产生误读；细节在浮层里。
        var VERDICT_GLYPHS = { pass: "✓", refusal: "✕", fallback: "!" };

        // 空闲态的常驻文字（只有 TRIGGER_MODE === "full" 才会上屏）。
        var IDLE_LABEL = "无限五代";

        // 同机若还装着上一代破甲插件，它的徽标也挂在输入框附近 —— 两条叠在一起。
        // 五代是接替者：只在自己拿到投影数据时才折叠对方（拿不到就保留对方的，
        // 避免两个都不显示）。
        var FOREIGN_BADGE = /^无限[三四]代/;

        // 样式全部走宿主自己的设计令牌（--dsw-* / --dsh-*），并逐个给出兜底色，
        // 这样外壳换主题时我们跟着变，而不是一块贴上去的死绿色。
        var STYLE_ID = "dsh-armor5-css";
        var STYLE_TEXT = [
          "@keyframes dshArmor5Pending{0%{opacity:.35}to{opacity:1}}",
          // 触发器：逐项对齐宿主 ContextMeter 的 .trigger —— 无边框、无底色、
          // tertiary 文字，hover / aria-expanded 才浮出 interactive-bg-hover。
          ".dsh-armor5-root{display:inline-flex;align-items:center;gap:6px;flex:none;",
          "padding:1px 8px;border:0;border-radius:var(--dsw-radius-sm,6px);background:0 0;",
          "color:var(--dsw-alias-label-tertiary,#8b8b8b);font-family:inherit;",
          "font-size:var(--dsh-content-font-size-secondary,13px);",
          "line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));",
          "font-variant-numeric:tabular-nums;white-space:nowrap;cursor:pointer}",
          ".dsh-armor5-root:hover,.dsh-armor5-root[aria-expanded=true]{",
          "background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12));",
          "color:var(--dsw-alias-label-secondary,#b4b4b4)}",
          ".dsh-armor5-root:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#4d6bfe);outline-offset:2px}",
          // 状态色只改 color，圆点用 currentColor 跟着走（同宿主 StateDot 的做法）。
          ".dsh-armor5-root[data-tone=success]{color:var(--dsw-alias-state-success-primary,#3fb950)}",
          ".dsh-armor5-root[data-tone=error]{color:var(--dsw-alias-state-error-primary,#f85149)}",
          ".dsh-armor5-dot{width:6px;height:6px;border-radius:50%;corner-shape:round;background:currentColor;flex:none}",
          // 运行中：逐项对齐宿主 InputBar 的 .pending 呼吸点（8px、business 色、1s 交替透明度）。
          ".dsh-armor5-dot[data-busy]{width:8px;height:8px;",
          "background:var(--dsw-alias-state-business-primary,#4d6bfe);",
          "animation:dshArmor5Pending 1s ease-in-out infinite alternate}",
          ".dsh-armor5-text{max-width:22ch;overflow:hidden;text-overflow:ellipsis}",
          // 详情浮层：逐项对齐宿主 ContextMeter 的 .panel。
          ".dsh-armor5-panel{position:fixed;z-index:1100;box-sizing:border-box;",
          "width:min(264px,100vw - 24px);padding:12px;border:0;cursor:default;",
          "border-radius:var(--dsw-radius-lg,12px);background:var(--dsw-specific-menu,#1f1f1f);",
          "backdrop-filter:var(--dsw-menu-backdrop-filter,none);",
          "box-shadow:var(--dsw-elevation-prominent,0 8px 32px rgba(0,0,0,.45));",
          "color:var(--dsw-alias-label-secondary,#b4b4b4);font-size:12px;line-height:20px}",
          ".dsh-armor5-head{display:flex;align-items:center;gap:6px}",
          ".dsh-armor5-head b{color:var(--dsw-alias-label-primary,#e6e6e6);font-weight:500}",
          ".dsh-armor5-rows{margin:8px 0 0;padding:0;list-style:none}",
          ".dsh-armor5-rows li{display:flex;gap:8px;align-items:baseline}",
          ".dsh-armor5-rows .k{color:var(--dsw-alias-label-tertiary,#8b8b8b);flex:none;min-width:64px}",
          ".dsh-armor5-rows .v{color:var(--dsw-alias-label-primary,#e6e6e6);overflow-wrap:anywhere}",
          ".dsh-armor5-note{margin:8px 0 0;color:var(--dsw-alias-label-caption,#8b8b8b)}",
          // ── 设置台（settings.section 里的那一页） ──
          // 令牌全部取自设置页自己用的那一套（bg-layer-2 / border-l2 / label-* / business-primary），
          // 每个都带兜底色。比例按设置页的节奏调：可选块用两/三列网格，预览块是一块内嵌面板，
          // 只读块两栏对齐，按钮统一 30px 高。
          ".armor5-console{box-sizing:border-box;display:flex;flex-direction:column;gap:20px;",
          "min-width:0;max-width:560px;padding:0 0 20px;color:var(--dsw-alias-label-secondary,#b4b4b4);",
          "font-size:var(--dsh-content-font-size-secondary,13px);line-height:20px}",
          ".armor5-console-head{display:flex;flex-direction:column;gap:3px}",
          ".armor5-console-title{display:flex;align-items:center;gap:8px}",
          ".armor5-console-title b{color:var(--dsw-alias-label-primary,#e6e6e6);font-size:15px;font-weight:600}",
          ".armor5-console-ver{display:inline-flex;align-items:center;height:17px;padding:0 7px;border-radius:999px;",
          "background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.08));color:var(--dsw-alias-label-tertiary,#8b8b8b);",
          "font-size:11px;font-variant-numeric:tabular-nums}",
          ".armor5-console-hint{color:var(--dsw-alias-label-caption,#8b8b8b);font-size:12px}",
          ".armor5-console-group{display:flex;flex-direction:column;gap:8px}",
          ".armor5-console-group-title{color:var(--dsw-alias-label-primary,#e6e6e6);font-size:12px;font-weight:600}",
          ".armor5-console-choices{display:grid;gap:8px}",
          ".armor5-console-choices-2{grid-template-columns:repeat(2,minmax(0,1fr))}",
          ".armor5-console-choices-3{grid-template-columns:repeat(3,minmax(0,1fr))}",
          ".armor5-console-choices-1{grid-template-columns:minmax(0,1fr)}",
          ".armor5-console-choice{display:flex;flex-direction:column;gap:3px;align-items:flex-start;text-align:left;",
          "min-height:54px;padding:9px 11px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.28));",
          "border-radius:var(--dsw-radius-lg,12px);background:0 0;color:inherit;font:inherit;cursor:pointer;",
          "transition:background-color .12s ease,border-color .12s ease}",
          ".armor5-console-choice:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12))}",
          ".armor5-console-choice:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#4d6bfe);outline-offset:2px}",
          ".armor5-console-choice.is-active{border-color:var(--dsw-alias-state-business-primary,#4d6bfe);",
          "background:var(--dsw-alias-interactive-bg-hover-accent,rgba(77,107,254,.10))}",
          ".armor5-console-choice-label{color:var(--dsw-alias-label-primary,#e6e6e6);font-size:13px}",
          ".armor5-console-choice-hint{color:var(--dsw-alias-label-caption,#8b8b8b);font-size:11.5px;line-height:16px}",
          ".armor5-console-previews{display:flex;flex-direction:column;gap:2px;padding:8px 10px;",
          "border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.20));",
          "border-radius:var(--dsw-radius-lg,12px);background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.06))}",
          ".armor5-console-preview{display:flex;align-items:center;gap:10px;height:28px}",
          ".armor5-console-preview-tag{flex:none;width:42px;color:var(--dsw-alias-label-caption,#8b8b8b);font-size:11.5px}",
          ".armor5-console-dock{flex:1;display:flex;align-items:center;justify-content:center;gap:10px;min-width:0;",
          "padding:3px 6px 3px 0}",
          ".armor5-console-meter{color:var(--dsw-alias-label-tertiary,#8b8b8b);font-size:12px;",
          "font-variant-numeric:tabular-nums}",
          ".armor5-console-badge{display:inline-flex;align-items:center;gap:6px;color:var(--dsw-alias-label-tertiary,#8b8b8b);",
          "font-size:12px}",
          ".armor5-console-badge[data-kind=pass]{color:var(--dsw-alias-state-success-primary,#3fb950)}",
          ".armor5-console-rows{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:6px}",
          ".armor5-console-rows li{display:grid;grid-template-columns:84px minmax(0,1fr);gap:10px;align-items:baseline}",
          ".armor5-console-rows .k{color:var(--dsw-alias-label-caption,#8b8b8b);font-size:12px}",
          ".armor5-console-rows .v{color:var(--dsw-alias-label-secondary,#b4b4b4);font-size:12px;overflow-wrap:anywhere}",
          ".armor5-console-foot{display:flex;gap:8px;padding-top:2px}",
          ".armor5-console-btn{height:30px;padding:0 13px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.28));",
          "border-radius:var(--dsw-radius-sm,6px);background:0 0;color:var(--dsw-alias-label-secondary,#b4b4b4);",
          "font:inherit;font-size:12.5px;cursor:pointer;transition:background-color .12s ease,color .12s ease}",
          ".armor5-console-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12));",
          "color:var(--dsw-alias-label-primary,#e6e6e6)}",
          ".armor5-console-btn.is-primary{border-color:transparent;",
          "background:var(--dsw-alias-button-primary-fill,#4d6bfe);color:var(--dsw-alias-label-primary-foreground,#fff)}",
          ".armor5-console-btn.is-primary:hover{background:var(--dsw-alias-button-primary-hover,#3d5bee);",
          "color:var(--dsw-alias-label-primary-foreground,#fff)}",
          ".armor5-console-icon{display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;",
          "color:var(--dsw-alias-label-tertiary,#8b8b8b)}"
        ].join("");

        function sameNode(a, b) {
          return a === b;
        }

        function ArmorDock(props) {
          var useProjection = props.useProjection;
          // 形态来自设置台（默认值 = 源码常量），所以「设置里改了」与「状态条上显示」永远同源。
          var triggerMode = usePrefs().triggerMode;
          // 两个 useProjection 都是无条件调用，保持 hook 顺序恒定。
          // 五代用自己的投影键；"armor" 留给同机安装的四代（key: "armor"）。
          var canProject = typeof useProjection === "function";
          var armor5 = canProject ? useProjection("infinite-gen-5:armor") : undefined;
          var armor4 = canProject ? useProjection("armor") : undefined;
          var armor = armor5 !== undefined ? armor5 : armor4;

          var rootRef = react.useRef(null);
          var openPair = react.useState(false);
          var open = openPair[0];
          var setOpen = openPair[1];
          var anchorPair = react.useState(null);
          var anchor = anchorPair[0];
          var setAnchor = anchorPair[1];

          // 1) 样式表：全局只注入一次，卸载时回收。
          react.useEffect(function () {
            var styleEl = null;
            if (!document.getElementById(STYLE_ID)) {
              styleEl = document.createElement("style");
              styleEl.id = STYLE_ID;
              styleEl.textContent = STYLE_TEXT;
              document.head.appendChild(styleEl);
            }
            return function () { if (styleEl) styleEl.remove(); };
          }, []);

          // 2) 折叠上一代徽标：先扫一次，只有真的扫到才挂 observer（常见情况零开销）。
          var foldable = armor !== undefined;
          react.useEffect(function () {
            if (!foldable) return undefined;
            var node = rootRef.current;
            if (!node || !node.ownerDocument) return undefined;
            var doc = node.ownerDocument;
            var folded = [];
            var lastFolded = -1;
            var scan = function () {
              var all = doc.querySelectorAll("[data-armor]");
              for (var i = 0; i < all.length; i++) {
                var n = all[i];
                if (sameNode(n, node)) continue;
                var t = n.getAttribute("title") || "";
                if (!FOREIGN_BADGE.test(t)) continue;
                if (n.style.display !== "none") {
                  n.style.display = "none";
                  n.setAttribute("data-armor-folded-by", "gen5");
                  folded.push(n);
                }
              }
              if (folded.length !== lastFolded) {
                lastFolded = folded.length;
                node.setAttribute(
                  "title",
                  folded.length > 0
                    ? TITLE + " · 已折叠上一代破甲徽标 x" + folded.length
                    : TITLE,
                );
              }
            };
            scan();
            var mo = null;
            if (folded.length > 0 && typeof MutationObserver === "function") {
              mo = new MutationObserver(scan);
              mo.observe(doc.body || doc.documentElement, { childList: true, subtree: true });
            }
            return function () {
              if (mo) mo.disconnect();
              for (var i = 0; i < folded.length; i++) {
                folded[i].style.display = "";
                folded[i].removeAttribute("data-armor-folded-by");
              }
              folded.length = 0;
            };
          }, [foldable]);

          // 4) 浮层：打开时量一次锚点位置，并挂 outside-click / Esc。
          react.useEffect(function () {
            if (!open) return undefined;
            var node = rootRef.current;
            if (!node || typeof node.getBoundingClientRect !== "function") return undefined;
            var doc = node.ownerDocument;
            var win = doc.defaultView || window;
            var rect = node.getBoundingClientRect();
            var width = Math.min(264, win.innerWidth - 24);
            var left = rect.left + rect.width / 2 - width / 2;
            var maxLeft = win.innerWidth - width - 8;
            setAnchor({
              width: width,
              left: Math.max(8, Math.min(maxLeft, left)),
              bottom: win.innerHeight - rect.top + 6
            });
            var onDown = function (event) {
              var target = event.target;
              if (sameNode(target, node) || (node.contains && node.contains(target))) return;
              var panel = doc.querySelector(".dsh-armor5-panel");
              if (panel && panel.contains && panel.contains(target)) return;
              setOpen(false);
            };
            var onKey = function (event) {
              if (event.key === "Escape") setOpen(false);
            };
            doc.addEventListener("pointerdown", onDown, true);
            doc.addEventListener("keydown", onKey, true);
            return function () {
              doc.removeEventListener("pointerdown", onDown, true);
              doc.removeEventListener("keydown", onKey, true);
            };
          }, [open]);

          var running = !!(armor && armor.running);
          var verdict = armor && armor.verdict ? armor.verdict : null;
          var words = armor && Array.isArray(armor.words) ? armor.words : [];
          var risk = armor && Array.isArray(armor.risk) ? armor.risk : [];
          var safe = armor && Array.isArray(armor.safe) ? armor.safe : [];
          var domain = armor && armor.domain ? armor.domain : null;
          var domainLabel = armor && armor.domainLabel ? armor.domainLabel : null;
          var domainHits = armor && typeof armor.domainHits === "number" ? armor.domainHits : 0;
          var ranked = armor && Array.isArray(armor.domainRanked) ? armor.domainRanked : [];
          var domainMarkers = armor && Array.isArray(armor.domainMarkers) ? armor.domainMarkers : [];
          var textChars = armor && typeof armor.textChars === "number" ? armor.textChars : 0;
          var openingChars = armor && typeof armor.openingChars === "number" ? armor.openingChars : 0;
          var at = armor && typeof armor.at === "number" && armor.at > 0 ? armor.at : null;

          var tone = "quiet";
          var fullText = IDLE_LABEL;
          var shortText = "";
          var glyphText = "";
          var busy = false;
          if (running) {
            tone = "running";
            busy = true;
            fullText = "执行中";
          } else if (verdict !== null) {
            // 判决常驻：不设到期时间，下一条用户发言才会把它重置。
            var word = verdict === "fallback" ? "兜底" : verdict === "pass" ? "通过" : "拒绝";
            tone = verdict === "pass" ? "success" : "error";
            glyphText = VERDICT_GLYPHS[verdict] !== undefined ? VERDICT_GLYPHS[verdict] : word;
            if (verdict === "pass") {
              fullText = word +
                (domain ? " · " + domain + (domainHits > 1 ? "(" + domainHits + ")" : "") : "") +
                (risk.length ? " · 载荷 " + risk.length : "");
              shortText = word +
                (domain ? " " + domain + (domainHits > 1 ? "(" + domainHits + ")" : "") : "");
            } else {
              fullText = word + (words.length ? " · " + words[0] : "");
              shortText = word;
            }
          }
          // 上屏文字：glyph 用单字符（空闲/执行中无文字）、compact 用短词、full 用长文、
          // dot 一律无文字。文字以外的信息一律走 title（悬停）与浮层（点击）。
          var text = triggerMode === "full" ? fullText
            : triggerMode === "compact" ? shortText
              : triggerMode === "glyph" ? glyphText
                : "";
          // glyph 形态下判决有记号就不必再画圆点（圆点是空闲/执行中的形态）。
          var showDot = !(triggerMode === "glyph" && glyphText !== "");

          var candidatesText = ranked.length
            ? ranked.map(function (row) {
              return row.id + " " + row.hits + (row.id === domain ? "*" : "");
            }).join(" · ")
            : "—";
          var clock = at === null
            ? "—"
            : (function () {
              var d = new Date(at);
              var pad = function (n) { return (n < 10 ? "0" : "") + n; };
              return pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds());
            })();

          // 触发条被压缩成多态指示器后，细节靠 title（悬停）与浮层（点击）承载。
          var title = TITLE +
            (running ? " · 正在执行" : verdict !== null ? " · 最近判决 " + fullText : " · 空闲") +
            (armor === undefined ? " · 等待投影" : "") +
            " · 点击查看面板";

          var rows = [
            ["状态", running ? "执行中" : armor === undefined ? "等待投影数据" : "空闲"],
            ["最近判决", verdict === null ? "—" : verdict + (clock === "—" ? "" : "（" + clock + "）")],
            ["识别领域", domain
              ? (domainLabel && domainLabel !== domain
                  ? domainLabel + "（" + domain + " · 命中 " + domainHits + "）"
                  : domain + "（命中 " + domainHits + "）")
              : "—"],
            ["领域候选", candidatesText],
            ["命中标记", domainMarkers.length ? domainMarkers.join("、") : "—"],
            ["拒答/兜底词", words.length ? words.join("、") : "—"],
            ["风险载荷", risk.length ? risk.join("、") : "—"],
            ["安全标记", safe.length ? safe.length + " 个（" + safe.join("、") + "）" : "—"],
            ["扫描范围", textChars
              ? "全文 " + textChars + " 字（判拒只看开头 " + openingChars + " 字）"
              : "—"],
            ["位置", SLOT_MODE + " · " + SLOT_NAME],
            ["版本", TITLE]
          ].map(function (pair, index) {
            return react.createElement(
              "li",
              { key: index },
              react.createElement("span", { className: "k" }, pair[0]),
              react.createElement("span", { className: "v" }, pair[1])
            );
          });

          var panel = open
            ? react.createElement(
              "div",
              {
                className: "dsh-armor5-panel",
                style: anchor
                  ? { width: anchor.width, left: anchor.left, bottom: anchor.bottom }
                  : undefined
              },
              react.createElement(
                "div",
                { className: "dsh-armor5-head" },
                react.createElement("b", null, "无限五代内核"),
                react.createElement("span", null, VERSION)
              ),
              react.createElement("ul", { className: "dsh-armor5-rows" }, rows),
              react.createElement(
                "p",
                { className: "dsh-armor5-note" },
                "载荷已注入系统提示词最前，Order 200 末位锚点复述。判定取自本次会话的实时投影；判决会一直留到你的下一条发言。领域候选按命中数排序，带 * 的是主判。"
              )
            )
            : null;

          return react.createElement(
            "div",
            { style: { display: "inline-flex", alignItems: "center" } },
            react.createElement(
              "button",
              {
                type: "button",
                className: "dsh-armor5-root",
                ref: rootRef,
                "data-armor": "gen5",
                "data-tone": tone,
                title: title,
                "aria-label": title,
                "aria-expanded": open ? "true" : "false",
                onClick: function () { setOpen(!open); }
              },
              react.createElement("span", {
                className: "dsh-armor5-text",
                style: text ? undefined : { display: "none" }
              }, text),
              showDot ? react.createElement("span", {
                className: "dsh-armor5-dot",
                "data-busy": busy ? "true" : undefined
              }) : null
            ),
            panel
          );
        }

        // ────────────────────────────────────────────────────────────────────
        // 设置台（v0.10.0）：形态 / 位置 / 侧栏入口从设置页调，不再改源码
        //
        // 宿主把「设置页的一项 = 一个 nav 按钮 + 一页独立内容」做在同一个槽位里：
        // client-ui-settings-general 里 renderSlot("settings.section", { close },
        // { only: active })，nav 行的 label 与顺序就来自注册项。官方「插件」页
        // （client-ui-settings-plugins）也是这么注册的。官方各节顺序是 账户 -10 /
        // 通用 0 / 模型 10 / 插件 15；我们声明 order 16 紧随「插件」之后（v0.11.1
        // 起，此前 -100 挤在最顶部让用户觉得别扭）。页面内容完全自己渲染 —— 不
        // require 任何宿主组件包。
        //
        // 偏好落在 localStorage["dsh-infinite-gen-5:prefs"]；没有本地存储（隐私
        // 模式 / 自检沙箱）时退化成「只在本会话生效」，不抛错。
        // ────────────────────────────────────────────────────────────────────
        var PREF_KEY = "dsh-infinite-gen-5:prefs";
        var PREF_DEFAULTS = Object.freeze({
          triggerMode: TRIGGER_MODE,
          slotMode: SLOT_MODE,
          sidebarIcon: false
        });
        var PREF_CHECKS = {
          triggerMode: function (v) { return TRIGGER_MODES.indexOf(v) >= 0; },
          slotMode: function (v) { return Object.prototype.hasOwnProperty.call(SLOT_MODES, v); },
          sidebarIcon: function (v) { return typeof v === "boolean"; }
        };
        var CONSOLE_KEY = "armor5";
        // 设置页 nav 里排在官方「插件」那一项（order 15）后面：不常用，顺使用习惯，
        // 但仍在同一条 nav 里、点开就是自己的独立页面。
        var CONSOLE_ORDER = 16;
        var prefsCache = null;
        var prefsListeners = [];

        function safeStorage() {
          try {
            if (typeof localStorage !== "undefined" && localStorage) return localStorage;
            if (typeof window !== "undefined" && window && window.localStorage) return window.localStorage;
          } catch (err) { /* 隐私模式 / 沙箱禁止访问：只落在内存 */ }
          return null;
        }

        function readPrefs() {
          if (prefsCache) return prefsCache;
          var raw = null;
          var store = safeStorage();
          if (store) {
            try { raw = JSON.parse(store.getItem(PREF_KEY) || "null"); } catch (err) { raw = null; }
          }
          var out = {};
          for (var key in PREF_DEFAULTS) {
            var value = raw && typeof raw === "object" ? raw[key] : undefined;
            out[key] = PREF_CHECKS[key](value) === true ? value : PREF_DEFAULTS[key];
          }
          prefsCache = Object.freeze(out);
          return prefsCache;
        }

        function writePrefs(patch) {
          var current = readPrefs();
          var next = {};
          for (var key in PREF_DEFAULTS) {
            if (!patch || !Object.prototype.hasOwnProperty.call(patch, key)) {
              next[key] = current[key];
            } else {
              // 非法写入直接忽略：留着用户原来的选择，比悄悄重置成出厂值更不意外。
              next[key] = PREF_CHECKS[key](patch[key]) === true ? patch[key] : current[key];
            }
          }
          prefsCache = Object.freeze(next);
          var store = safeStorage();
          if (store) {
            try { store.setItem(PREF_KEY, JSON.stringify(next)); } catch (err) { /* 配额 / 只读 */ }
          }
          for (var i = 0; i < prefsListeners.length; i += 1) {
            try { prefsListeners[i](prefsCache); } catch (err) { /* 单个订阅者出错不影响其他 */ }
          }
          return prefsCache;
        }

        function subscribePrefs(listener) {
          prefsListeners.push(listener);
          return function () {
            var at = prefsListeners.indexOf(listener);
            if (at >= 0) prefsListeners.splice(at, 1);
          };
        }

        function usePrefs() {
          var pair = react.useState(readPrefs());
          var setCurrent = pair[1];
          react.useEffect(function () {
            return subscribePrefs(function () { setCurrent(readPrefs()); });
          }, []);
          return pair[0];
        }

        function effectiveSlotMode() {
          var mode = readPrefs().slotMode;
          return Object.prototype.hasOwnProperty.call(SLOT_MODES, mode) ? mode : SLOT_MODE;
        }

        function effectiveSlotName() {
          return SLOT_MODES[effectiveSlotMode()] || SLOT_MODES.composer;
        }

        // 设置页里的预览用与状态条同一条规则算文字：同源，避免「设置里写 A、条上显示 B」。
        var PREVIEW_TEXT = { idle: IDLE_LABEL, pass: "通过 · web(3) · 载荷 2", short: "通过 web(3)" };
        function previewOf(mode, kind) {
          // 三行预览与状态条同规则：空闲「无限五代」、执行中圆点呼吸、判决 ✓。
          var full = kind === "idle" ? PREVIEW_TEXT.idle : kind === "busy" ? "执行中" : PREVIEW_TEXT.pass;
          var short = kind === "pass" ? PREVIEW_TEXT.short : "";
          var glyph = kind === "pass" ? VERDICT_GLYPHS.pass : "";
          var text = mode === "full" ? full : mode === "compact" ? short : mode === "glyph" ? glyph : "";
          return { text: text, dot: !(mode === "glyph" && glyph !== "") };
        }

        function ArmorChoice(props) {
          return react.createElement("button", {
            type: "button",
            className: "armor5-console-choice" + (props.active ? " is-active" : ""),
            "data-choice": props.value,
            "aria-pressed": props.active ? "true" : "false",
            onClick: props.onPick
          },
            react.createElement("span", { className: "armor5-console-choice-label" }, props.label),
            props.hint ? react.createElement("span", { className: "armor5-console-choice-hint" }, props.hint) : null
          );
        }

        function ArmorPreviewRow(props) {
          var view = previewOf(props.mode, props.kind);
          return react.createElement("div", { className: "armor5-console-preview" },
            react.createElement("span", { className: "armor5-console-preview-tag" }, props.tag),
            react.createElement("span", { className: "armor5-console-dock" },
              react.createElement("span", { className: "armor5-console-meter" }, "上下文 12%"),
              react.createElement("span", { className: "armor5-console-badge", "data-kind": props.kind },
                view.text ? react.createElement("span", { className: "dsh-armor5-text" }, view.text) : null,
                view.dot ? react.createElement("span", {
                  className: "dsh-armor5-dot",
                  "data-busy": props.kind === "busy" ? "true" : undefined
                }) : null
              )
            )
          );
        }

        /**
         * 设置页里我们自己的那一页（settings.section，排在最顶部）。
         * 只读偏好 + 写偏好，改动立刻反映到状态条（同一个 prefs 源）。
         */
        function ArmorConsolePage(props) {
          var prefs = usePrefs();
          var mode = prefs.triggerMode;
          var onClose = props && typeof props.close === "function" ? props.close : null;
          var store = safeStorage();

          function pick(field, value) {
            var patch = {};
            patch[field] = value;
            return function () { writePrefs(patch); };
          }

          var rows = [
            ["版本", TITLE],
            ["形态", mode + "（" + TRIGGER_MODES.length + " 档：glyph 记号 / compact 短词 / full 长文 / dot 纯圆点）"],
            ["位置", prefs.slotMode + " → " + (SLOT_MODES[prefs.slotMode] || SLOT_MODES.composer)],
            ["内核载荷", "Order 100 单段载荷 + Order 200 末位锚点，同源命中自动让位"],
            ["判定源", "本次会话的实时投影（key armor），判决一直留到你的下一条发言"],
            ["领域与工具", "56 域 × 7 族；infinite_gen5_scenario 取领域包，infinite_gen5_env 看本机环境"],
            ["存储", store ? "本机 localStorage（" + PREF_KEY + "）" : "仅本会话（当前环境没有本地存储）"]
          ];

          var modeChoices = [
            { value: "glyph", label: "✓ 记号", hint: "空闲/执行中只有圆点，判决只一个字符（默认）" },
            { value: "compact", label: "短词", hint: "判决写「通过 web(3)」" },
            { value: "full", label: "长文字", hint: "判决写「通过 · web(3) · 载荷 2」" },
            { value: "dot", label: "纯圆点", hint: "上屏只有圆点，全部信息进浮层" }
          ].map(function (row) {
            return react.createElement(ArmorChoice, {
              key: row.value,
              value: row.value,
              label: row.label,
              hint: row.hint,
              active: mode === row.value,
              onPick: pick("triggerMode", row.value)
            });
          });

          var slotChoices = [
            { value: "composer", hint: "与原生计量器同排（推荐）" },
            { value: "header", hint: "会话标题栏右侧角落" },
            { value: "zone", hint: "输入框上方，与任务列表同列" }
          ].map(function (row) {
            return react.createElement(ArmorChoice, {
              key: row.value,
              value: row.value,
              label: row.value,
              hint: row.hint,
              active: prefs.slotMode === row.value,
              onPick: pick("slotMode", row.value)
            });
          });

          return react.createElement("div", { className: "armor5-console" },
            react.createElement("div", { className: "armor5-console-head" },
              react.createElement("div", { className: "armor5-console-title" },
                react.createElement("b", null, IDLE_LABEL),
                react.createElement("span", { className: "armor5-console-ver" }, VERSION)
              ),
              react.createElement("span", { className: "armor5-console-hint" }, "面板形态与挂载位置，改完立即生效并保存在本机")
            ),
            react.createElement("div", { className: "armor5-console-group" },
              react.createElement("div", { className: "armor5-console-group-title" }, "上屏多少信息（TRIGGER_MODE）"),
              react.createElement("div", { className: "armor5-console-choices armor5-console-choices-2" }, modeChoices)
            ),
            react.createElement("div", { className: "armor5-console-group" },
              react.createElement("div", { className: "armor5-console-group-title" }, "预览"),
              react.createElement("div", { className: "armor5-console-previews" },
                react.createElement(ArmorPreviewRow, { mode: mode, kind: "idle", tag: "空闲" }),
                react.createElement(ArmorPreviewRow, { mode: mode, kind: "busy", tag: "执行中" }),
                react.createElement(ArmorPreviewRow, { mode: mode, kind: "pass", tag: "判决" })
              )
            ),
            react.createElement("div", { className: "armor5-console-group" },
              react.createElement("div", { className: "armor5-console-group-title" }, "挂到哪个槽位（SLOT_MODE）"),
              react.createElement("div", { className: "armor5-console-choices armor5-console-choices-3" }, slotChoices)
            ),
            react.createElement("div", { className: "armor5-console-group" },
              react.createElement("div", { className: "armor5-console-group-title" }, "入口"),
              react.createElement("div", { className: "armor5-console-choices armor5-console-choices-1" },
                react.createElement(ArmorChoice, {
                  value: "sidebar",
                  label: prefs.sidebarIcon ? "侧栏入口：已开启" : "侧栏入口：已关闭",
                  hint: "在侧栏底部再加一个独立页面入口（与官方「插件」面板同款 main 面板）",
                  active: prefs.sidebarIcon === true,
                  onPick: function () { writePrefs({ sidebarIcon: prefs.sidebarIcon !== true }); }
                })
              )
            ),
            react.createElement("div", { className: "armor5-console-group" },
              react.createElement("div", { className: "armor5-console-group-title" }, "只读"),
              react.createElement("ul", { className: "armor5-console-rows" },
                rows.map(function (row) {
                  return react.createElement("li", { key: row[0] },
                    react.createElement("span", { className: "k" }, row[0]),
                    react.createElement("span", { className: "v" }, row[1])
                  );
                })
              )
            ),
            react.createElement("div", { className: "armor5-console-foot" },
              react.createElement("button", {
                type: "button",
                className: "armor5-console-btn",
                onClick: function () { writePrefs(PREF_DEFAULTS); }
              }, "恢复默认"),
              onClose ? react.createElement("button", {
                type: "button",
                className: "armor5-console-btn is-primary",
                onClick: onClose
              }, "完成") : null
            )
          );
        }

        /** 侧栏入口（可选）的图标：宿主负责按钮外壳，这里只给内容。 */
        function ConsoleSidebarIcon() {
          return react.createElement("span",
            { className: "armor5-console-icon", "aria-hidden": "true" }, "◆");
        }

        function apply(ctx) {
          // 状态条：槽位在注册期决定，改「位置」偏好就得卸掉旧的重新挂一次。
          var status = { mode: null, dispose: null };
          function mountStatus() {
            var mode = effectiveSlotMode();
            if (status.mode === mode) return;
            if (typeof status.dispose === "function") status.dispose();
            var slotName = SLOT_MODES[mode] || SLOT_MODES.composer;
            // inject 只在宿主声明了该槽位后才回调，所以未声明的槽位不会抛错，只是不渲染。
            var dispose = ctx.slots.inject(slotName, function () {
              return ctx.slots.register({
                name: slotName,
                id: SLOT_ID,
                order: SLOT_ORDER
              }, ArmorDock);
            });
            status.mode = mode;
            status.dispose = typeof dispose === "function" ? dispose : null;
          }
          mountStatus();
          var offStatus = subscribePrefs(mountStatus);

          // 设置页最顶部的入口 + 我们自己的那一页（独立渲染，不依赖宿主组件包）。
          var offSection = ctx.slots.inject("settings.section", function () {
            return ctx.slots.register({
              name: "settings.section",
              id: CONSOLE_KEY,
              order: CONSOLE_ORDER,
              label: function () { return IDLE_LABEL; }
            }, ArmorConsolePage);
          });

          // 可选的侧栏入口：main 面板 + sidebar.panellist 图标（官方「插件」面板同款），
          // 两者用同一个 id，所以点侧栏图标就切到我们的页。
          var sidebar = { on: false, disposers: [] };
          function syncSidebar() {
            var want = readPrefs().sidebarIcon === true;
            if (want === sidebar.on) return;
            while (sidebar.disposers.length) {
              var dispose = sidebar.disposers.pop();
              if (typeof dispose === "function") dispose();
            }
            sidebar.on = want;
            if (!want) return;
            sidebar.disposers.push(ctx.slots.inject("main", function () {
              return ctx.slots.register({ name: "main", key: CONSOLE_KEY }, ArmorConsolePage);
            }));
            sidebar.disposers.push(ctx.slots.inject("sidebar.panellist", function () {
              return ctx.slots.register({
                name: "sidebar.panellist",
                id: CONSOLE_KEY,
                order: 40,
                label: function () { return IDLE_LABEL; }
              }, ConsoleSidebarIcon);
            }));
          }
          syncSidebar();
          var offSidebar = subscribePrefs(syncSidebar);

          function dispose() {
            offStatus();
            offSidebar();
            if (typeof offSection === "function") offSection();
            if (typeof status.dispose === "function") status.dispose();
            while (sidebar.disposers.length) {
              var off = sidebar.disposers.pop();
              if (typeof off === "function") off();
            }
          }
          if (typeof ctx.effect === "function") {
            ctx.effect(function () { return dispose; }, "ui-armor5: 状态条与设置台");
          }
          return dispose;
        }

        exports.name = "dsh-infinite-gen-5";
        exports.inject = ["slots"];
        exports.apply = apply;
        // 供自检脚本读取（浏览器侧无副作用）。
        // 设置台的程序化入口，与页面里点选走同一条路径（改完立刻通知订阅者）。
        exports.getPrefs = function () { return readPrefs(); };
        exports.setPrefs = function (patch) { return writePrefs(patch); };

        exports.__meta = {
          version: VERSION,
          slotMode: SLOT_MODE,
          slotName: SLOT_NAME,
          styleId: STYLE_ID,
          idleLabel: IDLE_LABEL,
          triggerMode: TRIGGER_MODE,
          triggerModes: TRIGGER_MODES,
          verdictGlyphs: VERDICT_GLYPHS,
          prefKey: PREF_KEY,
          prefDefaults: PREF_DEFAULTS,
          prefFields: Object.keys(PREF_DEFAULTS),
          consoleKey: CONSOLE_KEY,
          consoleOrder: CONSOLE_ORDER,
          sectionSlot: "settings.section",
          sidebarSlot: "sidebar.panellist",
          mainSlot: "main"
        };
        return module.exports;
      }
    });
  } catch (err) {
    console.warn('[AI Client Sandbox] dsh-infinite-gen-5 runtime error:', err);
  }
})();
