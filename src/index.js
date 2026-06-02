require("dotenv").config();
const config = require("./config");
const monitor = require("./monitor");
const fetch = require("node-fetch");

console.log("=== Solana 新币监控 v8.7 ===");
console.log("RPC:", config.RPC_ENDPOINT);
console.log("DEX程序数:", require("./dexs").DEX_PROGRAMS.length);
console.log("轮询间隔:", config.POLL_INTERVAL_MS + "ms");
console.log("TOKEN:", !!(config.TELEGRAM_BOT_TOKEN), "长度:", (config.TELEGRAM_BOT_TOKEN || "").length);
console.log("CHAT:", !!(config.TELEGRAM_CHAT_ID), "值:", config.TELEGRAM_CHAT_ID);

async function sendStartupMsg() {
  if (!config.TELEGRAM_BOT_TOKEN || !config.TELEGRAM_CHAT_ID) return;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10000);
    const resp = await fetch("https://api.telegram.org/bot" + config.TELEGRAM_BOT_TOKEN + "/sendMessage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: config.TELEGRAM_CHAT_ID, text: "✅ Solana 新币监控 v8.7 启动成功\nDEX: " + require("./dexs").DEX_PROGRAMS.length + " 个 | 轮询: " + (config.POLL_INTERVAL_MS / 1000) + "s", disable_web_page_preview: true }),
      signal: ctrl.signal
    });
    clearTimeout(timer);
  } catch (e) { console.log("[启动] TG失败:", e.message); }
}

async function sendStatusReport() {
  const s = monitor.stats;
  if (!s.startedAt) return;
  const uptime = Math.floor((Date.now() - s.startedAt) / 1000);
  const hours = Math.floor(uptime / 3600);
  const mins = Math.floor((uptime % 3600) / 60);
  const msg = ["📊 状态报告","运行时间: "+hours+"h "+mins+"m","扫描次数: "+s.scans,"发现新币: "+s.pools,"错误次数: "+s.errors,"DEX数: "+require("./dexs").DEX_PROGRAMS.length].join("\n");
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10000);
    await fetch("https://api.telegram.org/bot" + config.TELEGRAM_BOT_TOKEN + "/sendMessage", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: config.TELEGRAM_CHAT_ID, text: msg, disable_web_page_preview: true }),
      signal: ctrl.signal
    });
    clearTimeout(timer);
  } catch (e) {}
}

sendStartupMsg().then(() => {
  monitor.start();
  setInterval(sendStatusReport, 30 * 60 * 1000);
  setInterval(() => {
    const s = monitor.stats;
    const uptime = s.startedAt ? Math.floor((Date.now() - s.startedAt) / 1000) : 0;
    console.log("[状态] " + uptime + "s | 扫描:" + s.scans + " | 新币:" + s.pools + " | 错误:" + s.errors);
  }, 60000);
});
