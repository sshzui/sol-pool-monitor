const fetch = require('node-fetch');
const config = require('./config');

let queue = [];
let sending = false;

function enqueue(msg) {
  queue.push(msg);
  processQueue();
}

async function processQueue() {
  if (sending || queue.length === 0) return;
  sending = true;

  while (queue.length > 0) {
    const msg = queue.shift();
    try {
      const { TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID } = config;
      if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
        console.error('[Telegram] 未配置 Token 或 Chat ID');
        continue;
      }
      const resp = await fetch(
        `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: TELEGRAM_CHAT_ID,
            text: msg,
            disable_web_page_preview: true
          }),
          timeout: 10000
        }
      );
      if (!resp.ok) {
        const text = await resp.text();
        console.error(`[Telegram] HTTP ${resp.status}: ${text.slice(0, 100)}`);
      } else {
        console.log('[Telegram] 推送成功');
      }
    } catch (err) {
      console.error(`[Telegram] 推送失败: ${err.message}`);
    }
    await new Promise(r => setTimeout(r, 50));
  }

  sending = false;
}

function formatPoolMessage(pool) {
  const {
    baseName = '?', baseSymbol = '?',
    quoteSymbol = '?', mint = '',
    poolAddress = '', liquidityUSD = 0
  } = pool;

  const lines = [
    '🆕 发现新的相关 Raydium 池',
    `Quote: ${quoteSymbol}`,
    `加池金额：${Number(liquidityUSD).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} U`,
    '代币mint：',
    mint,
    '池子地址：',
    poolAddress,
    `代币名称：${baseName}`,
    `代币符号：${baseSymbol}`,
  ];

  return lines.join('\n');
}

module.exports = { enqueue, formatPoolMessage };
