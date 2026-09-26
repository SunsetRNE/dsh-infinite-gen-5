(() => {
  try {
    /* 无限五代 (dsh-infinite-gen-5) client half — realtime badge */
    window.__ModuleLoader__.load({
      id: "dsh-infinite-gen-5",
      factory: (require) => {
        var module = { exports: {} };
        var exports = module.exports;
        Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

        var react = require("react");

        var inject = ["slots"];

        var ANIM_CSS = "@keyframes dshArmorPulse{0%,100%{box-shadow:0 0 2px rgba(16,185,129,.5);opacity:1}50%{box-shadow:0 0 14px rgba(16,185,129,1);opacity:.6}}@keyframes dshArmorFlash{0%{transform:scale(1)}30%{transform:scale(1.1)}100%{transform:scale(1)}}";

        var WRAP_STYLE = {
          display: "flex",
          justifyContent: "center",
          width: "100%"
        };
        var BADGE_STYLE = {
          display: "inline-flex",
          alignItems: "center",
          gap: "6px",
          width: "fit-content",
          padding: "3px 10px",
          borderRadius: "6px",
          border: "1px solid rgba(16, 185, 129, 0.45)",
          background: "rgba(16, 185, 129, 0.12)",
          color: "inherit",
          fontSize: "11px",
          lineHeight: "16px",
          fontFamily: "inherit",
          userSelect: "none",
          whiteSpace: "nowrap"
        };
        var DOT_STYLE = {
          width: "6px",
          height: "6px",
          borderRadius: "50%",
          background: "#10b981",
          flex: "none"
        };
        var FLASH_MS = 2500;
        var BADGE_TITLE = "无限五代 v0.5.1";

        // 同机若还装着上一代破甲插件，它的徽标也挂在同一个输入框上方 —— 两条绿条叠在一起。
        // 五代是接替者：接管显示，把上一代徽标折叠掉（对方仍在内核层运行，只是不重复显示）。
        // 只在五代自己拿到投影数据时才折叠；拿不到就保留对方的，避免两条都不显示。
        var FOREIGN_BADGE = /^无限[三四]代/;

        function ArmorDock(props) {
          var useProjection = props.useProjection;
          // 五代用自己的投影键，避免与同机安装的四代（key: "armor"）撞车。
          // 两个 useProjection 都是无条件调用，保持 hook 顺序恒定。
          var canProject = typeof useProjection === "function";
          var armor5 = canProject ? useProjection("infinite-gen-5:armor") : undefined;
          var armor4 = canProject ? useProjection("armor") : undefined;
          var armor = armor5 !== undefined ? armor5 : armor4;

          var badgeRef = react.useRef(null);
          var lastVerdictRef = react.useRef(null);
          var flashUntilRef = react.useRef(0);
          var tickPair = react.useState(0);
          var setTick = tickPair[1];

          react.useEffect(function () {
            var styleEl = null;
            if (!document.getElementById("dsh-armor5-css")) {
              styleEl = document.createElement("style");
              styleEl.id = "dsh-armor5-css";
              styleEl.textContent = ANIM_CSS;
              document.head.appendChild(styleEl);
            }
            return function () { if (styleEl) styleEl.remove(); };
          }, []);

          var foldable = armor !== undefined;
          react.useEffect(function () {
            if (!foldable) return undefined;
            var node = badgeRef.current;
            if (!node || !node.ownerDocument) return undefined;
            var doc = node.ownerDocument;
            var folded = [];
            var lastFolded = -1;
            var scan = function () {
              var all = doc.querySelectorAll("[data-armor]");
              for (var i = 0; i < all.length; i++) {
                var n = all[i];
                if (n === node) continue;
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
                    ? BADGE_TITLE + " · 已折叠上一代破甲徽标 x" + folded.length
                    : BADGE_TITLE,
                );
              }
            };
            scan();
            var mo = typeof MutationObserver === "function"
              ? new MutationObserver(scan)
              : null;
            if (mo) mo.observe(doc.body || doc.documentElement, { childList: true, subtree: true });
            return function () {
              if (mo) mo.disconnect();
              for (var i = 0; i < folded.length; i++) {
                folded[i].style.display = "";
                folded[i].removeAttribute("data-armor-folded-by");
              }
              folded.length = 0;
            };
          }, [foldable]);

          react.useEffect(function () {
            var v = armor && armor.verdict ? armor.verdict : null;
            if (v !== lastVerdictRef.current) {
              lastVerdictRef.current = v;
              if (v) flashUntilRef.current = Date.now() + FLASH_MS;
              setTick(Date.now());
            }
          }, [armor]);

          var running = !!(armor && armor.running);
          var words = armor && Array.isArray(armor.words) ? armor.words : [];
          var risk = armor && Array.isArray(armor.risk) ? armor.risk : [];
          var domain = armor && armor.domain ? armor.domain : null;
          var showVerdict = !running && lastVerdictRef.current !== null &&
            Date.now() < flashUntilRef.current;

          var text = BADGE_TITLE;
          var dotStyle = Object.assign({}, DOT_STYLE);
          var badgeStyle = Object.assign({}, BADGE_STYLE);

          if (running) {
            dotStyle.animation = "dshArmorPulse 1.2s ease-in-out infinite";
            text = "执行中…";
          } else if (showVerdict) {
            if (lastVerdictRef.current === "pass") {
              text = "✓ 通过" + (domain ? " · " + domain : "") + (risk.length ? " · 载荷x" + risk.length : "");
              badgeStyle.animation = "dshArmorFlash 1.2s ease";
            } else {
              text = "✗ " + (words[0] || "触发安全拒绝");
              badgeStyle.animation = "dshArmorFlash 1.6s ease";
              badgeStyle.borderColor = "rgba(239, 68, 68, 0.5)";
              badgeStyle.background = "rgba(239, 68, 68, 0.12)";
              dotStyle.background = "#ef4444";
            }
          }

          return react.createElement(
            "div",
            { style: WRAP_STYLE },
            react.createElement(
              "div",
              { style: badgeStyle, ref: badgeRef, "data-armor": "gen5", title: BADGE_TITLE },
              react.createElement("span", { style: dotStyle }),
              react.createElement("span", null, text)
            )
          );
        }

        function apply(ctx) {
          ctx.slots.inject("conversation.input.dock", () =>
            ctx.slots.register({
              name: "conversation.input.dock",
              id: "armor5",
              order: 30
            }, ArmorDock)
          );
        }

        exports.name = "dsh-infinite-gen-5";
        exports.inject = inject;
        exports.apply = apply;
        return module.exports;
      }
    });
  } catch (err) {
    console.warn('[AI Client Sandbox] dsh-infinite-gen-5 runtime error:', err);
  }
})();
