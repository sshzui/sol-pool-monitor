const fetch = require('node-fetch');
const config = require('./config');

let q = [], s = false;
function enqueue(m) { q.push(m); processQueue(); }

async function processQueue() {
  if (s || q.length === 0) return;
  s = true;
  while (q.length > 0) {
    const msg = q.shift();
    try {
      const { TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID } = config;
      if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) continue;
      const resp = await fetch("https://api.telegram.org/bot" + TELEGRAM_BOT_TOKEN + "/sendMessage", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: msg, disable_web_page_preview: true }),
      });
      if (!resp.ok) console.error("[Telegram] HTTP", resp.status);
    } catch (err) { console.error("[Telegram]", err.message); }
    await new Promise(r => setTimeout(r, 50));
  }
  s = false;
}

function formatPoolMessage(pool) {
  const { dexName, poolAddress, mint, symbol, name, amount, quote, tokenAmount, price, totalSupply, marketCap, createTime } = pool;
  const displayName = name || mint.slice(0, 8) + "...";
  const displaySymbol = (symbol && !symbol.includes("...")) ? symbol : mint.slice(0, 8) + "...";

  var lines = [];
  lines.push("\uD83C\uDD95 \u53D1\u73B0\u65B0\u7684\u76F8\u5173 " + dexName + " \u6C60");
  lines.push("Quote: " + quote);
  lines.push("\u52A0\u6C60\u91D1\u989D\uFF1A" + (amount || "N/A") + " U");
  lines.push("\u4EE3\u5E01mint\uFF1A");
  lines.push(mint);
  lines.push("\u6C60\u5B50\u5730\u5740\uFF1A");
  lines.push(poolAddress);
  lines.push("\u4EE3\u5E01\u540D\u79F0\uFF1A" + displayName);
  lines.push("\u4EE3\u5E01\u7B26\u53F7\uFF1A" + displaySymbol);
  if (totalSupply) lines.push("\u603B\u4F9B\u5E94\u91CF\uFF1A" + totalSupply);
  if (marketCap) lines.push("\u521D\u59CB\u5E02\u503C\uFF1A" + marketCap + " " + quote);
  if (price) lines.push("\u4EF7\u683C\uFF1A1 " + displaySymbol + " = " + price + " " + quote);
  if (createTime) lines.push("\u521B\u5EFA\u65F6\u95F4\uFF1A" + createTime);
  return lines.join("\n");
}

module.exports = { enqueue, formatPoolMessage };
