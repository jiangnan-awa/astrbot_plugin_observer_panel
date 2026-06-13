// ============================================================================
// 应用状态管理
// ============================================================================

const initialQuery = new URLSearchParams(window.location.search);

const state = {
  summary: null,
  system: null,
  logs: null,
  config: null,
  traceInsights: null,
  logCache: {
    signature: "",
    entries: [],
    insights: null,
    fileEntries: new Map(),
    sseEntries: [],
  },
  refreshing: false,
  pendingRefresh: false,
  openDetails: new Set(),
  highlightLogEntryId: "",
  selectedEventId: "",
  activeTab: "overview",
  astrbotSubTab: "sessions",
  logLevel: "all",
  eventType: "all",
  logPage: 1,
  logPageSize: 80,
  logTimeFilter: "all",
  ui: {
    runningTimeoutMs: 10 * 60 * 1000,
    slowSessionMs: 30 * 1000,
    slowToolMs: 15 * 1000,
    importantEventLimit: 80,
    rawClipLength: 5000,
  },
  screenMode: initialQuery.get("screen") === "1",
  privacyMode: false,
  timer: null,
  logFilterTimer: null,
  refreshMs: 5000,
  lastRefreshTime: 0,
  messageStats: { total: 0, lastCount: 0, lastTime: 0 },
  sseConnected: false,
  sseReconnectTimer: null,
  sseEventSource: null,
};

// ============================================================================
// 常量定义
// ============================================================================

const LEVELS = {
  error: { label: "错误", badge: "bad" },
  warn: { label: "警告", badge: "warn" },
  info: { label: "信息", badge: "ok" },
  debug: { label: "调试", badge: "debug" },
  trace: { label: "追踪", badge: "debug" },
  other: { label: "其他", badge: "" },
};

const DIAGNOSTIC_LEVELS = {
  ok: { label: "健康", badge: "ok" },
  info: { label: "提示", badge: "debug" },
  warn: { label: "注意", badge: "warn" },
  bad: { label: "异常", badge: "bad" },
};

const MODULE_CHART_LIMIT = 10;
const TRACE_ANALYSIS_ENTRY_LIMIT = 1500;
const IMPORTANT_EVENT_TYPES = new Set(["tool_call", "tool_result", "message_out", "slow", "warn", "error"]);

// 模块标签映射
const CORE_MODULE_LABELS = {
  "core.event_bus": "核心: 事件总线",
  "core.pipeline": "核心: 消息管线",
  "core.provider": "核心: 模型调度",
  "core.star": "核心: 插件系统",
  "core.star_handler": "核心: 插件处理",
  "core.session": "核心: 会话",
  "core.config": "核心: 配置",
  "core.astrbot_config": "核心: 配置",
  "star.session_plugin_manager": "核心: 会话插件管理",
};

const METHOD_MODULE_LABELS = {
  "method.star_request": "插件调度",
  "method.llm_request": "模型请求",
  "method.provider_request": "模型请求",
};

const PLUG_MODULE_LABELS = {
  "core.event_handler": "插件模块: 事件处理",
  "managers.conversation_manager": "插件模块: 会话管理",
  "processors.memory_processor": "插件模块: 记忆处理",
  "storage.conversation_store": "插件模块: 对话存储",
  "utils.__init__": "插件模块: 工具函数",
};

const TRACE_ACTION_LABELS = {
  astr_agent_prepare: "Trace: Agent 准备",
  astr_agent_complete: "Trace: Agent 完成",
  astr_agent_error: "Trace: Agent 错误",
  agent_tool_call: "Trace: 工具调用",
  agent_tool_result: "Trace: 工具结果",
  provider_request: "Trace: 模型请求",
  provider_response: "Trace: 模型响应",
  sel_persona: "Trace: 选择人格",
  AstrMessageEvent: "Trace: 消息事件",
};

// 网络接口状态（/sys/class/net/*/operstate）中文映射
const INTERFACE_STATE_LABELS = {
  up: "在线",
  down: "断开",
  unknown: "未知",
  dormant: "休眠",
  lowerlayerdown: "下层断开",
  notpresent: "未接入",
  testing: "测试中",
};

// 快捷键键名中文/可读映射
const SHORTCUT_KEY_LABELS = {
  " ": "空格",
  Escape: "Esc",
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
};

const EVENT_TYPES = {
  message_in: { label: "收到消息", badge: "ok", className: "event-message-in" },
  persona: { label: "规则选择", badge: "debug", className: "event-persona" },
  model_start: { label: "开始生成", badge: "debug", className: "event-model" },
  tool_call: { label: "工具调用", badge: "warn", className: "event-tool" },
  tool_result: { label: "工具返回", badge: "ok", className: "event-tool" },
  message_out: { label: "发送回复", badge: "ok", className: "event-message-out" },
  slow: { label: "慢请求", badge: "warn", className: "event-slow" },
  warn: { label: "警告", badge: "warn", className: "event-warn" },
  error: { label: "错误", badge: "bad", className: "event-error" },
};

const DEFAULT_RUNNING_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_SLOW_SESSION_MS = 30 * 1000;
const DEFAULT_SLOW_TOOL_MS = 15 * 1000;
const DEFAULT_IMPORTANT_EVENT_LIMIT = 80;
const DEFAULT_LOG_PAGE_SIZE = 80;
const DEFAULT_RAW_CLIP_LENGTH = 5000;

// ============================================================================
// 工具函数 - DOM 操作
// ============================================================================

const qs = initialQuery;
const token = qs.get("token") || "";

document.body.classList.toggle("screen-mode", state.screenMode);

function $(id) {
  return document.getElementById(id);
}

function withToken(path) {
  const url = new URL(path, window.location.origin);
  if (token) {
    url.searchParams.set("token", token);
  }
  return url.pathname + url.search;
}

// ============================================================================
// 工具函数 - 网络请求
// ============================================================================

async function fetchJson(path) {
  const res = await fetch(withToken(path), {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const text = await res.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch (err) {
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 180)}`);
  }
  if (!res.ok || payload.ok === false) {
    throw new Error(payload.error || `HTTP ${res.status}`);
  }
  return payload;
}

function logCursorPayload() {
  const files = state.logs?.astrbot || [];
  return files
    .filter((file) => file.path)
    .map((file) => ({
      path: file.path,
      size: file.size || 0,
      mtime: file.mtime || 0,
      line_count: file.line_count || (Number(file.base_line || 0) + (file.lines || []).length),
      base_line: file.base_line || 0,
      ends_with_newline: file.ends_with_newline !== false,
    }));
}

function logsApiPath() {
  const params = new URLSearchParams({ source: "astrbot" });
  const cursor = logCursorPayload();
  if (cursor.length) {
    params.set("cursor", JSON.stringify(cursor));
  }
  return `/api/logs?${params.toString()}`;
}

function logTailLimit() {
  return Math.max(20, Number(state.config?.astrbot?.tail_lines || 300));
}

function mergeLogFile(existing, incoming) {
  const current = existing || {};
  const incomingLines = Array.isArray(incoming.lines) ? incoming.lines : [];
  if (!current.path || incoming.reset || !Array.isArray(current.lines) || !current.readable || !incoming.readable) {
    return {
      ...current,
      ...incoming,
      lines: incomingLines.slice(-logTailLimit()),
      base_line: Number(incoming.base_line || 0),
      line_count: Number(incoming.line_count || incomingLines.length || 0),
    };
  }

  const mergedLines = current.lines.concat(incomingLines);
  const lineCount = Number(incoming.line_count || current.line_count || 0);
  const overflow = Math.max(0, mergedLines.length - logTailLimit());
  const lines = mergedLines.slice(overflow);
  const baseLine = Math.max(Number(current.base_line || 0) + overflow, lineCount - lines.length, 0);
  return {
    ...current,
    ...incoming,
    lines,
    base_line: baseLine,
    line_count: lineCount || (baseLine + lines.length),
  };
}

function mergeLogData(incoming) {
  const current = state.logs || {};
  const byPath = new Map((current.astrbot || []).map((file) => [file.path, file]));
  const nextAstrBot = (incoming?.astrbot || []).map((file) => mergeLogFile(byPath.get(file.path), file));
  state.logs = {
    ...current,
    ...incoming,
    astrbot: nextAstrBot,
  };
}

// ============================================================================
// 工具函数 - 格式化
// ============================================================================

/**
 * 格式化字节大小
 * @param {number} size - 字节数
 * @returns {string} 格式化后的字符串
 */
function formatBytes(size) {
  const number = Number(size || 0);
  if (!Number.isFinite(number)) return "--";
  const units = ["B", "KB", "MB", "GB"];
  let value = number;
  let idx = 0;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }
  return `${value.toFixed(idx === 0 ? 0 : 1)} ${units[idx]}`;
}

/**
 * 格式化百分比
 * @param {number} value - 百分比值
 * @returns {string} 格式化后的字符串
 */
function formatPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "--";
  return `${number.toFixed(number >= 10 ? 1 : 2)}%`;
}

/**
 * 格式化数字
 * @param {number} value - 数字
 * @returns {string} 格式化后的字符串
 */
function formatNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "--";
  return new Intl.NumberFormat("zh-CN").format(number);
}

/**
 * 格式化时间戳
 * @param {number} msOrSeconds - 毫秒或秒时间戳
 * @returns {string} 格式化后的时间字符串
 */
function formatTime(msOrSeconds) {
  if (!msOrSeconds) return "--";
  const value = Number(msOrSeconds);
  const ms = value > 10_000_000_000 ? value : value * 1000;
  return new Date(ms).toLocaleString("zh-CN");
}

function formatLogTime(entry) {
  if (entry.timestamp) {
    return new Date(entry.timestamp).toLocaleString("zh-CN", { hour12: false });
  }
  if (entry.fileMtime) {
    return `文件 ${formatTime(entry.fileMtime)}`;
  }
  return "--";
}

function formatCompactLogTime(entry) {
  if (!entry.timestamp) return entry.fileMtime ? `文件 ${formatTime(entry.fileMtime)}` : "--";
  const date = new Date(entry.timestamp);
  const now = new Date();
  const sameDay = date.getFullYear() === now.getFullYear()
    && date.getMonth() === now.getMonth()
    && date.getDate() === now.getDate();
  if (sameDay) {
    return date.toLocaleTimeString("zh-CN", { hour12: false });
  }
  return `${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")} ${date.toLocaleTimeString("zh-CN", { hour12: false })}`;
}

/**
 * 格式化运行时长
 * @param {number} seconds - 秒数
 * @returns {string} 格式化后的时长字符串
 */
function shortUptime(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds || 0)));
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (d) return `${d}天 ${h}小时`;
  if (h) return `${h}小时 ${m}分钟`;
  if (m) return `${m}分钟 ${s}秒`;
  return `${s}秒`;
}

// ============================================================================
// 工具函数 - UI 辅助
// ============================================================================

/**
 * 设置元素文本内容
 * @param {string} id - 元素 ID
 * @param {*} value - 要设置的值
 */
function setText(id, value) {
  const el = $(id);
  if (el) el.textContent = value == null || value === "" ? "--" : String(value);
}

/**
 * 显示提示消息
 * @param {string} message - 消息内容
 */
function toast(message) {
  const el = $("toast");
  el.textContent = message;
  el.classList.add("show");
  window.clearTimeout(toast._timer);
  toast._timer = window.setTimeout(() => el.classList.remove("show"), 3200);
}

/**
 * 根据使用率判断状态类型
 * @param {number} percent - 百分比
 * @returns {string} 状态类型
 */
function usageKind(percent) {
  const value = Number(percent || 0);
  if (value >= 90) return "bad";
  if (value >= 75) return "warn";
  return "ok";
}

function clampNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function boolValue(value, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const text = value.trim().toLowerCase();
    if (["1", "true", "yes", "on", "开", "是"].includes(text)) return true;
    if (["0", "false", "no", "off", "关", "否"].includes(text)) return false;
  }
  if (value == null) return fallback;
  return Boolean(value);
}

function applyPublicConfig(config) {
  const ui = config?.ui || {};
  const runningTimeoutMinutes = clampNumber(ui.running_timeout_minutes, DEFAULT_RUNNING_TIMEOUT_MS / 60000, 1, 1440);
  const slowSessionSeconds = clampNumber(ui.slow_session_seconds, DEFAULT_SLOW_SESSION_MS / 1000, 1, 3600);
  const slowToolSeconds = clampNumber(ui.slow_tool_seconds, DEFAULT_SLOW_TOOL_MS / 1000, 1, 3600);
  state.ui = {
    runningTimeoutMs: runningTimeoutMinutes * 60 * 1000,
    slowSessionMs: slowSessionSeconds * 1000,
    slowToolMs: slowToolSeconds * 1000,
    importantEventLimit: Math.round(clampNumber(ui.important_event_limit, DEFAULT_IMPORTANT_EVENT_LIMIT, 10, 500)),
    rawClipLength: DEFAULT_RAW_CLIP_LENGTH,
  };
  state.logPageSize = Math.round(clampNumber(ui.log_page_size, DEFAULT_LOG_PAGE_SIZE, 20, 500));
  state.privacyMode = boolValue(ui.privacy_mode, false);
  state.refreshMs = Math.max(2000, Number(config?.refresh_interval_seconds || 5) * 1000);
  document.body.classList.toggle("screen-mode", state.screenMode);
  document.body.classList.toggle("privacy-mode", state.privacyMode);
}

function privacyText(text, fallback = "隐私模式已隐藏内容") {
  if (!state.privacyMode) return text;
  return text ? fallback : text;
}

function getLogSearchText() {
  return (($("logFilter")?.value || "").trim().toLowerCase());
}

function clippedText(text, maxLength = state.ui.rawClipLength) {
  const value = String(text || "");
  if (value.length <= maxLength) {
    return { text: value, clipped: false };
  }
  return {
    text: `${value.slice(0, maxLength)}\n\n[原文过长，已裁剪 ${value.length - maxLength} 个字符]`,
    clipped: true,
  };
}

function stableKeyText(text, maxLength = 180) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function detailKey(prefix, ...parts) {
  return `${prefix}:${parts.map((part) => stableKeyText(part, 220)).join(":")}`;
}

function renderSignature(id, parts) {
  const el = $(id);
  if (!el) return null;
  let signature;
  try {
    signature = JSON.stringify(parts);
  } catch (err) {
    signature = String(parts);
  }
  if (el.dataset.renderSignature === signature) return null;
  el.dataset.renderSignature = signature;
  return el;
}

function eventListSignature(events, limit) {
  return [
    "events",
    state.privacyMode,
    state.selectedEventId,
    limit,
    events.map((event) => [
      event.id,
      event.timestamp,
      event.type,
      event.title,
      event.detail,
      event.meta,
      event.durationMs,
      event.evidence?.logEntryId,
      event.evidence?.rule,
    ]),
  ];
}

function chartSignature(items) {
  return [
    "chart",
    items.map((item) => [
      item.label,
      item.value,
      item.scaleValue,
      item.displayValue,
      item.className,
      item.detail,
      item.unit,
    ]),
  ];
}

function bindDetailsState(details, key) {
  if (!details || !key) return;
  if (details.dataset.boundKey === key) return;
  details.dataset.detailKey = key;
  details.dataset.boundKey = key;
  details.open = state.openDetails.has(key);
  details.addEventListener("toggle", () => {
    if (details.open) {
      state.openDetails.add(key);
    } else {
      state.openDetails.delete(key);
    }
  });
}

function pruneOpenDetails(prefix, activeKeys) {
  if (!(activeKeys instanceof Set)) return;
  state.openDetails.forEach((key) => {
    if (key.startsWith(prefix) && !activeKeys.has(key)) {
      state.openDetails.delete(key);
    }
  });
}

function eventChainDetailKey(event) {
  return detailKey("event-chain", event.spanId, event.type, event.timestamp, event.title);
}

function logEntryDetailKey(entry) {
  return detailKey("log-entry", entry.path, entry.timestamp || entry.fileMtime || "", entry.summary || entry.message || "", entry.raw);
}

// ============================================================================
// 渲染函数 - 总览页面
// ============================================================================

/**
 * 渲染资源使用率仪表盘
 * @param {HTMLElement} parent - 父元素
 * @param {string} label - 标签
 * @param {number} value - 百分比值
 * @param {string} meta - 元数据描述
 * @param {string} kind - 状态类型
 */
function renderGauge(parent, label, value, meta, kind = usageKind(value)) {
  const item = document.createElement("div");
  item.className = `resource-card ${kind}`;
  const head = document.createElement("div");
  head.className = "resource-head";
  const title = document.createElement("span");
  title.textContent = label;
  const number = document.createElement("strong");
  number.textContent = formatPercent(value);
  head.append(title, number);
  const track = document.createElement("div");
  track.className = "usage-track";
  const fill = document.createElement("div");
  fill.className = "usage-fill";
  fill.style.width = `${Math.max(0, Math.min(100, Number(value || 0)))}%`;
  track.appendChild(fill);
  const foot = document.createElement("small");
  foot.textContent = meta || "--";
  item.append(head, track, foot);
  parent.appendChild(item);
}

function diagnosticLabel(status) {
  return DIAGNOSTIC_LEVELS[status]?.label || "未知";
}

/**
 * 渲染总览页面
 */
function renderSummary() {
  const data = state.summary;
  if (!data) return;

  const astrbot = data.astrbot || {};
  const system = data.system || {};
  const plugin = data.plugin || {};
  const logStats = data.logs || {};
  const astrbotLogs = logStats.astrbot || [];
  const logAnalysis = logStats.analysis || {};
  const logCounts = logAnalysis.counts || {};
  const diagnostics = data.diagnostics || {};
  const readableLogs = astrbotLogs.filter((item) => item.readable).length;
  const memory = system.memory || {};
  const cpu = system.cpu || {};
  const host = system.host || {};
  const disks = system.disks || [];
  const rootDisk = disks[0] || {};
  state.system = system;

  // 计算 API 延迟
  const latencyMs = state.lastRefreshTime > 0 ? Date.now() - state.lastRefreshTime : 0;
  const latencyLabel = latencyMs < 100 ? "极快" : latencyMs < 300 ? "正常" : latencyMs < 1000 ? "较慢" : "缓慢";

  // 计算消息速率
  const insights = state.traceInsights;
  if (insights) {
    const currentCount = insights.messageInCount || 0;
    const now = Date.now();
    if (state.messageStats.lastTime > 0) {
      const timeDiff = (now - state.messageStats.lastTime) / 1000 / 60;
      const countDiff = currentCount - state.messageStats.lastCount;
      if (timeDiff > 0) {
        const rate = Math.round(countDiff / timeDiff);
        setText("messageRate", rate >= 0 ? `${rate} 条/分` : "--");
        setText("messageRateMeta", `总计 ${currentCount} 条`);
      }
    } else {
      setText("messageRate", "--");
      setText("messageRateMeta", `总计 ${currentCount} 条`);
    }
    state.messageStats = { total: currentCount, lastCount: currentCount, lastTime: now };
  }

  setText("apiLatency", latencyMs > 0 ? `${latencyMs}ms` : "--");
  setText("apiLatencyMeta", latencyLabel);

  // 更新顶部状态卡片
  setText("subtitle", `地址 ${plugin.url || window.location.href} | 已运行 ${shortUptime(plugin.uptime_seconds)}`);
  setText("systemState", diagnosticLabel(diagnostics.status));
  setText("systemMeta", `${host.hostname || "--"} | 评分 ${diagnostics.score ?? "--"}`);
  setText("cpuState", cpu.percent == null ? `${cpu.logical_count || 0} 核` : formatPercent(cpu.percent));
  setText("cpuMeta", `负载 ${cpu.load_average?.join(" / ") || "--"}`);
  setText("memoryState", formatPercent(memory.percent));
  setText("memoryMeta", `${formatBytes(memory.used)} / ${formatBytes(memory.total)}`);
  setText("logsState", `${logCounts.error || 0} 错误`);
  setText("logsMeta", `${readableLogs}/${astrbotLogs.length} 可读 | ${logCounts.warn || 0} 警告`);

  if (state.activeTab !== "overview" && !state.screenMode) {
    return;
  }

  setText("runtimeStamp", formatTime(data.now));
  setText("hostStamp", host.hostname || "--");

  // 渲染资源概览仪表盘（批量优化）
  const resource = $("resourceOverview");
  const fragment = document.createDocumentFragment();
  const tempContainer = document.createElement('div');

  // 准备所有仪表盘数据
  const gauges = [
    { label: "CPU 使用率", value: cpu.percent ?? 0, meta: `${cpu.logical_count || 0} 逻辑核心 | ${cpu.model || "未知 CPU"}` },
    { label: "内存使用率", value: memory.percent || 0, meta: `${formatBytes(memory.used)} / ${formatBytes(memory.total)}` },
    { label: "根分区", value: rootDisk.percent || 0, meta: `${formatBytes(rootDisk.used)} / ${formatBytes(rootDisk.total)}` }
  ];

  // 批量渲染到 fragment
  gauges.forEach(({ label, value, meta }) => {
    tempContainer.innerHTML = '';
    renderGauge(tempContainer, label, value, meta);
    if (tempContainer.firstElementChild) {
      fragment.appendChild(tempContainer.firstElementChild);
    }
  });

  // 一次性更新 DOM
  resource.innerHTML = "";
  resource.appendChild(fragment);

  // 渲染运行状态列表
  renderKv("runtimeList", {
    观察面板: `${plugin.name || "--"} ${plugin.version || ""}`.trim(),
    访问地址: plugin.url || window.location.href,
    面板运行时间: shortUptime(plugin.uptime_seconds),
    系统运行时间: shortUptime(host.uptime_seconds),
    AstrBot面板: formatDashboard(astrbot.dashboard),
    平台数量: astrbot.platforms_total || 0,
    健康评分: diagnostics.score == null ? "--" : `${diagnostics.score}/100`,
    诊断项: diagnostics.issue_count || 0,
    日志文件: `${readableLogs} 个可读`,
  });
}

/**
 * 格式化仪表盘地址
 * @param {object} value - 仪表盘配置对象
 * @returns {string} 格式化后的地址
 */
function formatDashboard(value) {
  if (!value || typeof value !== "object") return "--";
  const host = value.host || "127.0.0.1";
  const port = value.port || "";
  return port ? `${host}:${port}` : host;
}

// ============================================================================
// 渲染函数 - 通用组件
// ============================================================================

/**
 * 渲染键值对列表
 * @param {string} id - 容器元素 ID
 * @param {object} entries - 键值对对象
 */
function renderKv(id, entries) {
  const el = $(id);
  if (!el) return;
  el.innerHTML = "";
  Object.entries(entries).forEach(([key, value]) => {
    const rowEl = document.createElement("div");
    rowEl.className = "kv-row";
    const left = document.createElement("div");
    left.className = "kv-key";
    left.textContent = key;
    const right = document.createElement("div");
    right.className = "kv-value";
    right.textContent = value == null || value === "" ? "--" : String(value);
    rowEl.append(left, right);
    el.appendChild(rowEl);
  });
}

/**
 * 创建详细信息行元素
 * @param {string} label - 标签
 * @param {*} value - 值
 * @returns {HTMLElement} 行元素
 */
function detailRow(label, value) {
  const rowEl = document.createElement("div");
  rowEl.className = "detail-row";
  const key = document.createElement("span");
  key.textContent = label;
  const val = document.createElement("strong");
  val.textContent = value == null || value === "" ? "--" : String(value);
  rowEl.append(key, val);
  return rowEl;
}

/**
 * 创建徽章元素
 * @param {string} text - 文本
 * @param {string} kind - 类型
 * @returns {HTMLElement} 徽章元素
 */
function badge(text, kind) {
  const el = document.createElement("span");
  el.className = `badge ${kind || ""}`;
  el.textContent = text;
  return el;
}

/**
 * 创建空状态元素
 * @param {string} text - 提示文本
 * @returns {HTMLElement} 空状态元素
 */
function emptyBlock(text) {
  const empty = document.createElement("div");
  empty.className = "empty";
  empty.textContent = text;
  return empty;
}

// ============================================================================
// 渲染函数 - 系统页面
// ============================================================================

/**
 * 渲染堆栈项目（用于磁盘、网络等）
 * @param {HTMLElement} parent - 父元素
 * @param {string} title - 标题
 * @param {string} meta - 元信息
 * @param {number|null} percent - 百分比
 * @param {Array} details - 详细信息数组
 */
function renderStackItem(parent, title, meta, percent, details = []) {
  const item = document.createElement("div");
  item.className = `stack-item ${percent != null ? usageKind(percent) : ""}`;
  const head = document.createElement("div");
  head.className = "stack-head";
  const left = document.createElement("div");
  const titleEl = document.createElement("strong");
  titleEl.textContent = title || "--";
  const metaEl = document.createElement("small");
  metaEl.textContent = meta || "--";
  left.append(titleEl, metaEl);
  const percentEl = document.createElement("span");
  percentEl.textContent = percent == null ? "--" : formatPercent(percent);
  head.append(left, percentEl);

  item.appendChild(head);
  if (percent != null) {
    const track = document.createElement("div");
    track.className = "usage-track";
    const fill = document.createElement("div");
    fill.className = "usage-fill";
    fill.style.width = `${Math.max(0, Math.min(100, Number(percent || 0)))}%`;
    track.appendChild(fill);
    item.appendChild(track);
  }

  if (details.length) {
    const grid = document.createElement("div");
    grid.className = "detail-grid";
    details.forEach(([label, value]) => grid.appendChild(detailRow(label, value)));
    item.appendChild(grid);
  }
  parent.appendChild(item);
}

function renderSystem() {
  const data = state.system;
  if (!data) return;
  const host = data.host || {};
  const cpu = data.cpu || {};
  const memory = data.memory || {};
  const process = data.process || {};
  const python = data.python || {};
  const disks = data.disks || [];
  const interfaces = data.network?.interfaces || [];

  setText("systemStamp", host.hostname || "--");
  setText("processStamp", `PID ${process.pid || "--"}`);
  setText("diskStamp", `${disks.length} 个挂载点`);
  setText("networkStamp", `${interfaces.length} 个接口`);

  renderKv("systemInfo", {
    主机名: host.hostname,
    系统: host.platform,
    架构: host.machine,
    运行时间: shortUptime(host.uptime_seconds),
    CPU: cpu.model || "--",
    逻辑核心: cpu.logical_count || 0,
    CPU使用率: cpu.percent == null ? "--" : formatPercent(cpu.percent),
    平均负载: cpu.load_average?.join(" / ") || "--",
    内存: `${formatBytes(memory.used)} / ${formatBytes(memory.total)} (${formatPercent(memory.percent)})`,
    Swap: `${formatBytes(memory.swap_used)} / ${formatBytes(memory.swap_total)} (${formatPercent(memory.swap_percent)})`,
  });

  renderKv("processInfo", {
    PID: process.pid,
    PPID: process.ppid,
    线程数: process.threads,
    打开文件: process.open_fds,
    常驻内存: formatBytes(process.rss),
    虚拟内存: formatBytes(process.vms),
    峰值内存: formatBytes(process.max_rss),
    工作目录: process.cwd,
    Python: `${python.implementation || "Python"} ${python.version || ""}`.trim(),
    命令: process.cmdline,
  });

  const diskList = $("diskList");
  diskList.innerHTML = "";
  if (!disks.length) {
    diskList.appendChild(emptyBlock("没有可展示的磁盘信息。"));
  } else {
    disks.forEach((disk) => {
      renderStackItem(
        diskList,
        disk.path || disk.resolved_path,
        `${formatBytes(disk.used)} / ${formatBytes(disk.total)}`,
        disk.percent,
        [
          ["可用", formatBytes(disk.free)],
          ["已用", formatBytes(disk.used)],
          ["总量", formatBytes(disk.total)],
          ["路径", disk.resolved_path || disk.path],
        ],
      );
    });
  }

  const networkList = $("networkList");
  networkList.innerHTML = "";
  const visible = interfaces.filter((item) => item.name !== "lo" || item.addresses?.length);
  if (!visible.length) {
    networkList.appendChild(emptyBlock("没有可展示的网络接口。"));
  } else {
    visible.forEach((item) => {
      renderStackItem(
        networkList,
        item.name,
        `${INTERFACE_STATE_LABELS[item.state] || item.state || "未知"} | ${item.addresses?.join(", ") || "无地址"}`,
        null,
        [
          ["接收", formatBytes(item.rx_bytes)],
          ["发送", formatBytes(item.tx_bytes)],
          ["RX包", formatNumber(item.rx_packets)],
          ["TX包", formatNumber(item.tx_packets)],
          ["MTU", item.mtu || "--"],
          ["MAC", item.mac || "--"],
        ],
      );
    });
  }
  renderWorkspaceChrome();
}

function functionCard(title, value, meta, kind = "") {
  const item = document.createElement("article");
  item.className = `function-card ${kind || ""}`;
  const label = document.createElement("span");
  label.textContent = title;
  const number = document.createElement("strong");
  number.textContent = value == null || value === "" ? "--" : String(value);
  const hint = document.createElement("small");
  hint.textContent = meta || "--";
  item.append(label, number, hint);
  return item;
}

function renderAstrBot() {
  if (!state.traceInsights) return;
  renderAstrBotVisuals(state.traceInsights, state.logCache.entries || []);
}

function collectLogFiles() {
  const data = state.logs || {};
  return (data.astrbot || []).map((file) => ({ ...file, source: "astrbot", sourceName: "AstrBot" }));
}

function parseTimestamp(text) {
  const bracket = text.match(/\[(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?)\]/);
  const plain = bracket || text.match(/(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?)/);
  if (!plain) return null;
  const normalized = plain[1].replace(" ", "T");
  const ts = Date.parse(normalized);
  return Number.isFinite(ts) ? ts : null;
}

function normalizeLevel(value) {
  const text = String(value || "")
    .replace(/^\[|\]$/g, "")
    .trim()
    .toUpperCase();
  if (["FATAL", "CRITICAL", "ERROR", "ERR", "ERRO"].includes(text)) return "error";
  if (["WARN", "WARNING", "WRN"].includes(text)) return "warn";
  if (["INFO", "INFORMATION"].includes(text)) return "info";
  if (["DEBUG", "DBUG"].includes(text)) return "debug";
  if (["TRACE", "TRAC"].includes(text)) return "trace";
  return "";
}

function bracketParts(text) {
  return [...String(text || "").matchAll(/\[([^\]]+)\]/g)].map((match) => match[1].trim());
}

function structuredLevel(parts) {
  for (const part of parts) {
    const level = normalizeLevel(part);
    if (level) {
      return { level, rawLevel: part };
    }
  }
  return { level: "other", rawLevel: "" };
}

function tryParseJsonLog(rest) {
  const text = String(rest || "").trim();
  if (!text.startsWith("{")) return null;
  try {
    return JSON.parse(text);
  } catch (err) {
    return null;
  }
}

function compactText(text, maxLength = 420) {
  const normalized = String(text || "")
    .replace(/\s+/g, " ")
    .trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1)}…`;
}

function compactJson(value, maxLength = 220) {
  if (value == null || value === "") return "";
  try {
    return compactText(typeof value === "string" ? value : JSON.stringify(value), maxLength);
  } catch (err) {
    return compactText(String(value), maxLength);
  }
}

function safeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function extractResultId(text) {
  const value = String(text || "");
  return (value.match(/['"]id['"]:\s*['"]([^'"]+)['"]/) || [])[1] || "";
}

function extractResultTs(text) {
  const match = String(text || "").match(/['"]ts['"]:\s*([0-9.]+)/);
  return match ? Number(match[1]) * 1000 : null;
}

function buildTraceInfo(data) {
  if (!data || typeof data !== "object") return null;
  const fields = safeObject(data.fields);
  const tool = safeObject(fields.tool_name);
  const stats = safeObject(fields.stats);
  const tokenUsage = safeObject(stats.token_usage);
  const chatProvider = safeObject(fields.chat_provider);
  const resultText = fields.tool_result == null ? "" : String(fields.tool_result);
  return {
    action: data.action || data.name || "",
    spanId: data.span_id || "",
    time: Number(data.time || 0) ? Number(data.time) * 1000 : null,
    umo: data.umo || "",
    senderName: data.sender_name || "",
    messageOutline: data.message_outline || "",
    personaId: fields.persona_id || "",
    personaToolCount: Array.isArray(fields.persona_toolset) ? fields.persona_toolset.length : null,
    toolCallId: tool.id || extractResultId(resultText),
    toolName: tool.name || "",
    toolArgs: tool.args || null,
    toolStartTs: Number(tool.ts || 0) ? Number(tool.ts) * 1000 : null,
    toolResultTs: extractResultTs(resultText),
    toolResult: resultText,
    response: fields.resp || "",
    durationMs: Number(stats.start_time || 0) && Number(stats.end_time || 0)
      ? Math.max(0, (Number(stats.end_time) - Number(stats.start_time)) * 1000)
      : null,
    timeToFirstTokenMs: Number(stats.time_to_first_token || 0) * 1000 || null,
    tokenUsage,
    providerId: chatProvider.id || "",
    model: chatProvider.model || "",
  };
}

function extractQuotedField(text, name) {
  const pattern = new RegExp(`['"]${name}['"]:\\s*['"]([^'"]*)['"]`);
  const match = String(text || "").match(pattern);
  return match ? match[1] : "";
}

function summarizeJsonLog(data) {
  if (!data || typeof data !== "object") return "";
  const fields = data.fields && typeof data.fields === "object" ? data.fields : {};
  const parts = [];
  if (data.action) parts.push(data.action);
  if (data.sender_name) parts.push(`发送者 ${data.sender_name}`);
  if (data.message_outline) parts.push(`消息 ${data.message_outline}`);
  if (fields.resp) parts.push(`回复 ${fields.resp}`);
  if (fields.tool_name?.name) parts.push(`工具 ${fields.tool_name.name}`);
  if (fields.tool_result) parts.push(`工具结果 ${fields.tool_result}`);
  if (!parts.length && data.name) parts.push(data.name);
  return compactText(parts.join(" | ") || JSON.stringify(data), 520);
}

function summarizePlainLog(message, raw) {
  const sourceText = String(message || raw || "");
  if (sourceText.includes("RawMessage <Event")) {
    const sender = extractQuotedField(sourceText, "nickname") || extractQuotedField(sourceText, "card");
    const rawMessage = extractQuotedField(sourceText, "raw_message");
    const group = extractQuotedField(sourceText, "group_name");
    const parts = ["平台消息"];
    if (sender || rawMessage) parts.push(`${sender || "未知发送者"}: ${rawMessage || "事件数据"}`);
    if (group) parts.push(group);
    return compactText(parts.join(" | "), 520);
  }
  return compactText(sourceText, 520);
}

function parseLogLine(line, file, lineIndex, globalIndex) {
  const raw = String(line || "");
  const lineNumber = Number(file.base_line || 0) + lineIndex + 1;
  const timestamped = raw.match(/^\[(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?)\]\s*(.*)$/);
  const astrbot = raw.match(/^\[(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?)\]\s+((?:\[[^\]]+\]\s*)+):\s*(.*)$/);
  let timeText = "";
  let scope = "";
  let rawLevel = "";
  let moduleName = "";
  let message = raw;
  let level = "other";
  let levelSource = "未标记";
  let parsedJson = null;

  if (astrbot) {
    timeText = astrbot[1];
    const parts = bracketParts(astrbot[2]);
    const detected = structuredLevel(parts);
    level = detected.level;
    rawLevel = detected.rawLevel;
    levelSource = rawLevel ? "日志头" : "未标记";
    scope = parts.find((part) => !normalizeLevel(part) && !part.includes(":") && !part.includes(".py") && !part.includes(".js") && !/^v?\d+(?:\.\d+)+/.test(part)) || "";
    moduleName = [...parts].reverse().find((part) => part.includes(":") || part.includes(".py") || part.includes(".js")) || "";
    message = astrbot[3];
  } else if (timestamped) {
    timeText = timestamped[1];
    parsedJson = tryParseJsonLog(timestamped[2]);
    if (parsedJson) {
      const detected = normalizeLevel(parsedJson.level);
      level = detected || "other";
      rawLevel = parsedJson.level || "";
      levelSource = rawLevel ? "JSON level" : "未标记";
      scope = parsedJson.type || "";
      moduleName = parsedJson.action || parsedJson.name || "";
      message = summarizeJsonLog(parsedJson);
    } else {
      const parts = bracketParts(timestamped[2]).slice(0, 6);
      const detected = structuredLevel(parts);
      level = detected.level;
      rawLevel = detected.rawLevel;
      levelSource = rawLevel ? "日志头" : "未标记";
      scope = parts.find((part) => !normalizeLevel(part) && !part.includes(":") && !part.includes(".py") && !part.includes(".js")) || "";
      moduleName = parts.find((part) => part.includes(":") || part.includes(".py") || part.includes(".js")) || "";
      message = raw.replace(/^\[[^\]]+\]\s*/, "");
    }
  } else {
    parsedJson = tryParseJsonLog(raw);
    if (parsedJson) {
      const detected = normalizeLevel(parsedJson.level);
      level = detected || "other";
      rawLevel = parsedJson.level || "";
      levelSource = rawLevel ? "JSON level" : "未标记";
      scope = parsedJson.type || "";
      moduleName = parsedJson.action || parsedJson.name || "";
      message = summarizeJsonLog(parsedJson);
    } else {
      const parts = bracketParts(raw).slice(0, 6);
      const detected = structuredLevel(parts);
      level = detected.level;
      rawLevel = detected.rawLevel;
      levelSource = rawLevel ? "日志头" : "未标记";
      scope = parts.find((part) => !normalizeLevel(part) && !part.includes(":") && !part.includes(".py") && !part.includes(".js")) || "";
      moduleName = parts.find((part) => part.includes(":") || part.includes(".py") || part.includes(".js")) || "";
    }
    message = raw.replace(/^\[[^\]]+\]\s*/, "");
  }

  const trace = buildTraceInfo(parsedJson);
  const timestamp = parseTimestamp(timeText || raw) || trace?.time || null;
  const summary = parsedJson ? message : summarizePlainLog(message, raw);
  return {
    id: `${file.source}:${file.path}:${lineNumber}`,
    raw,
    source: file.source,
    sourceName: file.sourceName,
    path: file.path || "",
    fileName: file.path ? file.path.split("/").pop() : "--",
    fileMtime: file.mtime || 0,
    lineIndex,
    lineNumber,
    globalIndex,
    timestamp,
    scope,
    rawLevel,
    level,
    levelSource,
    moduleName,
    message: message || raw,
    summary: summary || message || raw,
    trace,
  };
}

function fileCacheKey(file) {
  return `${file.source || ""}:${file.path || ""}`;
}

function buildFileLogEntries(file) {
  if (!file.readable || !Array.isArray(file.lines)) return [];
  const key = fileCacheKey(file);
  const cached = state.logCache.fileEntries.get(key);
  const cachedByLine = new Map((cached?.entries || []).map((entry) => [entry.lineNumber, entry]));
  const entries = [];
  file.lines.forEach((line, lineIndex) => {
    if (!String(line || "").trim()) return;
    const lineNumber = Number(file.base_line || 0) + lineIndex + 1;
    const cachedEntry = cachedByLine.get(lineNumber);
    if (cachedEntry && cachedEntry.raw === String(line || "")) {
      entries.push({ ...cachedEntry, fileMtime: file.mtime || 0, lineIndex });
      return;
    }
    entries.push(parseLogLine(line, file, lineIndex, 0));
  });
  state.logCache.fileEntries.set(key, {
    baseLine: Number(file.base_line || 0),
    lineCount: Number(file.line_count || 0),
    entries,
  });
  return entries;
}

function pruneFileEntryCache(files) {
  const active = new Set(files.map((file) => fileCacheKey(file)));
  state.logCache.fileEntries.forEach((_, key) => {
    if (!active.has(key)) {
      state.logCache.fileEntries.delete(key);
    }
  });
}

function parseSSELogEntry(raw, index) {
  const message = String(raw.message || raw.msg || "");
  const time = raw.time ? Number(raw.time) * 1000 : Date.now();
  const level = normalizeLevel(raw.level || "") || "other";
  const moduleName = raw.name || raw.module || raw.logger || "";
  return {
    id: `sse:${index}:${time}`,
    raw: message,
    source: "sse",
    sourceName: "实时流",
    path: "sse",
    fileName: "实时日志流",
    fileMtime: time / 1000,
    lineIndex: index,
    lineNumber: index + 1,
    globalIndex: 0,
    timestamp: time,
    scope: raw.type || "",
    rawLevel: raw.level || "",
    level,
    levelSource: "SSE",
    moduleName,
    message: message,
    summary: compactText(message, 520),
    trace: null,
  };
}

function buildLogEntries(files) {
  pruneFileEntryCache(files);
  const entries = [];
  files.forEach((file) => {
    buildFileLogEntries(file).forEach((entry) => entries.push(entry));
  });
  const sseEntries = (state.logCache.sseEntries || []).map((raw, idx) => parseSSELogEntry(raw, idx));
  entries.push(...sseEntries);
  entries.forEach((entry, index) => {
    entry.globalIndex = index;
  });
  return entries;
}

function recentAnalysisEntries(entries) {
  if (entries.length <= TRACE_ANALYSIS_ENTRY_LIMIT) return entries;
  return entries
    .slice()
    .sort((a, b) => {
      const aTime = a.timestamp || a.fileMtime || 0;
      const bTime = b.timestamp || b.fileMtime || 0;
      return bTime - aTime || b.globalIndex - a.globalIndex;
    })
    .slice(0, TRACE_ANALYSIS_ENTRY_LIMIT);
}

function logFilesSignature(files) {
  return files.map((file) => {
    const lines = Array.isArray(file.lines) ? file.lines : [];
    const first = lines[0] || "";
    const last = lines[lines.length - 1] || "";
    return [
      file.path || "",
      file.readable ? 1 : 0,
      file.mtime || 0,
      file.size || 0,
      file.base_line || 0,
      file.line_count ?? lines.length,
      lines.length,
      stableKeyText(first, 96),
      stableKeyText(last, 160),
    ].join("~");
  }).join("|");
}

function getLogAnalysis(files) {
  const signature = logFilesSignature(files);
  if (state.logCache.signature === signature && state.logCache.insights) {
    return {
      entries: state.logCache.entries,
      insights: state.logCache.insights,
      changed: false,
    };
  }
  const entries = buildLogEntries(files);
  const insights = buildTraceInsights(recentAnalysisEntries(entries));
  state.logCache = { ...state.logCache, signature, entries, insights };
  return { entries, insights, changed: true };
}

function filterLogEntries(entries) {
  const textFilter = getLogSearchText();
  const now = Date.now();
  const timeFilters = {
    "1h": 60 * 60 * 1000,
    "6h": 6 * 60 * 60 * 1000,
    "24h": 24 * 60 * 60 * 1000,
  };
  const timeLimit = timeFilters[state.logTimeFilter];

  return entries.filter((entry) => {
    if (state.logLevel !== "all" && entry.level !== state.logLevel) return false;
    if (timeLimit) {
      const entryTime = entry.timestamp || entry.fileMtime || 0;
      if (entryTime && now - entryTime > timeLimit) return false;
    }
    if (!textFilter) return true;
    const haystack = state.privacyMode
      ? `${entry.path} ${entry.sourceName} ${entry.moduleName} ${entry.scope} ${entry.level}`.toLowerCase()
      : `${entry.raw} ${entry.summary} ${entry.path} ${entry.sourceName} ${entry.moduleName} ${entry.scope}`.toLowerCase();
    return haystack.includes(textFilter);
  });
}

function countBy(entries, keyFn) {
  const out = {};
  entries.forEach((entry) => {
    const key = keyFn(entry);
    out[key] = (out[key] || 0) + 1;
  });
  return out;
}

function normalizeModuleToken(value) {
  const text = String(value || "")
    .replace(/^\[|\]$/g, "")
    .replace(/^['"]|['"]$/g, "")
    .trim();
  if (!text) return "";
  return text
    .replace(/\\/g, "/")
    .split("/")
    .pop()
    .replace(/:\d+(?::\d+)?$/g, "")
    .replace(/\.(?:py|js|ts|tsx|jsx)$/i, "")
    .replace(/^astrbot\.(?=(core|method|sources|pipeline|platform|provider)\.)/i, "")
    .trim();
}

function humanizeModuleWord(value) {
  const text = String(value || "").trim();
  if (!text) return "未识别";
  if (/^openai$/i.test(text)) return "OpenAI";
  if (/^aiocqhttp$/i.test(text)) return "aiocqhttp";
  return text.replace(/_/g, " ");
}

function compactPluginName(value) {
  const raw = String(value || "");
  const token = normalizeModuleToken(raw).replace(/^plugin\s*->\s*/i, "");
  if (!token) return "";
  let match = token.match(/^astrbot_plugin_([^.]+)(?:\.|$)/i);
  if (match) return match[1];
  match = raw.match(/(?:插件|plugin)[：:]\s*([A-Za-z0-9_\-.]+)/i);
  if (match) {
    const name = match[1].replace(/^astrbot_plugin_/i, "").replace(/\.main$/i, "").trim();
    if (name) return name;
  }
  match = raw.match(/\[([^\]]*astrbot_plugin_[^\]]*)\]/i);
  if (match) {
    const name = match[1].replace(/^astrbot_plugin_/i, "").replace(/\.main$/i, "").trim();
    if (name) return name;
  }
  return token.replace(/^astrbot_plugin_/i, "").replace(/\.main$/i, "").replace(/^plugins\//i, "");
}

function moduleGroup(key, label, className, raw) {
  return { key, label, className, raw: raw || "" };
}

function pluginModuleGroup(value, raw) {
  const name = compactPluginName(value);
  if (!name) return null;
  if (/^astrbot$/i.test(name)) {
    return moduleGroup("core:astrbot", "AstrBot 核心", "module-core", raw || value);
  }
  return moduleGroup(`plugin:${name}`, `插件: ${name}`, "module-plugin", raw || value);
}

function pluginGroupFromMessage(message) {
  const text = String(message || "");
  const match = text.match(/\b(?:plugin|hook\([^)]*\))\s*->\s*([A-Za-z0-9_.-]+)(?:\s*-\s*([A-Za-z0-9_.:-]+))?/i);
  if (match) return pluginModuleGroup(match[1], match[0]);
  const zhMatch = text.match(/(?:插件|plugin)[：:]\s*([A-Za-z0-9_\-.]+)/i);
  if (zhMatch) return pluginModuleGroup(zhMatch[1], zhMatch[0]);
  const bracketMatch = text.match(/\[([^\]]*astrbot_plugin_[^\]]*)\]/i);
  if (bracketMatch) return pluginModuleGroup(bracketMatch[1], bracketMatch[0]);
  return null;
}

function traceModuleGroup(entry, token) {
  const scope = normalizeModuleToken(entry.scope).toLowerCase();
  const fileName = String(entry.fileName || "").toLowerCase();
  if (scope !== "trace" && !fileName.includes("trace")) return null;
  const action = token && token.toLowerCase() !== "trace" ? token : "trace";
  const label = TRACE_ACTION_LABELS[action] || `Trace: ${humanizeModuleWord(action)}`;
  return moduleGroup(`trace:${action}`, label, "module-trace", entry.moduleName || entry.fileName);
}

function isAngelHeartEntry(token, message) {
  return /^roles\./i.test(token)
    || /^core\.(angel_heart|conversation_ledger)/i.test(token)
    || /^astrbot_plugin_angel_heart(?:\.|$)/i.test(token)
    || String(message || "").includes("AngelHeart[");
}

// ============================================================================
// 模块分组缓存 (LRU) - 性能优化
// ============================================================================

const moduleGroupCache = new Map();
const MODULE_GROUP_CACHE_SIZE = 1000;

function cachedNormalizeModuleGroup(entry) {
  // 生成缓存键
  const key = `${entry.moduleName || ''}|${entry.scope || ''}|${(entry.message || '').slice(0, 50)}`;

  // 检查缓存
  if (moduleGroupCache.has(key)) {
    return moduleGroupCache.get(key);
  }

  // 计算结果
  const group = normalizeModuleGroup(entry);

  // 存入缓存，实现 LRU 淘汰
  moduleGroupCache.set(key, group);
  if (moduleGroupCache.size > MODULE_GROUP_CACHE_SIZE) {
    const firstKey = moduleGroupCache.keys().next().value;
    moduleGroupCache.delete(firstKey);
  }

  return group;
}

// ============================================================================
// 模块分组逻辑
// ============================================================================

function normalizeModuleGroup(entry) {
  const message = `${entry.message || ""} ${entry.summary || ""} ${entry.raw || ""}`;
  const fromMessage = pluginGroupFromMessage(message);
  if (fromMessage) return fromMessage;

  if (!entry.moduleName && !entry.scope && !entry.rawLevel) {
    const fileName = String(entry.fileName || "");
    if (fileName.toLowerCase().includes("trace")) {
      return moduleGroup("trace:continuation", "Trace: 续行", "module-trace", fileName);
    }
    return moduleGroup("module:continuation", "日志续行/未标记", "module-other", fileName);
  }

  const rawToken = entry.moduleName || entry.scope || entry.fileName || "";
  const token = normalizeModuleToken(rawToken);
  const lower = token.toLowerCase();

  const traceGroup = traceModuleGroup(entry, token);
  if (traceGroup) return traceGroup;

  if (isAngelHeartEntry(token, message)) {
    return moduleGroup("plugin:angel_heart", "插件: angel_heart", "module-plugin", rawToken);
  }

  if (/^astrbot_plugin_/i.test(token)) {
    return pluginModuleGroup(token, rawToken) || moduleGroup(`plugin:${token}`, `插件: ${token}`, "module-plugin", rawToken);
  }

  if (String(entry.scope || "").toLowerCase() === "plug" && PLUG_MODULE_LABELS[lower]) {
    return moduleGroup(`plug:${lower}`, PLUG_MODULE_LABELS[lower], "module-plugin", rawToken);
  }

  if (lower.includes("aiocqhttp") || message.includes("RawMessage <Event")) {
    return moduleGroup("platform:aiocqhttp", "平台: aiocqhttp", "module-platform", rawToken);
  }

  if (lower.startsWith("sources.")) {
    const sourceName = lower.slice("sources.".length).split(".")[0].replace(/_source$/i, "");
    return moduleGroup(`model:${sourceName}`, `模型请求: ${humanizeModuleWord(sourceName)}`, "module-model", rawToken);
  }

  if (lower.includes("openai_source")) {
    return moduleGroup("model:openai", "模型请求: OpenAI", "module-model", rawToken);
  }

  if (lower.startsWith("core.")) {
    const label = CORE_MODULE_LABELS[lower] || `核心: ${humanizeModuleWord(lower.slice("core.".length))}`;
    return moduleGroup(`core:${lower}`, label, "module-core", rawToken);
  }

  if (lower.startsWith("star.")) {
    const label = CORE_MODULE_LABELS[lower] || `核心: ${humanizeModuleWord(lower.slice("star.".length))}`;
    return moduleGroup(`core:${lower}`, label, "module-core", rawToken);
  }

  if (lower.startsWith("method.")) {
    const label = METHOD_MODULE_LABELS[lower] || `方法: ${humanizeModuleWord(lower.slice("method.".length))}`;
    return moduleGroup(`method:${lower}`, label, "module-core", rawToken);
  }

  if (/adapter|platform/i.test(token)) {
    return moduleGroup(`platform:${lower || "unknown"}`, `平台: ${humanizeModuleWord(token)}`, "module-platform", rawToken);
  }

  if (/^core$/i.test(token)) {
    return moduleGroup("core:astrbot", "AstrBot 核心", "module-core", rawToken);
  }

  if (/^plug$/i.test(token)) {
    return moduleGroup("plugin:unknown", "插件: 未识别", "module-plugin", rawToken);
  }

  const fallback = token || entry.fileName || "未识别";
  return moduleGroup(`module:${fallback.toLowerCase()}`, fallback, "module-other", rawToken);
}

function aggregateModuleGroups(entries) {
  const groups = new Map();
  entries.forEach((entry) => {
    if (!entry.moduleName && !entry.scope && !entry.rawLevel) return;
    const group = cachedNormalizeModuleGroup(entry);
    const current = groups.get(group.key) || {
      key: group.key,
      label: group.label,
      className: group.className,
      value: 0,
      rawSamples: new Set(),
    };
    current.value += 1;
    if (group.raw) current.rawSamples.add(group.raw);
    groups.set(group.key, current);
  });

  return [...groups.values()]
    .map((item) => ({
      ...item,
      detail: [...item.rawSamples].slice(0, 4).join(" / "),
    }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label, "zh-CN"));
}

function eventTypeLabel(type) {
  return EVENT_TYPES[type]?.label || "事件";
}

function eventTypeBadge(type) {
  return EVENT_TYPES[type]?.badge || "";
}

function eventTypeClass(type) {
  return EVENT_TYPES[type]?.className || "";
}

function eventKey(spanId, type, entry, suffix = "") {
  return `${spanId || "no-span"}:${type}:${entry.globalIndex}:${suffix}`;
}

function evidenceFromEntry(entry, rule, parser = entry.trace ? "trace" : "plain", confidence = "high") {
  return {
    sourceName: entry.sourceName || "",
    path: entry.path || "",
    fileName: entry.fileName || "",
    lineNumber: entry.lineNumber || entry.lineIndex + 1,
    raw: entry.raw || "",
    rule,
    parser,
    confidence,
    spanId: entry.trace?.spanId || "",
    logEntryId: entry.id || "",
  };
}

function evidenceDetailKey(event) {
  return detailKey("event-evidence", event.id, event.evidence?.logEntryId);
}

function eventDurationLabel(ms) {
  if (ms == null || !Number.isFinite(Number(ms))) return "";
  return `耗时 ${(Number(ms) / 1000).toFixed(1)} 秒`;
}

function messageDedupeKey(sender, content) {
  const text = compactText(content || "", 160).toLowerCase();
  return `${String(sender || "").trim().toLowerCase()}|${text}`;
}

function sessionSourceLabel(session) {
  const umo = String(session?.umo || "");
  if (/Scheduler/i.test(session?.senderName || "") || /Scheduler/i.test(umo)) return "定时任务";
  if (/GroupMessage/i.test(umo)) return "群聊";
  if (/PrivateMessage|FriendMessage|DirectMessage/i.test(umo)) return "私聊";
  return "其他";
}

function tokenTotal(tokenUsage) {
  return Object.values(safeObject(tokenUsage)).reduce((sum, value) => {
    const number = Number(value);
    return Number.isFinite(number) ? sum + number : sum;
  }, 0);
}

function tokenValue(tokenUsage, keys) {
  const usage = safeObject(tokenUsage);
  return keys.reduce((sum, key) => {
    const number = Number(usage[key]);
    return Number.isFinite(number) ? sum + number : sum;
  }, 0);
}

function average(values) {
  const valid = values.map(Number).filter((value) => Number.isFinite(value));
  if (!valid.length) return 0;
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function addStat(map, key, detail = "") {
  const label = key || "未识别";
  const item = map.get(label) || { label, value: 0, detail };
  item.value += 1;
  if (detail && !item.detail) item.detail = detail;
  map.set(label, item);
}

function statMapItems(map, className = "module-trace") {
  return [...map.values()]
    .map((item) => ({ ...item, className, unit: "次" }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label, "zh-CN"));
}

function parseEventBusMessage(entry) {
  if (!/core\.event_bus/i.test(entry.moduleName || "")) return null;
  const text = String(entry.message || "");
  const match = text.match(/(?:\[[^\]]+\]\s*)+([^/\n:]+)\/([^:\n]+):\s*(.*)$/);
  if (!match) return null;
  return {
    sender: match[1].trim(),
    senderId: match[2].trim(),
    content: match[3].trim(),
  };
}

function isPluginHandlerLifecycleLog(entry, text) {
  return /star\.star_manager/i.test(entry.moduleName || "")
    && /(处理函数|handler|移除了|注册了|加载|卸载|enabled|disabled)/i.test(text);
}

function isPlainOutgoingMessageLog(entry) {
  if (entry.level === "debug") return false;
  const text = `${entry.moduleName || ""} ${entry.message || ""} ${entry.raw || ""}`;
  if (isPluginHandlerLifecycleLog(entry, text)) return false;
  return /\bsend_message\b|发送(?:群|私聊|好友|平台)?消息(?:成功|到|给)|发送回复(?:成功|到|给)/i.test(text);
}

const PLAIN_TOOL_CALL_PATTERNS = [
  /tool_call[:\s]*(.+?)(?:\s*[\(\.:]|\s*$)/i,
  /调用工具[：:\s]*([A-Za-z0-9_\-.]+)/i,
  /\[tool[:\s]+([A-Za-z0-9_\-.]+)\]/i,
  /tool_name[:\s]*['"]?([A-Za-z0-9_\-.]+)['"]?/i,
  /工具[：:\s]*([A-Za-z0-9_\-.]+?)(?:\s*(?:参数|args|\||$))/i,
];

const PLAIN_TOOL_RESULT_PATTERNS = [
  /tool_result[:\s]*(.+?)(?:\s*$)/i,
  /工具(?:返回|结果)[：:\s]*(.+?)(?:\s*$)/i,
  /\[tool_result\](.+?)(?:\s*$)/i,
];

function isPlainToolCallLog(entry) {
  const text = `${entry.message || ""} ${entry.summary || ""} ${entry.raw || ""}`;
  if (entry.trace) return null;
  for (const pattern of PLAIN_TOOL_CALL_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      return { type: "tool_call", name: match[1].trim() || "未知工具" };
    }
  }
  return null;
}

function isPlainToolResultLog(entry, toolName) {
  const text = `${entry.message || ""} ${entry.summary || ""} ${entry.raw || ""}`;
  if (entry.trace) return null;
  for (const pattern of PLAIN_TOOL_RESULT_PATTERNS) {
    if (pattern.test(text)) return { type: "tool_result", name: toolName || "未知工具" };
  }
  return null;
}

function plainLogEvent(entry) {
  if (entry.trace) return null;
  const eventBus = parseEventBusMessage(entry);
  if (eventBus) {
    return {
      id: `plain:${entry.id}`,
      timestamp: entry.timestamp || entry.fileMtime || 0,
      type: "message_in",
      title: eventBus.sender ? `收到 ${eventBus.sender} 的消息` : "收到平台消息",
      detail: compactText(eventBus.content || "空消息或平台通知", 180),
      meta: [entry.scope, entry.moduleName].filter(Boolean).join(" | "),
      raw: entry.raw,
      sensitive: true,
      sensitiveMeta: true,
      messageKey: messageDedupeKey(eventBus.sender, eventBus.content),
      evidence: evidenceFromEntry(entry, "core.event_bus", "plain", "high"),
    };
  }

  if (entry.level === "error") {
    return {
      id: `plain:${entry.id}`,
      timestamp: entry.timestamp || entry.fileMtime || 0,
      type: "error",
      title: "日志错误",
      detail: compactText(entry.summary || entry.message || entry.raw, 240),
      meta: [entry.scope, entry.moduleName].filter(Boolean).join(" | "),
      raw: entry.raw,
      sensitive: true,
      evidence: evidenceFromEntry(entry, "level:error", "plain", "high"),
    };
  }

  if (entry.level === "warn") {
    return {
      id: `plain:${entry.id}`,
      timestamp: entry.timestamp || entry.fileMtime || 0,
      type: "warn",
      title: "日志警告",
      detail: compactText(entry.summary || entry.message || entry.raw, 220),
      meta: [entry.scope, entry.moduleName].filter(Boolean).join(" | "),
      raw: entry.raw,
      sensitive: true,
      evidence: evidenceFromEntry(entry, "level:warn", "plain", "high"),
    };
  }

  if (isPlainOutgoingMessageLog(entry)) {
    return {
      id: `plain:${entry.id}`,
      timestamp: entry.timestamp || entry.fileMtime || 0,
      type: "message_out",
      title: "发送 API 日志",
      detail: compactText(entry.summary || entry.message || entry.raw, 220),
      meta: [entry.scope, entry.moduleName].filter(Boolean).join(" | "),
      raw: entry.raw,
      sensitive: true,
      evidence: evidenceFromEntry(entry, "plain:send_message", "plain", "high"),
    };
  }

  const toolCall = isPlainToolCallLog(entry);
  if (toolCall) {
    return {
      id: `plain:${entry.id}`,
      timestamp: entry.timestamp || entry.fileMtime || 0,
      type: "tool_call",
      title: `工具调用 ${toolCall.name}`,
      detail: compactText(entry.summary || entry.message || entry.raw, 220),
      meta: [entry.scope, entry.moduleName, toolCall.name].filter(Boolean).join(" | "),
      raw: entry.raw,
      sensitive: true,
      toolName: toolCall.name,
      evidence: evidenceFromEntry(entry, "plain:tool_call", "plain", "high"),
    };
  }

  const toolResult = isPlainToolResultLog(entry);
  if (toolResult) {
    return {
      id: `plain:${entry.id}`,
      timestamp: entry.timestamp || entry.fileMtime || 0,
      type: "tool_result",
      title: `工具返回 ${toolResult.name}`,
      detail: compactText(entry.summary || entry.message || entry.raw, 220),
      meta: [entry.scope, entry.moduleName].filter(Boolean).join(" | "),
      raw: entry.raw,
      sensitive: true,
      toolName: toolResult.name,
      evidence: evidenceFromEntry(entry, "plain:tool_result", "plain", "medium"),
    };
  }

  return null;
}

function buildTraceInsights(entries) {
  const traceEntries = entries
    .filter((entry) => entry.trace)
    .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0) || a.globalIndex - b.globalIndex);
  const sessions = new Map();
  const events = [];
  const toolCalls = [];
  const newestTraceTs = Math.max(0, ...traceEntries.map((entry) => entry.timestamp || entry.trace?.time || 0));
  const now = Math.max(Date.now(), newestTraceTs);
  const slowToolMs = state.ui.slowToolMs || DEFAULT_SLOW_TOOL_MS;
  const slowSessionMs = state.ui.slowSessionMs || DEFAULT_SLOW_SESSION_MS;
  const runningTimeoutMs = state.ui.runningTimeoutMs || DEFAULT_RUNNING_TIMEOUT_MS;

  function pushEvent(event) {
    const normalized = {
      id: event.id || `${event.spanId || ""}:${event.type}:${event.timestamp || 0}:${events.length}`,
      timestamp: event.timestamp || 0,
      spanId: event.spanId || "",
      type: event.type,
      title: event.title || eventTypeLabel(event.type),
      detail: event.detail || "",
      meta: event.meta || "",
      durationMs: event.durationMs ?? null,
      raw: event.raw || "",
      sensitive: Boolean(event.sensitive),
      sensitiveMeta: Boolean(event.sensitiveMeta),
      messageKey: event.messageKey || "",
      evidence: event.evidence || null,
    };
    events.push(normalized);
    return normalized;
  }

  function ensureSession(entry) {
    const trace = entry.trace || {};
    const spanId = trace.spanId || entry.id;
    let session = sessions.get(spanId);
    if (!session) {
      session = {
        spanId,
        startTs: entry.timestamp || trace.time || 0,
        lastTs: entry.timestamp || trace.time || 0,
        senderName: trace.senderName || "",
        umo: trace.umo || "",
        messageOutline: trace.messageOutline || "",
        personaId: "",
        status: "running",
        response: "",
        durationMs: null,
        timeToFirstTokenMs: null,
        tokenUsage: {},
        providerId: "",
        model: "",
        tools: [],
        events: [],
      };
      sessions.set(spanId, session);
      const messageIn = pushEvent({
        id: eventKey(spanId, "message_in", entry),
        timestamp: entry.timestamp || trace.time || 0,
        spanId,
        type: "message_in",
        title: trace.senderName ? `收到 ${trace.senderName} 的消息` : "收到消息",
        detail: compactText(trace.messageOutline || "消息内容未记录", 180),
        meta: trace.umo || "",
        raw: entry.raw,
        sensitive: true,
        sensitiveMeta: true,
        messageKey: messageDedupeKey(trace.senderName, trace.messageOutline),
        evidence: evidenceFromEntry(entry, `trace:${trace.action || "message_in"}`, "trace", "high"),
      });
      session.events.push(messageIn.id);
    }
    session.lastTs = Math.max(session.lastTs || 0, entry.timestamp || trace.time || 0);
    if (trace.senderName) session.senderName = trace.senderName;
    if (trace.umo) session.umo = trace.umo;
    if (trace.messageOutline) session.messageOutline = trace.messageOutline;
    return session;
  }

  traceEntries.forEach((entry) => {
    const trace = entry.trace;
    const action = trace.action || "";
    const session = ensureSession(entry);
    const spanId = session.spanId;
    const ts = entry.timestamp || trace.time || 0;

    if (action === "sel_persona") {
      session.personaId = trace.personaId || "";
      pushEvent({
        id: eventKey(spanId, "persona", entry),
        timestamp: ts,
        spanId,
        type: "persona",
        title: "选择聊天规则",
        detail: trace.personaId || "未记录规则 ID",
        meta: trace.personaToolCount == null ? "" : `${trace.personaToolCount} 个可用工具`,
        raw: entry.raw,
        evidence: evidenceFromEntry(entry, "trace:sel_persona", "trace", "high"),
      });
      return;
    }

    if (action === "astr_agent_prepare") {
      session.status = "generating";
      session.providerId = trace.providerId || session.providerId;
      session.model = trace.model || session.model;
      pushEvent({
        id: eventKey(spanId, "model_start", entry),
        timestamp: ts,
        spanId,
        type: "model_start",
        title: "开始生成回复",
        detail: compactText(trace.messageOutline || session.messageOutline || "进入模型请求阶段", 180),
        meta: [trace.providerId, trace.model].filter(Boolean).join(" | "),
        raw: entry.raw,
        sensitive: true,
        evidence: evidenceFromEntry(entry, "trace:astr_agent_prepare", "trace", "high"),
      });
      return;
    }

    if (action === "agent_tool_call") {
      const call = {
        id: trace.toolCallId || eventKey(spanId, "tool_call", entry),
        spanId,
        name: trace.toolName || "未知工具",
        args: trace.toolArgs,
        startTs: trace.toolStartTs || ts,
        endTs: null,
        durationMs: null,
        result: "",
        status: "running",
        senderName: session.senderName,
        messageOutline: session.messageOutline,
      };
      toolCalls.push(call);
      session.tools.push(call);
      pushEvent({
        id: eventKey(spanId, "tool_call", entry, call.id),
        timestamp: ts,
        spanId,
        type: "tool_call",
        title: `调用工具 ${call.name}`,
        detail: compactJson(call.args, 220) || "无参数",
        meta: session.senderName || "",
        raw: entry.raw,
        sensitive: true,
        sensitiveMeta: true,
        evidence: evidenceFromEntry(entry, "trace:agent_tool_call", "trace", "high"),
      });
      return;
    }

    if (action === "agent_tool_result") {
      const callId = trace.toolCallId || "";
      const call = [...toolCalls].reverse().find((item) => item.id === callId && item.status === "running")
        || [...toolCalls].reverse().find((item) => item.spanId === spanId && item.status === "running");
      const endTs = trace.toolResultTs || ts;
      let name = "未知工具";
      let durationMs = null;
      if (call) {
        call.endTs = endTs;
        call.durationMs = call.startTs ? Math.max(0, endTs - call.startTs) : null;
        call.result = trace.toolResult || "";
        call.status = "done";
        name = call.name;
        durationMs = call.durationMs;
      }
      pushEvent({
        id: eventKey(spanId, "tool_result", entry, callId),
        timestamp: ts,
        spanId,
        type: durationMs != null && durationMs >= slowToolMs ? "slow" : "tool_result",
        title: durationMs != null && durationMs >= slowToolMs ? `工具较慢 ${name}` : `工具返回 ${name}`,
        detail: compactText(trace.toolResult || "工具已返回", 240),
        meta: eventDurationLabel(durationMs),
        durationMs,
        raw: entry.raw,
        sensitive: true,
        evidence: evidenceFromEntry(entry, "trace:agent_tool_result", "trace", "high"),
      });
      return;
    }

    if (action === "astr_agent_complete") {
      session.status = "complete";
      session.response = trace.response || "";
      session.durationMs = trace.durationMs;
      session.timeToFirstTokenMs = trace.timeToFirstTokenMs;
      session.tokenUsage = trace.tokenUsage || {};
      session.providerId = trace.providerId || session.providerId;
      session.model = trace.model || session.model;
      pushEvent({
        id: eventKey(spanId, "message_out", entry),
        timestamp: ts,
        spanId,
        type: "message_out",
        title: "发送回复",
        detail: compactText(trace.response || "回复内容未记录", 220),
        meta: trace.durationMs == null ? "" : `生成${eventDurationLabel(trace.durationMs)}`,
        durationMs: trace.durationMs,
        raw: entry.raw,
        sensitive: true,
        evidence: evidenceFromEntry(entry, "trace:astr_agent_complete", "trace", "high"),
      });
      if (trace.durationMs != null && trace.durationMs >= slowSessionMs) {
        pushEvent({
          id: eventKey(spanId, "slow", entry),
          timestamp: ts,
          spanId,
          type: "slow",
          title: "会话响应较慢",
          detail: compactText(session.messageOutline || "该会话耗时超过阈值", 180),
          meta: eventDurationLabel(trace.durationMs),
          durationMs: trace.durationMs,
          raw: entry.raw,
          sensitive: true,
          evidence: evidenceFromEntry(entry, "trace:slow_session", "trace", "high"),
        });
      }
      return;
    }

    if (action === "astr_agent_error" || entry.level === "error") {
      session.status = "error";
      pushEvent({
        id: eventKey(spanId, "error", entry),
        timestamp: ts,
        spanId,
        type: "error",
        title: "会话错误",
        detail: compactText(entry.summary || entry.raw, 240),
        meta: session.senderName || "",
        raw: entry.raw,
        sensitive: true,
        sensitiveMeta: true,
        evidence: evidenceFromEntry(entry, action === "astr_agent_error" ? "trace:astr_agent_error" : "trace:error_level", "trace", "high"),
      });
    }
  });

  const tracedMessageKeys = new Set(
    events
      .filter((event) => event.type === "message_in" && event.messageKey)
      .map((event) => event.messageKey),
  );

  entries
    .filter((entry) => !entry.trace)
    .forEach((entry) => {
      const event = plainLogEvent(entry);
      if (event?.type === "message_in" && event.messageKey && tracedMessageKeys.has(event.messageKey)) return;
      if (event) pushEvent(event);
    });

  const sessionsList = [...sessions.values()].sort((a, b) => (b.lastTs || 0) - (a.lastTs || 0));
  const runningSessions = sessionsList.filter((session) => {
    if (session.status === "complete" || session.status === "error") return false;
    return now - (session.lastTs || 0) <= runningTimeoutMs;
  });
  const runningTools = toolCalls.filter((call) => call.status === "running" && now - (call.startTs || 0) <= runningTimeoutMs);

  const toolStatsMap = new Map();
  toolCalls.forEach((call) => {
    const key = call.name || "未知工具";
    const current = toolStatsMap.get(key) || { label: key, value: 0, totalDuration: 0, maxDuration: 0, running: 0, completed: 0 };
    current.value += 1;
    if (call.status === "running") {
      current.running += 1;
    } else {
      current.completed += 1;
      current.totalDuration += call.durationMs || 0;
      current.maxDuration = Math.max(current.maxDuration, call.durationMs || 0);
    }
    toolStatsMap.set(key, current);
  });
  const toolStats = [...toolStatsMap.values()]
    .map((item) => ({
      ...item,
      avgDuration: item.completed ? item.totalDuration / item.completed : 0,
      className: item.running ? "module-trace" : "module-plugin",
      detail: `平均 ${(item.completed ? item.totalDuration / item.completed / 1000 : 0).toFixed(1)} 秒 / 最大 ${(item.maxDuration / 1000).toFixed(1)} 秒 / 运行中 ${item.running}`,
      unit: "次",
    }))
    .sort((a, b) => b.value - a.value || b.avgDuration - a.avgDuration);

  const sourceMap = new Map();
  const senderMap = new Map();
  const personaMap = new Map();
  sessionsList.forEach((session) => {
    addStat(sourceMap, sessionSourceLabel(session));
    addStat(senderMap, session.senderName || "未记录发送者");
    addStat(personaMap, session.personaId || "未记录规则");
  });

  const completedSessions = sessionsList.filter((session) => session.status === "complete");
  const durationSessions = completedSessions.filter((session) => Number.isFinite(Number(session.durationMs)));
  const durations = durationSessions.map((session) => Number(session.durationMs));
  const tokenTotals = completedSessions.map((session) => tokenTotal(session.tokenUsage));
  const inputTokens = completedSessions.map((session) => tokenValue(session.tokenUsage, ["input", "input_text", "input_other", "input_cached", "prompt_tokens"]));
  const outputTokens = completedSessions.map((session) => tokenValue(session.tokenUsage, ["output", "output_text", "completion_tokens"]));
  const ttftValues = completedSessions
    .map((session) => Number(session.timeToFirstTokenMs))
    .filter((value) => Number.isFinite(value) && value > 0);
  const latencyBuckets = [
    { label: "5 秒内", value: durations.filter((duration) => duration < 5000).length, className: "level-info", unit: "次" },
    { label: "5-15 秒", value: durations.filter((duration) => duration >= 5000 && duration < 15000).length, className: "module-trace", unit: "次" },
    { label: "15-30 秒", value: durations.filter((duration) => duration >= 15000 && duration < 30000).length, className: "level-warn", unit: "次" },
    { label: "30 秒以上", value: durations.filter((duration) => duration >= 30000).length, className: "level-error", unit: "次" },
  ].filter((item) => item.value > 0);
  const latencyStats = {
    completed: completedSessions.length,
    measured: durations.length,
    avgDurationMs: average(durations),
    maxDurationMs: durations.length ? Math.max(...durations) : 0,
    avgTimeToFirstTokenMs: average(ttftValues),
    totalTokens: tokenTotals.reduce((sum, value) => sum + value, 0),
    inputTokens: inputTokens.reduce((sum, value) => sum + value, 0),
    outputTokens: outputTokens.reduce((sum, value) => sum + value, 0),
    avgTokens: average(tokenTotals),
    slowThresholdMs: slowSessionMs,
  };

  const sortedEvents = events.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

  // --- 插件分布统计 ---
  const pluginMap = new Map();
  entries.forEach((entry) => {
    if (!entry.moduleName && !entry.scope && !entry.level) return;
    const group = cachedNormalizeModuleGroup(entry);
    if (!group || !group.key.startsWith("plugin:")) return;
    const pluginName = group.key.replace("plugin:", "");
    const current = pluginMap.get(pluginName) || { label: pluginName, value: 0, detail: "" };
    current.value += 1;
    pluginMap.set(pluginName, current);
  });
  const pluginStats = [...pluginMap.values()]
    .map((item) => ({ ...item, className: "module-plugin", unit: "条" }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label, "zh-CN"));

  // --- 工具调用详情统计（含 plain log 识别） ---
  const toolDetailMap = new Map();
  sortedEvents.filter((e) => e.type === "tool_call").forEach((event) => {
    const name = event.toolName || event.title.replace(/^工具调用\s*/, "").trim() || "未知工具";
    const current = toolDetailMap.get(name) || { label: name, value: 0, className: "level-warn", unit: "次", detail: "" };
    current.value += 1;
    toolDetailMap.set(name, current);
  });
  sortedEvents.filter((e) => e.type === "tool_result").forEach((event) => {
    const name = event.toolName || event.title.replace(/^工具返回\s*/, "").trim() || "未知工具";
    const current = toolDetailMap.get(name) || { label: name, value: 0, className: "level-info", unit: "次", detail: "" };
    current.value += 1;
    toolDetailMap.set(name, current);
  });
  const toolDetailStats = [...toolDetailMap.values()]
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label, "zh-CN"));

  return {
    sessions: sessionsList,
    runningSessions,
    toolCalls,
    runningTools,
    toolStats,
    events: sortedEvents,
    messageOutCount: sortedEvents.filter((event) => event.type === "message_out").length,
    messageInCount: sortedEvents.filter((event) => event.type === "message_in").length,
    slowCount: sortedEvents.filter((event) => event.type === "slow").length,
    errorCount: sortedEvents.filter((event) => event.type === "error").length,
    toolCallCount: sortedEvents.filter((event) => event.type === "tool_call" || event.type === "tool_result").length,
    sourceStats: statMapItems(sourceMap, "module-platform"),
    senderStats: statMapItems(senderMap, "module-plugin"),
    personaStats: statMapItems(personaMap, "module-trace"),
    pluginStats,
    toolDetailStats,
    latencyStats,
    latencyBuckets,
  };
}

function filterEvents(events) {
  return events.filter((event) => {
    if (state.eventType !== "all" && event.type !== state.eventType) return false;
    return true;
  });
}

function renderEventList(id, events, limit = 40) {
  const visible = events.slice(0, limit);
  const el = renderSignature(id, eventListSignature(visible, limit));
  if (!el) return;
  el.innerHTML = "";
  const allowChain = id === "importantEventList";
  if (allowChain) {
    const chainKeys = new Set(visible.filter((event) => event.spanId).map((event) => eventChainDetailKey(event)));
    const evidenceKeys = new Set(visible.filter((event) => event.evidence).map((event) => evidenceDetailKey(event)));
    pruneOpenDetails("event-chain:", chainKeys);
    pruneOpenDetails("event-evidence:", evidenceKeys);
  }
  if (!visible.length) {
    el.appendChild(emptyBlock("没有匹配的重要事件。"));
    return;
  }
  const fragment = document.createDocumentFragment();
  visible.forEach((event) => {
    const item = document.createElement("article");
    item.className = `event-item ${eventTypeClass(event.type)}`;
    if (allowChain) {
      item.classList.add("selectable");
      if (state.selectedEventId && event.id === state.selectedEventId) {
        item.classList.add("selected");
      }
      item.tabIndex = 0;
      item.addEventListener("click", () => selectImportantEvent(event.id));
      item.addEventListener("keydown", (evt) => {
        if (evt.key === "Enter" || evt.key === " ") {
          evt.preventDefault();
          selectImportantEvent(event.id);
        }
      });
    }
    const head = document.createElement("div");
    head.className = "event-head";
    const left = document.createElement("div");
    left.className = "event-title";
    const title = document.createElement("strong");
    title.textContent = event.title || eventTypeLabel(event.type);
    const meta = document.createElement("small");
    meta.textContent = [
      formatTime(event.timestamp),
      event.sensitiveMeta ? privacyText(event.meta) : event.meta,
    ].filter(Boolean).join(" | ");
    left.append(title, meta);
    head.append(left, badge(eventTypeLabel(event.type), eventTypeBadge(event.type)));
    const detail = document.createElement("p");
    detail.textContent = event.sensitive ? privacyText(event.detail) : (event.detail || "--");
    item.append(head, detail);
    if (allowChain) {
      const hint = document.createElement("small");
      hint.className = "event-select-hint";
      hint.textContent = "点击查看证据";
      item.appendChild(hint);
    }
    fragment.appendChild(item);
  });
  el.appendChild(fragment);
}

function currentImportantEvents() {
  const insights = state.traceInsights;
  if (!insights) return [];
  return filterEvents(insights.events.filter((event) => IMPORTANT_EVENT_TYPES.has(event.type)));
}

function selectedImportantEvent() {
  const events = currentImportantEvents();
  return events.find((event) => event.id === state.selectedEventId) || events[0] || null;
}

function selectImportantEvent(eventId) {
  state.selectedEventId = eventId || "";
  renderDetailPanel();
  renderLogs();
}

function renderDetailPanel() {
  const body = $("detailBody");
  if (!body) return;
  body.innerHTML = "";
  const title = $("detailTitle");
  const stamp = $("detailStamp");
  const event = selectedImportantEvent();
  if (!event) {
    if (title) title.textContent = state.activeTab === "logs" ? "事件详情" : "工作区详情";
    if (stamp) stamp.textContent = "--";
    const empty = document.createElement("div");
    empty.className = "detail-empty";
    const strong = document.createElement("strong");
    strong.textContent = "选择事件查看证据";
    const span = document.createElement("span");
    span.textContent = "点击重要信息后，这里会显示判定规则、来源行号、原始日志和会话链路。";
    empty.append(strong, span);
    body.appendChild(empty);
    return;
  }

  if (!state.selectedEventId) state.selectedEventId = event.id;
  if (title) title.textContent = event.title || eventTypeLabel(event.type);
  if (stamp) stamp.textContent = formatCompactLogTime({ timestamp: event.timestamp });

  const summary = document.createElement("section");
  summary.className = "detail-section";
  summary.append(
    detailRow("事件类型", eventTypeLabel(event.type)),
    detailRow("时间", formatTime(event.timestamp)),
    detailRow("摘要", event.sensitive ? privacyText(event.detail) : event.detail),
  );
  body.appendChild(summary);

  const evidence = event.evidence;
  if (evidence) {
    const evidenceSection = document.createElement("section");
    evidenceSection.className = "detail-section";
    const heading = document.createElement("h3");
    heading.textContent = "证据";
    evidenceSection.append(
      heading,
      detailRow("判定规则", evidence.rule),
      detailRow("解析来源", evidence.parser === "trace" ? "Trace 日志" : "普通日志"),
      detailRow("置信度", confidenceLabel(evidence.confidence)),
      detailRow("来源文件", evidence.fileName || evidence.path),
      detailRow("行号", evidence.lineNumber ? `第 ${evidence.lineNumber} 行` : "--"),
      detailRow("span_id", evidence.spanId || event.spanId || "--"),
    );
    const locate = document.createElement("button");
    locate.type = "button";
    locate.textContent = "定位原文";
    locate.addEventListener("click", () => focusLogEntry(evidence.logEntryId));
    evidenceSection.appendChild(locate);
    if (!state.privacyMode && evidence.raw) {
      const raw = document.createElement("pre");
      raw.className = "evidence-raw";
      raw.textContent = clippedText(evidence.raw, 2200).text;
      evidenceSection.appendChild(raw);
    }
    body.appendChild(evidenceSection);
  }

  const chain = renderDetailEventChain(event);
  if (chain) body.appendChild(chain);
}

function renderDetailEventChain(event) {
  if (!event.spanId || !state.traceInsights?.events) return null;
  const chainEvents = state.traceInsights.events
    .filter((item) => item.spanId === event.spanId)
    .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
  if (chainEvents.length <= 1) return null;
  const section = document.createElement("section");
  section.className = "detail-section";
  const heading = document.createElement("h3");
  heading.textContent = `会话链路 ${chainEvents.length} 步`;
  section.appendChild(heading);
  const list = document.createElement("div");
  list.className = "event-chain-list";
  chainEvents.forEach((item) => {
    const row = document.createElement("div");
    row.className = `event-chain-row ${eventTypeClass(item.type)}`;
    const left = document.createElement("span");
    left.textContent = `${formatCompactLogTime({ timestamp: item.timestamp })} | ${eventTypeLabel(item.type)}`;
    const right = document.createElement("strong");
    const duration = eventDurationLabel(item.durationMs);
    const detail = item.sensitive ? privacyText(item.detail) : item.detail;
    right.textContent = [item.title, duration, detail].filter(Boolean).join(" | ");
    row.append(left, right);
    list.appendChild(row);
  });
  section.appendChild(list);
  return section;
}

function renderWorkspaceChrome() {
  const titles = {
    overview: ["总览", "当前运行状态"],
    astrbot: ["AstrBot", "会话、模型与日志维度"],
    logs: ["日志分析", "重要信息、证据和原始日志"],
    system: ["系统", "主机、进程、磁盘与网络"],
  };
  const [title, meta] = titles[state.activeTab] || titles.overview;
  setText("workspaceTitle", title);
  setText("workspaceMeta", meta);
  setText("sidebarStatusText", `AstrBot 在线 · ${formatCompactLogTime({ timestamp: Date.now() })}`);
  if (state.activeTab !== "logs") {
    renderDetailPanel();
  }
}

function confidenceLabel(value) {
  if (value === "high") return "高";
  if (value === "medium") return "中";
  if (value === "low") return "低";
  return value || "--";
}

function renderEventChain(event) {
  if (!event.spanId || !state.traceInsights?.events) return null;
  const chainEvents = state.traceInsights.events
    .filter((item) => item.spanId === event.spanId)
    .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
  if (chainEvents.length <= 1) return null;
  const details = document.createElement("details");
  details.className = "event-chain";
  bindDetailsState(details, eventChainDetailKey(event));
  const summary = document.createElement("summary");
  summary.textContent = `查看会话链路 ${chainEvents.length} 步`;
  details.appendChild(summary);
  const list = document.createElement("div");
  list.className = "event-chain-list";
  chainEvents.forEach((item) => {
    const row = document.createElement("div");
    row.className = `event-chain-row ${eventTypeClass(item.type)}`;
    const left = document.createElement("span");
    left.textContent = `${formatCompactLogTime({ timestamp: item.timestamp })} | ${eventTypeLabel(item.type)}`;
    const right = document.createElement("strong");
    const duration = eventDurationLabel(item.durationMs);
    const detail = item.sensitive ? privacyText(item.detail) : item.detail;
    right.textContent = [item.title, duration, detail].filter(Boolean).join(" | ");
    row.append(left, right);
    list.appendChild(row);
  });
  details.appendChild(list);
  return details;
}

function renderOverviewTrace(insights) {
  if (!insights) return;
  setText("bigScreenStamp", formatTime(Date.now()));
  const latestOut = insights.events.find((event) => event.type === "message_out");
  const cardItems = [
    ["活动会话", insights.runningSessions.length, `近 ${insights.sessions.length} 条会话`, insights.runningSessions.length ? "warn" : "ok"],
    ["运行工具", insights.runningTools.length, `总调用 ${insights.toolCalls.length} 次`, insights.runningTools.length ? "warn" : "ok"],
    ["慢请求", insights.slowCount, `${state.ui.slowSessionMs / 1000} 秒会话阈值`, insights.slowCount ? "warn" : "ok"],
    ["错误事件", insights.errorCount, "trace 窗口内", insights.errorCount ? "bad" : "ok"],
    ["最近发送", insights.messageOutCount, latestOut ? formatTime(latestOut.timestamp) : "trace 窗口内", "ok"],
  ];
  const cards = renderSignature("bigScreenCards", ["big-screen", cardItems]);
  if (cards) {
    cards.innerHTML = "";
    const fragment = document.createDocumentFragment();
    cardItems.forEach(([title, value, meta, kind]) => {
      fragment.appendChild(functionCard(title, value, meta, kind));
    });
    cards.appendChild(fragment);
  }
  const important = insights.events.filter((event) => IMPORTANT_EVENT_TYPES.has(event.type));
  const tools = insights.runningTools.map((tool) => ({
    type: "tool_call",
    timestamp: tool.startTs,
    spanId: tool.spanId,
    title: `运行中 ${tool.name}`,
    detail: compactJson(tool.args, 180) || tool.messageOutline || "等待工具返回",
    meta: tool.senderName || "",
    sensitive: true,
    sensitiveMeta: true,
  })).concat(insights.events.filter((event) => event.type === "tool_call" || event.type === "tool_result" || event.type === "slow"));
  setText("overviewEventStamp", `${important.length} 条`);
  setText("overviewToolStamp", `${insights.runningTools.length} 个运行中`);
  renderEventList("overviewEventList", important, 5);
  renderEventList("overviewToolList", tools, 5);
}

function renderRuntimeStats(insights) {
  if (!insights) return;
  const sourceItems = (insights.sourceStats || []).slice(0, 10);
  setText("sessionSourceHint", sourceItems.length ? `${sourceItems.length} 类来源` : "0 类来源");
  renderBarChart("sessionSourceChart", sourceItems);

  const personaItems = (insights.personaStats || []).slice(0, 10);
  setText("personaChartHint", personaItems.length ? `${personaItems.length} 条规则` : "0 条规则");
  renderBarChart("personaChart", personaItems);

  const senderItems = state.privacyMode
    ? [{ label: "隐私模式", value: insights.sessions.length, className: "module-other", detail: "发送者聚合已隐藏", unit: "次" }]
    : (insights.senderStats || []).slice(0, 10);
  setText("senderChartHint", state.privacyMode ? "发送者已隐藏" : `${senderItems.length} 个发送者`);
  renderBarChart("senderChart", senderItems);
}

function renderLatencyChart(insights) {
  if (!insights) return;
  const latency = insights.latencyStats || {};
  const latencyItems = insights.latencyBuckets || [];
  const avgDuration = latency.measured ? `${(latency.avgDurationMs / 1000).toFixed(1)} 秒` : "--";
  const maxDuration = latency.measured ? `${(latency.maxDurationMs / 1000).toFixed(1)} 秒` : "--";
  const tokenHint = latency.completed ? `总 Token ${formatNumber(latency.totalTokens)} | 输出 ${formatNumber(latency.outputTokens)}` : "无完成会话";
  setText("latencyChartHint", `平均 ${avgDuration} | 最大 ${maxDuration} | ${tokenHint}`);
  renderBarChart("latencyChart", latencyItems);
}

function setAstrbotNotice(message) {
  const view = $("astrbot");
  if (!view) return;
  let notice = view.querySelector(".astrbot-notice");
  if (!message) {
    if (notice) notice.remove();
    return;
  }
  if (!notice) {
    notice = document.createElement("div");
    notice.className = "astrbot-notice";
    const subtabs = view.querySelector(".subtabs");
    if (subtabs) {
      subtabs.insertAdjacentElement("afterend", notice);
    } else {
      view.insertBefore(notice, view.firstChild);
    }
  }
  notice.textContent = message;
}

function renderAstrBotVisuals(insights, entries) {
  if (!insights) return;
  const hasTrace = (insights.sessions?.length || 0) > 0;
  setAstrbotNotice(
    hasTrace
      ? ""
      : "暂无 Trace 日志数据，无法生成会话、模型与工具洞察。请确认 AstrBot 已开启 trace 日志（data/logs/astrbot.trace.log）。「日志分析」子页仍可基于普通日志展示。",
  );
  if (state.astrbotSubTab === "model") {
    renderLatencyChart(insights);
    renderToolChart(insights);
    return;
  }
  if (state.astrbotSubTab === "logs") {
    renderEventChart(insights);
    renderSourceChart(entries || []);
    renderPluginChart(insights);
    renderToolCallChart(insights);
    return;
  }
  renderRuntimeStats(insights);
}

function renderEventChart(insights) {
  const counts = countBy(insights.events, (event) => event.type);
  const items = Object.entries(counts)
    .map(([type, value]) => ({
      label: eventTypeLabel(type),
      value,
      className: type === "error" ? "level-error" : (type === "slow" || type === "warn") ? "level-warn" : "module-trace",
      unit: "条",
    }))
    .sort((a, b) => b.value - a.value);
  const toolCalls = insights.toolCallCount || 0;
  setText("eventChartHint", `${items.length} 类事件 | 工具调用 ${toolCalls} 次`);
  renderBarChart("eventChart", items);
}

function renderToolChart(insights) {
  const items = insights.toolStats
    .slice()
    .sort((a, b) => b.avgDuration - a.avgDuration || b.maxDuration - a.maxDuration || b.value - a.value)
    .slice(0, 12)
    .map((item) => {
      const avgSeconds = item.completed ? item.avgDuration / 1000 : 0;
      return {
        label: item.label,
        value: Number(avgSeconds.toFixed(1)),
        scaleValue: item.completed ? item.avgDuration : (item.running ? 1000 : 0),
        displayValue: item.completed ? `${avgSeconds.toFixed(1)}s` : "运行中",
        className: item.running ? "module-trace" : "module-plugin",
        detail: `调用 ${item.value} 次 / 完成 ${item.completed} / ${item.detail}`,
        unit: "平均耗时",
      };
    });
  setText("toolChartHint", `${insights.toolStats.length} 个工具`);
  renderBarChart("toolChart", items);
}

function renderLogs() {
  const files = collectLogFiles();
  const analysis = getLogAnalysis(files);
  const entries = analysis.entries;
  const insights = analysis.insights;
  state.traceInsights = insights;

  if (state.activeTab === "overview") {
    renderOverviewTrace(insights);
    renderWorkspaceChrome();
    return;
  }

  if (state.activeTab === "astrbot") {
    renderAstrBotVisuals(insights, entries);
    renderWorkspaceChrome();
    return;
  }

  if (state.activeTab === "logs") {
    const filtered = filterLogEntries(entries);
    const importantEvents = insights.events.filter((event) => IMPORTANT_EVENT_TYPES.has(event.type));
    const events = filterEvents(importantEvents);
    if (state.selectedEventId && !events.some((event) => event.id === state.selectedEventId)) {
      state.selectedEventId = "";
    }
    if (!state.selectedEventId && events.length) {
      state.selectedEventId = events[0].id;
    }
    const importantLimit = state.ui.importantEventLimit || DEFAULT_IMPORTANT_EVENT_LIMIT;
    setText("importantEventStamp", `${Math.min(events.length, importantLimit)} / ${events.length} 条`);
    renderEventList("importantEventList", events, importantLimit);
    renderLogStream(filtered);
    renderWorkspaceChrome();
    renderDetailPanel();
  }
}

function renderSourceChart(entries) {
  const rows = aggregateModuleGroups(entries);
  const visible = rows.slice(0, MODULE_CHART_LIMIT);
  const rest = rows.slice(MODULE_CHART_LIMIT);
  const items = [...visible];
  if (rest.length) {
    const value = rest.reduce((sum, item) => sum + item.value, 0);
    items.push({
      key: "module:others",
      label: "其他模块",
      value,
      className: "module-other",
      detail: rest.slice(0, 8).map((item) => item.label).join(" / "),
    });
  }
  setText(
    "sourceChartHint",
    rows.length ? `前 ${Math.min(rows.length, MODULE_CHART_LIMIT)} 个 / 共 ${rows.length} 个模块` : "0 个模块",
  );
  renderBarChart("sourceChart", items);
}

function renderPluginChart(insights) {
  const items = (insights.pluginStats || []).slice(0, MODULE_CHART_LIMIT);
  setText("pluginChartHint", items.length ? `${items.length} 个插件` : "0 个插件");
  renderBarChart("pluginChart", items);
}

function renderToolCallChart(insights) {
  const items = (insights.toolDetailStats || []).slice(0, MODULE_CHART_LIMIT);
  setText("toolCallHint", items.length ? `共 ${items.reduce((s, i) => s + i.value, 0)} 次调用 / ${items.length} 个工具` : "0 次工具调用");
  renderBarChart("toolCallChart", items);
}

function renderBarChart(id, items) {
  const el = renderSignature(id, chartSignature(items));
  if (!el) return;
  el.innerHTML = "";
  if (!items.length) {
    el.appendChild(emptyBlock("没有可展示的数据。"));
    return;
  }
  const max = Math.max(1, ...items.map((item) => Number(item.scaleValue ?? item.value) || 0));
  const fragment = document.createDocumentFragment();
  items.forEach((item) => {
    const rowEl = document.createElement("div");
    rowEl.className = "bar-row";
    const metricValue = Number(item.scaleValue ?? item.value) || 0;
    const displayValue = item.displayValue == null ? item.value : item.displayValue;
    const unit = item.unit || "行";
    const detailLabel = item.detail_label || "来源";
    const title = item.detail ? `${item.label}: ${displayValue} ${unit}\n${detailLabel}: ${item.detail}` : `${item.label}: ${displayValue} ${unit}`;
    rowEl.title = title;
    const label = document.createElement("span");
    label.className = "bar-label";
    label.textContent = item.label;
    label.title = title;
    const track = document.createElement("div");
    track.className = "bar-track";
    const fill = document.createElement("div");
    fill.className = `bar-fill ${item.className || ""}`;
    fill.style.width = `${Math.round((metricValue / max) * 100)}%`;
    track.appendChild(fill);
    const value = document.createElement("strong");
    value.textContent = displayValue;
    rowEl.append(label, track, value);
    fragment.appendChild(rowEl);
  });
  el.appendChild(fragment);
}

function renderLogStream(entries) {
  const list = $("logList");
  if (!list) return;
  list.className = "log-list";
  if (!entries.length) {
    setText("logStreamMeta", "0 行");
    setText("logPageInfo", "--");
    const emptyList = renderSignature("logList", ["empty", state.logLevel, getLogSearchText(), state.privacyMode]);
    if (!emptyList) return;
    emptyList.innerHTML = "";
    list.appendChild(emptyBlock("没有匹配的日志行。"));
    return;
  }

  const newest = [...entries].reverse();
  const totalPages = Math.max(1, Math.ceil(newest.length / state.logPageSize));
  state.logPage = Math.min(Math.max(1, state.logPage), totalPages);
  const start = (state.logPage - 1) * state.logPageSize;
  const pageEntries = newest.slice(start, start + state.logPageSize);
  const activeDetailKeys = new Set(
    pageEntries
      .filter((entry) => !state.privacyMode && (entry.raw || "") !== (entry.summary || ""))
      .map((entry) => logEntryDetailKey(entry)),
  );
  pruneOpenDetails("log-entry:", activeDetailKeys);
  setText("logStreamMeta", `${entries.length} 行`);
  setText("logPageInfo", `第 ${state.logPage} / ${totalPages} 页`);
  const prev = $("logPrevPage");
  const next = $("logNextPage");
  if (prev) prev.disabled = state.logPage <= 1;
  if (next) next.disabled = state.logPage >= totalPages;

  const signature = [
    "log-stream",
    state.privacyMode,
    state.logLevel,
    getLogSearchText(),
    state.logPage,
    state.logPageSize,
    state.highlightLogEntryId,
    entries.length,
    pageEntries.map((entry) => [
      entry.id,
      entry.level,
      entry.timestamp,
      entry.fileMtime,
      stableKeyText(entry.summary, 180),
      String(entry.raw || "").length,
      stableKeyText(entry.raw, 160),
    ]),
  ];
  if (!renderSignature("logList", signature)) return;
  list.innerHTML = "";

  const fragment = document.createDocumentFragment();
  pageEntries.forEach((entry) => {
    const rowEl = document.createElement("article");
    rowEl.className = `log-entry level-${entry.level}`;
    if (state.highlightLogEntryId && entry.id === state.highlightLogEntryId) {
      rowEl.classList.add("highlight");
    }
    rowEl.dataset.logEntryId = entry.id;
    const module = cachedNormalizeModuleGroup(entry);
    const sourceText = [entry.sourceName, entry.scope, entry.moduleName].filter(Boolean).join(" | ");
    rowEl.title = sourceText || entry.path || "";
    const meta = document.createElement("div");
    meta.className = "log-entry-meta";
    meta.append(
      smallPill(LEVELS[entry.level].label, LEVELS[entry.level].badge),
      textSpan(formatCompactLogTime(entry), "log-time"),
      textSpan(entry.lineNumber ? `行 ${entry.lineNumber}` : "--", "log-line"),
      textSpan(module.label || entry.moduleName || "--", "log-module")
    );
    const summary = document.createElement("div");
    summary.className = "log-entry-summary";
    summary.textContent = state.privacyMode
      ? "隐私模式已隐藏原始日志内容"
      : compactText(entry.summary || entry.message || entry.raw, 260);
    rowEl.append(meta, summary);
    if (!state.privacyMode && (entry.raw || "") !== (entry.summary || "")) {
      const details = document.createElement("details");
      details.className = "log-entry-details";
      bindDetailsState(details, logEntryDetailKey(entry));
      const toggle = document.createElement("summary");
      toggle.textContent = "展开原文";
      const text = document.createElement("pre");
      text.className = "log-entry-text";
      const clipped = clippedText(entry.raw);
      text.textContent = clipped.text;
      details.append(toggle, text);
      rowEl.appendChild(details);
    }
    fragment.appendChild(rowEl);
  });
  list.appendChild(fragment);
  scrollHighlightedLogEntry();
}

function smallPill(text, kind) {
  const el = document.createElement("span");
  el.className = `mini-badge ${kind || ""}`;
  el.textContent = text;
  return el;
}

function syncLogLevelButtons() {
  document.querySelectorAll(".level-filter").forEach((button) => {
    button.classList.toggle("active", button.dataset.level === state.logLevel);
  });
}

function cssEscape(value) {
  if (window.CSS?.escape) return CSS.escape(value);
  return String(value || "").replace(/["\\]/g, "\\$&");
}

function scrollHighlightedLogEntry() {
  if (!state.highlightLogEntryId) return;
  const row = document.querySelector(`[data-log-entry-id="${cssEscape(state.highlightLogEntryId)}"]`);
  if (row) {
    row.scrollIntoView({ block: "center", behavior: "smooth" });
  }
}

function focusLogEntry(logEntryId) {
  if (!logEntryId || !state.logCache.entries?.length) return;
  state.activeTab = "logs";
  document.querySelectorAll(".tab").forEach((tab) => {
    const active = tab.dataset.tab === "logs";
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", active ? "true" : "false");
  });
  document.querySelectorAll(".view").forEach((view) => {
    const active = view.id === "logs";
    view.classList.toggle("active", active);
    view.hidden = !active;
  });

  const input = $("logFilter");
  if (input) input.value = "";
  state.logLevel = "all";
  syncLogLevelButtons();
  state.highlightLogEntryId = logEntryId;

  const entries = [...state.logCache.entries].reverse();
  const index = entries.findIndex((entry) => entry.id === logEntryId);
  if (index >= 0) {
    state.logPage = Math.floor(index / state.logPageSize) + 1;
  }
  renderLogs();
  window.setTimeout(scrollHighlightedLogEntry, 50);
}

function textSpan(text, className) {
  const el = document.createElement("span");
  el.className = className;
  el.textContent = text || "--";
  return el;
}

let refreshRetryCount = 0;
const MAX_REFRESH_RETRIES = 3;

async function refresh(activeOnly = false) {
  if (state.refreshing) {
    state.pendingRefresh = true;
    return;
  }
  state.refreshing = true;
  state.lastRefreshTime = Date.now();
  try {
    if (!state.config) {
      const cfg = await fetchJson("/api/config");
      state.config = cfg.data;
      applyPublicConfig(state.config);
      refreshRetryCount = 0;
    }

    const summary = await fetchJson("/api/summary");
    state.summary = summary.data;
    renderSummary();

    if (!activeOnly || state.activeTab === "system") {
      const system = await fetchJson("/api/system");
      state.system = system.data;
      renderSystem();
    }

    if (!activeOnly || ["overview", "astrbot", "logs"].includes(state.activeTab)) {
      const logs = await fetchJson(logsApiPath());
      mergeLogData(logs.data);
      renderLogs();
    }
    refreshRetryCount = 0;
  } catch (err) {
    refreshRetryCount++;
    const msg = err.message || String(err);
    if (refreshRetryCount <= MAX_REFRESH_RETRIES) {
      console.warn(`[ObserverPanel] 刷新失败 (${refreshRetryCount}/${MAX_REFRESH_RETRIES}): ${msg}`);
    } else {
      toast(`数据刷新失败: ${msg}`);
    }
  } finally {
    state.refreshing = false;
    if (state.pendingRefresh) {
      state.pendingRefresh = false;
      window.setTimeout(() => refresh(true), 0);
    }
  }
}

function selectTab(name) {
  state.activeTab = name;
  document.querySelectorAll(".tab").forEach((tab) => {
    const active = tab.dataset.tab === name;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", active ? "true" : "false");
  });
  document.querySelectorAll(".view").forEach((view) => {
    const active = view.id === name;
    view.classList.toggle("active", active);
    view.hidden = !active;
  });
  renderWorkspaceChrome();
  refresh(true);
}

function selectAstrBotTab(name) {
  state.astrbotSubTab = name || "sessions";
  const viewIds = {
    sessions: "astrbotSessions",
    model: "astrbotModel",
    logs: "astrbotLogs",
  };
  document.querySelectorAll(".subtab").forEach((tab) => {
    const active = tab.dataset.astrbotTab === state.astrbotSubTab;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", active ? "true" : "false");
  });
  Object.entries(viewIds).forEach(([key, id]) => {
    const view = $(id);
    if (!view) return;
    const active = key === state.astrbotSubTab;
    view.classList.toggle("active", active);
    view.hidden = !active;
  });
  renderAstrBot();
}

function selectLogLevel(level) {
  state.logLevel = level;
  state.logPage = 1;
  syncLogLevelButtons();
  renderLogs();
}

function selectEventType(type) {
  state.eventType = type;
  document.querySelectorAll(".event-filter").forEach((button) => {
    button.classList.toggle("active", button.dataset.event === type);
  });
  renderLogs();
}

function changeLogPage(delta) {
  state.logPage = Math.max(1, state.logPage + delta);
  renderLogs();
}

function schedule() {
  window.clearInterval(state.timer);
  if ($("autoRefresh").checked) {
    state.timer = window.setInterval(() => refresh(true), state.refreshMs);
  }
}

function debounce(fn, delay) {
  let timer = null;
  return function (...args) {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => fn.apply(this, args), delay);
  };
}

const debouncedLogFilter = debounce(() => {
  state.logPage = 1;
  renderLogs();
}, 200);

function queueLogFilterRender() {
  debouncedLogFilter();
}

function bind() {
  $("refreshBtn").addEventListener("click", () => refresh(true));
  $("autoRefresh").addEventListener("change", schedule);
  $("logFilter").addEventListener("input", queueLogFilterRender);
  $("logPrevPage").addEventListener("click", () => changeLogPage(-1));
  $("logNextPage").addEventListener("click", () => changeLogPage(1));

  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => selectTab(tab.dataset.tab));
  });
  document.querySelectorAll(".subtab").forEach((tab) => {
    tab.addEventListener("click", () => selectAstrBotTab(tab.dataset.astrbotTab));
  });
  document.querySelectorAll(".level-filter").forEach((button) => {
    button.addEventListener("click", () => selectLogLevel(button.dataset.level));
  });
  document.querySelectorAll(".event-filter").forEach((button) => {
    button.addEventListener("click", () => selectEventType(button.dataset.event));
  });
  document.querySelectorAll(".time-filter").forEach((button) => {
    button.addEventListener("click", () => selectTimeFilter(button.dataset.time));
  });

  // 键盘快捷键
  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey) {
      if (e.key === "r") {
        e.preventDefault();
        refresh(true);
      } else if (e.key >= "1" && e.key <= "4") {
        e.preventDefault();
        const tabs = ["overview", "astrbot", "logs", "system"];
        selectTab(tabs[parseInt(e.key) - 1]);
      } else if (e.key === "k") {
        e.preventDefault();
        $("logFilter")?.focus();
      }
    } else if (e.key === "/" && document.activeElement.tagName !== "INPUT") {
      e.preventDefault();
      $("logFilter")?.focus();
    }
  });
}

function selectTimeFilter(time) {
  state.logTimeFilter = time;
  state.logPage = 1;
  document.querySelectorAll(".time-filter").forEach((button) => {
    button.classList.toggle("active", button.dataset.time === time);
  });
  renderLogs();
}

// ============================================================================
// SSE 实时日志流
// ============================================================================

function updateSSEStatus(connected) {
  state.sseConnected = connected;
  const dot = document.querySelector(".status-dot");
  const text = $("sidebarStatusText");
  if (dot) {
    dot.style.background = connected ? "var(--accent-bright)" : "var(--warn-bright)";
    dot.style.boxShadow = connected
      ? "0 0 0 4px rgba(48, 164, 108, 0.14)"
      : "0 0 0 4px rgba(210, 153, 34, 0.14)";
  }
  if (text) {
    text.textContent = connected
      ? `实时日志 · ${formatCompactLogTime({ timestamp: Date.now() })}`
      : `AstrBot 在线 · ${formatCompactLogTime({ timestamp: Date.now() })}`;
  }
}

function handleSSELogEntry(data) {
  try {
    const entry = typeof data === "string" ? JSON.parse(data) : data;
    if (!entry || !entry.message) return;
    const sseMax = 200;

    // 实时日志流：追加新条目
    state.logCache.sseEntries.push(entry);
    if (state.logCache.sseEntries.length > sseMax) {
      state.logCache.sseEntries = state.logCache.sseEntries.slice(-sseMax);
    }

    if (state.activeTab === "logs" || state.activeTab === "overview") {
      state.logCache.signature = "";
      renderLogs();
    }
  } catch (err) {
    // ignore parse errors
  }
}

function disconnectSSE() {
  window.clearTimeout(state.sseReconnectTimer);
  if (state.sseEventSource) {
    state.sseEventSource.close();
    state.sseEventSource = null;
  }
  updateSSEStatus(false);
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && state.config?.log_stream_enabled) {
    if (!state.sseEventSource) {
      connectSSE();
    }
  } else if (document.visibilityState === "hidden") {
    disconnectSSE();
  }
});

function closeDetailPanel() {
  state.selectedEventId = "";
  renderDetailPanel();
  // 移动端关闭详情面板
  document.querySelector(".workspace-detail")?.classList.remove("open");
  document.body.classList.remove("detail-open");
}

bind();
selectAstrBotTab(state.astrbotSubTab);

// ============================================================================
// 渐进式日志加载：先读取历史文件，再切换到实时流
// ============================================================================

async function progressiveLogInit() {
  // 第一步：快速加载配置和基础信息（不包含日志）
  await refresh(false);

  // 第二步：如果启用了日志流，先加载历史日志文件
  if (state.config?.log_stream_enabled) {
    try {
      // 显示加载提示
      updateSSEStatus(false);
      const statusText = $("sidebarStatusText");
      if (statusText) {
        statusText.textContent = "正在加载历史日志...";
      }

      // 从文件 API 加载历史日志
      const logsPath = logsApiPath();
      const logsResponse = await fetchJson(logsPath);

      if (logsResponse.ok && logsResponse.data) {
        const logData = logsResponse.data;

        // 合并历史日志到状态
        if (logData.astrbot && Array.isArray(logData.astrbot)) {
          state.logs = state.logs || {};
          state.logs.astrbot = logData.astrbot;

          // 提取所有历史日志行作为 SSE 条目的基础
          const historicalEntries = [];
          logData.astrbot.forEach((file) => {
            if (file.lines && Array.isArray(file.lines)) {
              file.lines.forEach((line, idx) => {
                if (line) {
                  historicalEntries.push({
                    message: line,
                    timestamp: file.mtime || Date.now(),
                    level: "INFO",
                    path: file.path,
                    lineNumber: (file.base_line || 0) + idx + 1,
                  });
                }
              });
            }
          });

          // 限制历史条目数量，保留最近的 200 条
          if (historicalEntries.length > 200) {
            state.logCache.sseEntries = historicalEntries.slice(-200);
          } else {
            state.logCache.sseEntries = historicalEntries;
          }

          // 立即渲染历史日志
          if (state.activeTab === "logs" || state.activeTab === "overview") {
            state.logCache.signature = "";
            renderLogs();
          }

          if (statusText) {
            statusText.textContent = `已加载 ${historicalEntries.length} 条历史日志`;
          }
        }
      }
    } catch (err) {
      console.warn("[ObserverPanel] 加载历史日志失败:", err);
    }

    // 第三步：等待短暂延迟后连接实时日志流
    await new Promise(resolve => setTimeout(resolve, 500));

    // 连接 SSE 实时流
    connectSSE();

    // 第四步：再次刷新以获取最新的日志分析数据
    setTimeout(() => {
      refresh(false);
    }, 1000);
  }

  // 启动定时刷新
  schedule();
}

progressiveLogInit();

// ============================================================================
// Touch Event Handlers with Ripple Effect
// ============================================================================

function createRipple(event, element) {
  const ripple = document.createElement("span");
  ripple.className = "ripple";
  const rect = element.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  ripple.style.left = `${x}px`;
  ripple.style.top = `${y}px`;
  element.appendChild(ripple);
  window.setTimeout(() => ripple.remove(), 600);
}

function addTouchRipple(selector) {
  document.querySelectorAll(selector).forEach((element) => {
    element.style.position = element.style.position || "relative";
    element.style.overflow = "hidden";

    element.addEventListener("touchstart", (event) => {
      if (event.touches.length === 1) {
        const touch = event.touches[0];
        createRipple({ clientX: touch.clientX, clientY: touch.clientY }, element);
        element.classList.add("touch-active");
      }
    }, { passive: true });

    element.addEventListener("touchend", () => {
      window.setTimeout(() => element.classList.remove("touch-active"), 100);
    }, { passive: true });

    element.addEventListener("touchcancel", () => {
      element.classList.remove("touch-active");
    }, { passive: true });

    element.addEventListener("click", (event) => {
      if (!event.touches) {
        createRipple(event, element);
      }
    });
  });
}

// Apply touch ripple to interactive elements
addTouchRipple("button");
addTouchRipple(".tab");
addTouchRipple(".subtab");
addTouchRipple(".level-filter");
addTouchRipple(".event-filter");
addTouchRipple(".time-filter");
addTouchRipple(".event-item.selectable");

// ============================================================================
// Enhanced Keyboard Shortcuts
// ============================================================================

const keyboardShortcuts = {
  help: {
    key: "?",
    description: "显示快捷键帮助",
    handler: (e) => {
      e.preventDefault();
      showShortcutsHelp();
    },
  },
  refresh: {
    key: "r",
    description: "刷新数据",
    handler: (e) => {
      e.preventDefault();
      refresh(true);
    },
  },
  search: {
    key: "/",
    description: "搜索日志",
    handler: (e) => {
      e.preventDefault();
      const logFilter = $("logFilter");
      if (logFilter) {
        logFilter.focus();
        logFilter.select();
      }
    },
  },
  escape: {
    key: "Escape",
    description: "关闭详情面板或清除搜索",
    handler: (e) => {
      const logFilter = $("logFilter");
      if (document.activeElement === logFilter && logFilter.value) {
        e.preventDefault();
        logFilter.value = "";
        queueLogFilterRender();
      } else if (state.selectedEventId) {
        e.preventDefault();
        closeDetailPanel();
      }
    },
  },
  tab1: {
    key: "1",
    description: "切换到总览标签",
    handler: (e) => {
      if (e.target.tagName !== "INPUT" && e.target.tagName !== "TEXTAREA") {
        e.preventDefault();
        selectTab("overview");
      }
    },
  },
  tab2: {
    key: "2",
    description: "切换到 AstrBot 标签",
    handler: (e) => {
      if (e.target.tagName !== "INPUT" && e.target.tagName !== "TEXTAREA") {
        e.preventDefault();
        selectTab("astrbot");
      }
    },
  },
  tab3: {
    key: "3",
    description: "切换到日志分析标签",
    handler: (e) => {
      if (e.target.tagName !== "INPUT" && e.target.tagName !== "TEXTAREA") {
        e.preventDefault();
        selectTab("logs");
      }
    },
  },
  tab4: {
    key: "4",
    description: "切换到系统标签",
    handler: (e) => {
      if (e.target.tagName !== "INPUT" && e.target.tagName !== "TEXTAREA") {
        e.preventDefault();
        selectTab("system");
      }
    },
  },
};

document.addEventListener("keydown", (e) => {
  const shortcut = Object.values(keyboardShortcuts).find((s) => s.key === e.key);
  if (shortcut) {
    shortcut.handler(e);
  }
});

function showShortcutsHelpOverlay() {
  const overlay = document.createElement("div");
  overlay.className = "shortcuts-overlay";
  overlay.innerHTML = `
    <div class="shortcuts-dialog">
      <div class="shortcuts-header">
        <h2>键盘快捷键</h2>
        <button class="shortcuts-close" aria-label="关闭">×</button>
      </div>
      <div class="shortcuts-body">
        <dl class="shortcuts-list">
          ${Object.entries(keyboardShortcuts)
            .map(
              ([_, shortcut]) => `
            <dt><kbd>${SHORTCUT_KEY_LABELS[shortcut.key] || shortcut.key}</kbd></dt>
            <dd>${shortcut.description}</dd>
          `,
            )
            .join("")}
        </dl>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const closeBtn = overlay.querySelector(".shortcuts-close");
  const dialog = overlay.querySelector(".shortcuts-dialog");

  const closeOverlay = () => {
    overlay.classList.add("closing");
    window.setTimeout(() => overlay.remove(), 200);
  };

  closeBtn.addEventListener("click", closeOverlay);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeOverlay();
  });

  document.addEventListener("keydown", function escHandler(e) {
    if (e.key === "Escape") {
      closeOverlay();
      document.removeEventListener("keydown", escHandler);
    }
  });

  window.setTimeout(() => overlay.classList.add("visible"), 10);
}

// 显示快捷键帮助浮层
function showShortcutsHelp() {
  showShortcutsHelpOverlay();
}

// ============================================================================
// Loading States and Skeleton Screens
// ============================================================================

function addLoadingState(element, type = "default") {
  if (!element) return;
  element.classList.add("loading");
  element.setAttribute("aria-busy", "true");

  if (type === "skeleton") {
    const skeleton = document.createElement("div");
    skeleton.className = "skeleton-loader";
    skeleton.innerHTML = `
      <div class="skeleton-line"></div>
      <div class="skeleton-line"></div>
      <div class="skeleton-line short"></div>
    `;
    element.dataset.originalContent = element.innerHTML;
    element.innerHTML = "";
    element.appendChild(skeleton);
  }
}

function removeLoadingState(element) {
  if (!element) return;
  element.classList.remove("loading");
  element.removeAttribute("aria-busy");

  if (element.dataset.originalContent) {
    element.innerHTML = element.dataset.originalContent;
    delete element.dataset.originalContent;
  }
}

// Add skeleton screens to initial render
document.addEventListener("DOMContentLoaded", () => {
  const mainViews = ["resourceOverview", "runtimeList", "systemInfo", "processInfo"];
  mainViews.forEach((id) => {
    const element = $(id);
    if (element) {
      addLoadingState(element, "skeleton");
    }
  });
});

// ============================================================================
// SSE Reconnection with Exponential Backoff (Enhanced)
// ============================================================================

// Initialize SSE reconnection state
state.sseReconnectAttempts = 0;
state.sseBackoffMs = 1000;
const SSE_MIN_BACKOFF = 1000;
const SSE_MAX_BACKOFF = 30000;
const SSE_BACKOFF_MULTIPLIER = 2;

function getSSEBackoff() {
  const attempts = state.sseReconnectAttempts || 0;
  const backoff = Math.min(SSE_MAX_BACKOFF, SSE_MIN_BACKOFF * Math.pow(SSE_BACKOFF_MULTIPLIER, attempts));
  return backoff;
}

function resetSSEBackoff() {
  state.sseReconnectAttempts = 0;
  state.sseBackoffMs = SSE_MIN_BACKOFF;
}

function incrementSSEBackoff() {
  state.sseReconnectAttempts = (state.sseReconnectAttempts || 0) + 1;
  state.sseBackoffMs = getSSEBackoff();
}

// SSE 连接：带指数退避自动重连
function connectSSE() {
  if (state.sseEventSource) {
    state.sseEventSource.close();
    state.sseEventSource = null;
  }

  if (!state.config?.log_stream_enabled) {
    resetSSEBackoff();
    return;
  }

  const url = `/api/logs/stream?history=20${token ? `&token=${encodeURIComponent(token)}` : ""}`;
  let source;

  try {
    source = new EventSource(url);
  } catch (err) {
    console.warn("[ObserverPanel] SSE connection failed:", err);
    scheduleSSEReconnect();
    return;
  }

  state.sseEventSource = source;

  source.onopen = () => {
    resetSSEBackoff();
    updateSSEStatus(true);
    console.log("[ObserverPanel] SSE connected");
  };

  source.onmessage = (event) => {
    if (event.data && event.data !== ": heartbeat") {
      handleSSELogEntry(event.data);
    }
  };

  source.onerror = (err) => {
    console.warn("[ObserverPanel] SSE error, reconnecting...", err);
    updateSSEStatus(false);
    source.close();
    state.sseEventSource = null;
    scheduleSSEReconnect();
  };
}

function scheduleSSEReconnect() {
  window.clearTimeout(state.sseReconnectTimer);

  const backoff = getSSEBackoff();
  incrementSSEBackoff();

  const attempts = state.sseReconnectAttempts || 0;
  console.log(
    `[ObserverPanel] SSE reconnecting in ${backoff}ms (attempt ${attempts})`,
  );

  state.sseReconnectTimer = window.setTimeout(() => {
    if (document.visibilityState !== "hidden" && state.config?.log_stream_enabled) {
      connectSSE();
    }
  }, backoff);
}
