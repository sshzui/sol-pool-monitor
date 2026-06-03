// ============================================================
// Solana Raydium 新池监听 v2.0
// Helius WebSocket 实时监听 + DexScreener 辅助轮询
// ============================================================

const config = require('./config');
const telegram = require('./telegram');
const storage = require('./storage');
const fetch = require('node-fetch');

let stats = {
  startedAt: null, wsPools: 0, pollPools: 0,
  wsErrors: 0, pollErrors: 0, wsConnected: false
};

async function checkRaydiumPool(mint) {
  try {
    const resp = await fetch(
      'https://api.dexscreener.com/latest/dex/search/?q=' + mint,
      { timeout: 10000 }
    );
    if (resp.status !== 200) return null;
    const data = await resp.json();
    for (const pair of (data.pairs || [])) {
      if (pair.dexId === 'raydium') {
        const quoteSym = (pair.quoteToken && pair.quoteToken.symbol || '').toUpperCase();
        if (config.QUOTE_TOKENS.has(quoteSym)) {
          return pair;
        }
      }
    }
  } catch (e) {
    if (config.DEBUG) console.error('[DexScreener] error: ' + e.message);
  }
  return null;
}

function sendPoolNotify(pair, mint) {
  const base = pair.baseToken || {};
  const quote = pair.quoteToken || {};
  const liquidity = pair.liquidity || {};
  const poolAddr = pair.pairAddress || '?';
  telegram.enqueue(telegram.formatPoolMessage({
    baseName: base.name || '?',
    baseSymbol: base.symbol || '?',
    quoteSymbol: quote.symbol || '?',
    mint: mint,
    poolAddress: poolAddr,
    liquidityUSD: liquidity.usd || 0
  }));
  console.log('[Push] Raydium pool: ' + (base.name || '?') + ' | ' + (quote.symbol || '?') + ' | ' + Number(liquidity.usd || 0).toFixed(2) + ' U');
}

async function pollDexScreener() {
  console.log('[DexScreener] polling started');
  while (true) {
    try {
      const resp = await fetch('https://api.dexscreener.com/token-profiles/latest/v1', { timeout: 15000 });
      if (resp.status !== 200) {
        console.error('[DexScreener] HTTP ' + resp.status);
        stats.pollErrors++;
        await sleep(config.CHECK_INTERVAL_MS);
        continue;
      }
      const items = await resp.json();
      let found = 0;
      for (const item of items) {
        if (!item || typeof item !== 'object') continue;
        if (item.chainId !== 'solana') continue;
        const mint = item.tokenAddress;
        if (!mint || storage.seenMints.has(mint)) continue;
        storage.seenMints.add(mint);
        const pair = await checkRaydiumPool(mint);
        if (!pair) continue;
        const baseAddr = pair.baseToken && pair.baseToken.address || '';
        const quoteAddr = pair.quoteToken && pair.quoteToken.address || '';
        if (baseAddr && quoteAddr) {
          const pairKey = storage.makePairKey(new Set([baseAddr, quoteAddr]));
          if (storage.hasSeen(pairKey)) continue;
          storage.saveSeenPair(pairKey);
        }
        const poolAddr = pair.pairAddress || '';
        if (poolAddr && storage.seenPools.has(poolAddr)) continue;
        if (poolAddr) storage.seenPools.add(poolAddr);
        sendPoolNotify(pair, mint);
        found++;
        stats.pollPools++;
      }
      if (found > 0) console.log('[DexScreener] found ' + found + ' new pools');
    } catch (e) {
      if (config.DEBUG) console.error('[DexScreener] error: ' + e.message);
      stats.pollErrors++;
    }
    await sleep(config.CHECK_INTERVAL_MS);
    storage.cleanup();
  }
}

const QUOTE_MINT_CACHE = new Map();

async function isQuoteMint(mint) {
  if (QUOTE_MINT_CACHE.has(mint)) return QUOTE_MINT_CACHE.get(mint);
  try {
    const resp = await fetch('https://api.dexscreener.com/latest/dex/search/?q=' + mint, { timeout: 5000 });
    if (resp.status === 200) {
      const data = await resp.json();
      for (const pair of (data.pairs || [])) {
        const qt = pair.quoteToken || {};
        if ((qt.address || '').toUpperCase() === mint.toUpperCase()) {
          const sym = (qt.symbol || '').toUpperCase();
          if (config.QUOTE_TOKENS.has(sym)) {
            QUOTE_MINT_CACHE.set(mint, true);
            return true;
          }
        }
      }
    }
  } catch (e) {}
  QUOTE_MINT_CACHE.set(mint, false);
  return false;
}

async function fetchTx(sig) {
  try {
    const resp = await fetch(config.HELIUS_RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1,
        method: 'getTransaction',
        params: [sig, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }]
      }),
      timeout: 10000
    });
    const data = await resp.json();
    return data.result;
  } catch (e) {
    if (config.DEBUG) console.error('[fetchTx] ' + sig.slice(0, 8) + ': ' + e.message);
    return null;
  }
}

async function processTx(sig) {
  if (storage.seenTxSigs.has(sig)) return;
  storage.seenTxSigs.add(sig);
  const tx = await fetchTx(sig);
  if (!tx) return;
  const meta = tx.meta || {};
  if (meta.err) return;
  const post = meta.postTokenBalances || [];
  const pre = meta.preTokenBalances || [];
  const preMints = new Set((pre || []).map(function(b) { return b.mint; }).filter(Boolean));
  const postMints = new Set((post || []).map(function(b) { return b.mint; }).filter(Boolean));
  if (postMints.size < 2) return;
  const pairKey = storage.makePairKey(postMints);
  if (storage.hasSeen(pairKey)) return;
  const quoteMints = new Set();
  const otherMints = new Set(postMints);
  for (const mint of postMints) {
    if (await isQuoteMint(mint)) {
      quoteMints.add(mint);
      otherMints.delete(mint);
    }
  }
  if (quoteMints.size === 0 || otherMints.size === 0) {
    storage.saveSeenPair(pairKey);
    return;
  }
  for (const newMint of otherMints) {
    if (storage.seenMints.has(newMint)) continue;
    storage.seenMints.add(newMint);
    const pair = await checkRaydiumPool(newMint);
    if (!pair) continue;
    const poolAddr = pair.pairAddress || '';
    if (poolAddr && storage.seenPools.has(poolAddr)) continue;
    if (poolAddr) storage.seenPools.add(poolAddr);
    sendPoolNotify(pair, newMint);
    storage.saveSeenPair(pairKey);
    stats.wsPools++;
  }
}

async function wsMonitor() {
  console.log('[WebSocket] connecting to Helius...');
  while (true) {
    try {
      const wsModule = await import('ws');
      const WebSocket = wsModule.default;
      const ws = new WebSocket(config.HELIUS_WS);
      await new Promise(function(resolve, reject) {
        const timeout = setTimeout(function() { reject(new Error('WebSocket timeout')); }, 15000);
        ws.on('open', function() {
          clearTimeout(timeout);
          console.log('[WebSocket] connected to Helius');
          stats.wsConnected = true;
          for (const pid of config.MONITOR_PROGRAMS) {
            ws.send(JSON.stringify({
              jsonrpc: '2.0',
              id: pid.slice(0, 8),
              method: 'logsSubscribe',
              params: [{ mentions: [pid] }, { commitment: 'finalized' }]
            }));
          }
          console.log('[WebSocket] subscribed ' + config.MONITOR_PROGRAMS.length + ' programs');
          resolve();
        });
        ws.on('message', async function(raw) {
          try {
            const data = JSON.parse(raw.toString());
            if (!data.params) return;
            const result = data.params.result || {};
            const value = result.value || {};
            const sig = value.signature || result.signature || '';
            if (sig && sig.length > 80) {
              processTx(sig).catch(function() {});
            }
          } catch (e) {
            if (config.DEBUG) console.error('[WS] parse error: ' + e.message);
          }
        });
        ws.on('error', function(err) {
          clearTimeout(timeout);
          reject(err);
        });
        ws.on('close', function() {
          console.log('[WebSocket] disconnected');
          stats.wsConnected = false;
          reject(new Error('WebSocket closed'));
        });
      });
      await new Promise(function(resolve) { ws.on('close', resolve); });
    } catch (e) {
      stats.wsErrors++;
      console.error('[WebSocket] error: ' + e.message + ', reconnect in 5s...');
      await sleep(5000);
    }
  }
}

function sleep(ms) {
  return new Promise(function(resolve) { setTimeout(resolve, ms); });
}

function start() {
  if (stats.startedAt) {
    console.log('[Monitor] already running');
    return;
  }
  stats.startedAt = new Date();
  if (!config.TELEGRAM_BOT_TOKEN || !config.TELEGRAM_CHAT_ID) {
    console.error('[Monitor] ERROR: Telegram not configured');
    console.error('[Monitor] Create .env with TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID');
  }
  if (!config.HELIUS_API_KEY) {
    console.error('[Monitor] WARNING: Helius API Key not configured');
    console.error('[Monitor] Set HELIUS_API_KEY (free: https://www.helius.dev/)');
  }
  console.log('=== Solana Raydium Monitor v2.0 ===');
  console.log('Helius: ' + (config.HELIUS_API_KEY ? 'OK' : 'MISSING'));
  console.log('Telegram: ' + (config.TELEGRAM_BOT_TOKEN ? 'OK' : 'MISSING'));
  console.log('Programs: ' + config.MONITOR_PROGRAMS.length);
  wsMonitor().catch(function(e) { console.error('[Monitor] WS error: ' + e.message); });
  pollDexScreener().catch(function(e) { console.error('[Monitor] Poll error: ' + e.message); });
  setInterval(function() {
    const uptime = Math.floor((Date.now() - stats.startedAt) / 1000);
    console.log('[Status] ' + uptime + 's | WS:' + (stats.wsConnected ? 'OK' : 'XX') + ' | WS found:' + stats.wsPools + ' | Poll found:' + stats.pollPools + ' | WS err:' + stats.wsErrors + ' | Poll err:' + stats.pollErrors);
  }, 60000);
}

module.exports = { start: start, stats: stats };
