(() => {
  try {
    /* 无限五代 (dsh-infinite-gen-5) client half — 原生风格状态条 v0.7.0 */
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

        var VERSION = "v0.7.0";
        var TITLE = "无限五代 " + VERSION;
        var FLASH_MS = 3200;

        // 空闲态的常驻文字。原生上下文计量器是「图标 + 文字」的 chip，我们跟它同排，
        // 留一个纯空白圆点会变成没人认得的装饰，所以保留一个与原生同色的静态标签。
        // 想更隐蔽就把它改成 ""（只剩一个中性圆点）。
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
          ".dsh-armor5-note{margin:8px 0 0;color:var(--dsw-alias-label-caption,#8b8b8b)}"
        ].join("");

        function sameNode(a, b) {
          return a === b;
        }

        function ArmorDock(props) {
          var useProjection = props.useProjection;
          // 两个 useProjection 都是无条件调用，保持 hook 顺序恒定。
          // 五代用自己的投影键；"armor" 留给同机安装的四代（key: "armor"）。
          var canProject = typeof useProjection === "function";
          var armor5 = canProject ? useProjection("infinite-gen-5:armor") : undefined;
          var armor4 = canProject ? useProjection("armor") : undefined;
          var armor = armor5 !== undefined ? armor5 : armor4;

          var rootRef = react.useRef(null);
          var lastVerdictRef = react.useRef(null);
          var flashUntilRef = react.useRef(0);
          var tickPair = react.useState(0);
          var setTick = tickPair[1];
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

          // 3) 判决闪烁：记下到期时刻，并排一个一次性定时器在到期时重渲染一次。
          react.useEffect(function () {
            var v = armor && armor.verdict ? armor.verdict : null;
            if (v === lastVerdictRef.current) return undefined;
            lastVerdictRef.current = v;
            if (!v) return undefined;
            flashUntilRef.current = Date.now() + FLASH_MS;
            var timer = setTimeout(function () { setTick(Date.now()); }, FLASH_MS + 60);
            return function () { clearTimeout(timer); };
          }, [armor]);

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
          var flashing = !running && verdict !== null &&
            lastVerdictRef.current !== null && Date.now() < flashUntilRef.current;

          var tone = "quiet";
          var text = IDLE_LABEL;
          var busy = false;
          if (running) {
            tone = "running";
            busy = true;
            text = "执行中";
          } else if (flashing) {
            if (verdict === "pass") {
              tone = "success";
              text = "通过" +
                (domain ? " · " + domain : "") +
                (risk.length ? " · 载荷 " + risk.length : "");
            } else {
              tone = "error";
              text = (verdict === "fallback" ? "兜底" : "拒绝") +
                (words.length ? " · " + words[0] : "");
            }
          }

          var title = TITLE +
            (running ? " · 正在执行" : verdict ? " · 最近判决 " + verdict : " · 空闲") +
            (armor === undefined ? " · 等待投影" : "");

          var rows = [
            ["状态", running ? "执行中" : armor === undefined ? "等待投影数据" : "空闲"],
            ["最近判决", verdict === null ? "—" : verdict],
            ["识别领域", domain
              ? (domainLabel && domainLabel !== domain
                  ? domainLabel + "（" + domain + (domainHits ? " · 命中 " + domainHits : "") + "）"
                  : domain + (domainHits ? "（命中 " + domainHits + "）" : ""))
              : "—"],
            ["命中词", words.length ? words.join("、") : "—"],
            ["风险载荷", risk.length ? risk.join("、") : "—"],
            ["安全标记", safe.length ? String(safe.length) : "—"],
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
                "载荷已注入系统提示词最前，Order 200 末位锚点复述。判定取自本次会话的实时投影。"
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
              react.createElement("span", {
                className: "dsh-armor5-dot",
                "data-busy": busy ? "true" : undefined
              })
            ),
            panel
          );
        }

        function apply(ctx) {
          // inject 只在宿主声明了该槽位后才回调，所以未声明的槽位不会抛错，只是不渲染。
          ctx.slots.inject(SLOT_NAME, () =>
            ctx.slots.register({
              name: SLOT_NAME,
              id: SLOT_ID,
              order: SLOT_ORDER
            }, ArmorDock)
          );
        }

        exports.name = "dsh-infinite-gen-5";
        exports.inject = ["slots"];
        exports.apply = apply;
        // 供自检脚本读取（浏览器侧无副作用）。
        exports.__meta = {
          version: VERSION,
          slotMode: SLOT_MODE,
          slotName: SLOT_NAME,
          styleId: STYLE_ID,
          idleLabel: IDLE_LABEL
        };
        return module.exports;
      }
    });
  } catch (err) {
    console.warn('[AI Client Sandbox] dsh-infinite-gen-5 runtime error:', err);
  }
})();
