require('dotenv').config();

const config = {
  // Telegram
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || '',
  TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID || '',

  // Helius
  HELIUS_API_KEY: process.env.HELIUS_API_KEY || '',
  get HELIUS_WS() {
    return `wss://mainnet.helius-rpc.com/?api-key=${this.HELIUS_API_KEY}`;
  },
  get HELIUS_RPC() {
    return `https://mainnet.helius-rpc.com/?api-key=${this.HELIUS_API_KEY}`;
  },

  // 监控的 Raydium 程序 ID
  MONITOR_PROGRAMS: [
    "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK",  // Raydium CLMM
    "CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qkpZ",  // Raydium CPMM
    "675kPX9MHTjS2Q1FfRW1Uq2wQ4vH8B1TqLQyMvq",     // Raydium AMM
  ],

  // 报价代币符号白名单
  QUOTE_TOKENS: new Set(["USDT", "USDC", "JUPUSD", "PYUSD"]),

  // 轮询间隔
  CHECK_INTERVAL_MS: 10000,
  POLL_INTERVAL_MS: 10000,

  // 去重
  SEEN_PAIRS_FILE: 'seen_pairs.json',

  // 调试
  DEBUG: process.env.DEBUG === 'true',
};

module.exports = config;
