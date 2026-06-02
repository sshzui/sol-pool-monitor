require('dotenv').config();

module.exports = {
  RPC_ENDPOINT: process.env.RPC_ENDPOINT || 'https://solana-rpc.publicnode.com',
  RPC_WEBSOCKET: process.env.RPC_WEBSOCKET || 'wss://solana-rpc.publicnode.com',
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || '',
  TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID || '',
  POLL_INTERVAL_MS: 10_000,
  MAX_SIGNATURES: 50,
  MAX_CACHED_POOLS: 100_000,
  DEBUG: process.env.DEBUG === 'true',
};
