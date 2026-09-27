/**
 * 统计数据库：插件本体（核心）单写、前端面板单读的那一份 JSON。
 *
 * 为什么要这份文件：面板过去是「点一下 → 服务端现算一份 state → 返回」，等于面板间接
 * 依赖插件内部形态（哪些键、怎么算、算的时候能不能读盘）。现在反过来 —— 核心把该说的
 * 话**写进数据库**，面板只读数据库，不参与任何计算，也不知道插件内部长什么样：
 *
 *   核心（index.js）  --写-->  统计数据库（infinite-gen-5-stats.json）  --读-->  面板（client.js）
 *
 * 因此本模块刻意不依赖 cordis / index.js：读写两侧都能单独测。
 * 写侧：原子替换（tmp + rename），防抖合流（默认 750ms，可关），失败只记录不抛
 * （统计是旁路信息，绝不能因为它把插件本体搞坏）。
 * 读侧：只读盘上的文件，不触发任何计算；盘上没有/读坏时由调用方决定降级策略。
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** 数据库 schema 标识；结构变了就加尾号，读侧按它决定要不要认这份文件。 */
export const STATS_SCHEMA = "ig5-stats/1";
export const STATS_FILE_NAME = "infinite-gen-5-stats.json";
export const STATS_PLUGIN = "dsh-infinite-gen-5";
export const DEFAULT_FLUSH_MS = 750;

const readEnvPath = (name) => {
  const raw = process.env[name];
  return raw && raw.trim() ? raw.trim() : null;
};

/** 数据库所在目录：IG5_HOME > DSH_HOME > ~/.dsh（与调参档位同一套约定）。 */
export const statsHome = () =>
  readEnvPath("IG5_HOME") ?? readEnvPath("DSH_HOME") ?? join(homedir(), ".dsh");

/** 数据库路径；IG5_STATS_FILE 可整体覆盖（测试用）。 */
export const statsFile = () => readEnvPath("IG5_STATS_FILE") ?? join(statsHome(), STATS_FILE_NAME);

/** 空库骨架 —— 读侧拿到的键永远齐全，面板不必到处判 undefined。 */
export const emptyStats = (version, at = null) => ({
  schema: STATS_SCHEMA,
  plugin: STATS_PLUGIN,
  version,
  generatedAt: at,
  boot: { at, pid: process.pid, version },
  runtime: { role: "unknown", anchorEmissions: 0, rebuilds: 0, sections: [], placements: [] },
  tuning: null,
  tools: { calls: {}, total: 0, capped: 0, truncated: 0, lastCall: null },
  tasks: {
    available: false,
    source: null,
    reason: "尚未读到会话任务清单",
    counts: { pending: 0, inProgress: 0, completed: 0 },
    items: [],
    lastKnown: null,
    at: null,
    session: null,
    writes: [],
  },
  sessions: { seen: 0, events: 0, lastId: null, lastAt: null },
  counters: {},
});

/** 极简安全解析：坏文件当没有，绝不抛（与 index.js 的 safeParseJson 各管一段，互不依赖）。 */
const parseJsonSafe = (text) => {
  try {
    const value = JSON.parse(text);
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
};

const cloneJson = (value) => {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return null;
  }
};

/** 深合并：把已落盘的旧库盖到空骨架上，未知键保留（前向兼容）。 */
const mergeStats = (base, loaded) => {
  if (!loaded || typeof loaded !== "object") return base;
  const out = { ...base };
  for (const [key, value] of Object.entries(loaded)) {
    const current = out[key];
    if (value && typeof value === "object" && !Array.isArray(value) && current && typeof current === "object" && !Array.isArray(current)) {
      out[key] = mergeStats(current, value);
    } else {
      out[key] = value;
    }
  }
  return out;
};

const toPath = (path) => (Array.isArray(path) ? path.map(String) : String(path).split(".").filter(Boolean));

/**
 * 创建一个统计数据库写入器。
 *
 * @param {object} [options]
 * @param {string} [options.file] 数据库路径（默认 statsFile()）
 * @param {string} [options.version] 当前插件版本，写进库里供面板显示
 * @param {number} [options.flushMs] 防抖毫秒；0 = 每次改动立即落盘
 * @param {boolean} [options.autoLoad] 构造时就吸收盘上旧库（跨进程重启保留计数）
 * @param {() => string} [options.now] 时钟，测试可注入
 */
export const createStatsStore = (options = {}) => {
  const file = options.file ?? statsFile();
  const version = String(options.version ?? "0.0.0");
  const flushMs = Number.isFinite(options.flushMs) ? Math.max(0, Number(options.flushMs)) : DEFAULT_FLUSH_MS;
  const now = typeof options.now === "function" ? options.now : () => new Date().toISOString();

  let doc = emptyStats(version, now());
  let dirty = false;
  let timer = null;
  let lastError = null;
  let writes = 0;

  const flush = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (!dirty) return false;
    dirty = false;
    try {
      mkdirSync(dirname(file), { recursive: true });
      const tmp = `${file}.tmp-${process.pid}`;
      writeFileSync(tmp, `${JSON.stringify(doc, null, 2)}\n`, "utf8");
      renameSync(tmp, file);
      writes += 1;
      lastError = null;
    } catch (error) {
      lastError = String((error && error.message) || error);
      dirty = true;
      return false;
    }
    return true;
  };

  const schedule = () => {
    dirty = true;
    doc.generatedAt = now();
    if (flushMs === 0) {
      flush();
      return;
    }
    if (timer !== null) return;
    timer = setTimeout(() => {
      timer = null;
      flush();
    }, flushMs);
    if (typeof timer.unref === "function") timer.unref();
  };

  const at = (path) => {
    const keys = toPath(path);
    let node = doc;
    for (const key of keys.slice(0, -1)) {
      if (!node[key] || typeof node[key] !== "object") node[key] = {};
      node = node[key];
    }
    return { node, key: keys.at(-1) };
  };

  const load = () => {
    try {
      const loaded = parseJsonSafe(readFileSync(file, "utf8"));
      if (loaded && loaded.schema === STATS_SCHEMA) {
        doc = mergeStats(emptyStats(version, now()), loaded);
        // 版本号与插件名是「谁在写这份库」，不跟着旧盘走：升级后第一次读就必须反映当前版本，
        // 否则面板会一直显示上一版的版本号（历史数据该留的留，标识该更新的更新）。
        doc.version = version;
        doc.plugin = STATS_PLUGIN;
        dirty = true;
      }
      return true;
    } catch {
      return false;
    }
  };

  if (options.autoLoad === true) load();

  return {
    file,
    schema: STATS_SCHEMA,
    version,
    get dirty() {
      return dirty;
    },
    get writes() {
      return writes;
    },
    get lastError() {
      return lastError;
    },
    /** 整段替换一个顶层分区（写侧唯一入口之一）。 */
    set(section, value) {
      doc[section] = value;
      schedule();
      return doc[section];
    },
    /** 合并式更新一个顶层分区。 */
    patch(section, fields) {
      const base = doc[section] && typeof doc[section] === "object" ? doc[section] : {};
      doc[section] = { ...base, ...fields };
      schedule();
      return doc[section];
    },
    /** 计数：bump("tools.total") / bump(["tools","calls","scenario"], 1)。 */
    bump(path, n = 1) {
      const { node, key } = at(path);
      node[key] = (Number(node[key]) || 0) + (Number(n) || 0);
      schedule();
      return node[key];
    },
    /** 往数组分区里追加一条尾部记录（如清单写入历史），只留最近 n 条。 */
    push(path, entry, keep = 20) {
      const { node, key } = at(path);
      const list = Array.isArray(node[key]) ? node[key] : [];
      list.push(cloneJson(entry) ?? entry);
      node[key] = list.slice(-Math.max(1, keep));
      schedule();
      return node[key];
    },
    /** 读内存里的当前库（深拷贝，调用方改不动内部状态）。 */
    snapshot() {
      return cloneJson(doc) ?? doc;
    },
    /** 读盘上的库 —— 面板读侧走这里，不触发任何计算。 */
    read() {
      const loaded = parseJsonSafe((() => {
        try {
          return readFileSync(file, "utf8");
        } catch {
          return "";
        }
      })());
      if (loaded && loaded.schema === STATS_SCHEMA) return loaded;
      return null;
    },
    /** 落盘（force=true 时即便没有脏标记也写一次）。 */
    flush(force = false) {
      if (force) dirty = true;
      return flush();
    },
    /** 停止防抖计时器并把剩余改动落盘（插件卸载/进程退出前调）。 */
    dispose() {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      dirty = true;
      return flush();
    },
    load,
  };
};
