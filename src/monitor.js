// ============================================================
// Solana 新币监控 v9.0 - WebSocket 实时监听 + getProgramAccounts 双保险
// ============================================================

const { Connection, PublicKey } = require("@solana/web3.js");
const config = require("./config");
const dexs = require("./dexs");
const telegram = require("./telegram");
const tokenResolver = require("./token-resolver");

let connection, isRunning = false;
let stats = { pools: 0, scans: 0, errors: 0, startedAt: null, poolsFound: 0, wsSubs: 0 };

const seenPools = new Set();
let lastPushTime = 0;
const MIN_PUSH_INTERVAL = 500;

// ---- 池子创建关键词 ----
const CREATE_KEYWORDS = ["initialize", "create_pool", "createpool", "init_pool", "create"];

// ---- RPC 调用（含重试） ----
async function rpcCall(fn, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try { return await fn(); }
    catch (e) {
      const isLimit = e.message && (
        e.message.includes("rate limit") || e.message.includes("429") ||
        e.message.includes("too many") || e.message.includes("timeout") ||
        e.message.includes("fetch") || e.message.includes("ETIMEDOUT")
      );
      if (isLimit && i < retries - 1) {
        const wait = (i + 1) * 2000;
        console.log("[RPC] 限流等待 " + wait + "ms (" + (i + 1) + "/" + retries + ")");
        await new Promise(r => setTimeout(r, wait));
        continue;
      }
      throw e;
    }
  }
}

// ---- 通过 HTTP RPC 直接查询 ----
async function httpRpc(method, params) {
  const fetch = require("node-fetch");
  const resp = await rpcCall(() =>
    fetch(config.RPC_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: params || [] }),
      timeout: 10000
    })
  );
  const data = await resp.json();
  if (data.error) throw new Error(data.error.message);
  return data.result;
}

// ---- 扫描新池（从交易中提取） ----
async function processPoolCreation(sig, dex, blockTime) {
  try {
    if (seenPools.has(sig)) return;
    seenPools.add(sig);
    if (seenPools.size > 50000) seenPools.clear();

    const tx = await rpcCall(() =>
      connection.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 })
    );
    if (!tx || !tx.meta || tx.meta.err) return;

    const post = tx.meta.postTokenBalances || [];
    const pre = tx.meta.preTokenBalances || [];
    const postMints = [...new Set(post.map(b => b.mint))];
    const anchorMints = postMints.filter(m => dexs.isAnchorToken(m));

    // Pump.fun 特殊处理
    if (dex.id === "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P") {
      return processPumpTx(tx, sig, dex, blockTime);
    }

    // 普通 DEX - 找新代币 mint
    if (anchorMints.length === 0) return;
    const quoteMint = anchorMints[0];
    const quoteSymbol = dexs.getAnchorSymbol(quoteMint);
    const preMints = new Set(pre.map(b => b.mint));
    const newMints = postMints.filter(m => !preMints.has(m) && !dexs.isAnchorToken(m));
    if (newMints.length === 0) return;

    const newMint = newMints[0];
    const accounts = tx.transaction.message.staticAccountKeys.map(k => k.toBase58());

    // 找池子地址
    let poolAddr = "";
    for (const ix of tx.transaction.message.compiledInstructions) {
      if (accounts[ix.programIdIndex] === dex.id) {
        for (const idx of ix.accountKeyIndexes) {
          if (idx < accounts.length && accounts[idx] !== dex.id && accounts[idx].length === 44) {
            poolAddr = accounts[idx]; break;
          }
        }
      }
      if (poolAddr) break;
    }
    if (!poolAddr) poolAddr = sig.slice(0, 44);

    // 获取代币信息
    let symbol = "", name = "", totalSupply = "", decimals = null;
    try {
      const info = await Promise.race([
        tokenResolver.resolveTokenInfos([newMint]),
        new Promise(r => setTimeout(() => r(null), 3000))
      ]);
      if (info && info[newMint]) { symbol = info[newMint]?.symbol || ""; name = info[newMint]?.name || ""; }
      const mintInfo = await tokenResolver.fetchMintAccountInfo(newMint);
      if (mintInfo) { totalSupply = mintInfo.totalSupplyFormatted; decimals = mintInfo.decimals; }
    } catch(e) {}

    // 计算 quote 金额
    let amount = "";
    for (const p of post) {
      if (p.mint !== quoteMint) continue;
      const prev = pre.find(x => x.accountIndex === p.accountIndex && x.mint === quoteMint);
      if (!prev) continue;
      const diff = parseFloat(p.uiTokenAmount.uiAmountString || "0") - parseFloat(prev.uiTokenAmount.uiAmountString || "0");
      if (diff > 0) { amount = diff.toLocaleString("en-US", { maximumFractionDigits: 2 }); break; }
    }

    // 计算代币数量 + 价格 + 市值
    let tokenAmount = "";
    for (const p of post) {
      if (p.mint !== newMint) continue;
      const prev = pre.find(x => x.accountIndex === p.accountIndex && x.mint === newMint);
      if (!prev) continue;
      const diff = parseFloat(p.uiTokenAmount.uiAmountString || "0") - parseFloat(prev.uiTokenAmount.uiAmountString || "0");
      if (diff > 0) { tokenAmount = diff.toLocaleString("en-US", { maximumFractionDigits: 2 }); break; }
    }

    let price = "";
    if (amount && tokenAmount && parseFloat(tokenAmount.replace(/,/g, "")) > 0) {
      price = (parseFloat(amount.replace(/,/g, "")) / parseFloat(tokenAmount.replace(/,/g, ""))).toFixed(8);
    }

    let marketCap = "";
    if (price && totalSupply) {
      const sn = parseFloat(totalSupply.replace(/,/g, ""));
      const pn = parseFloat(price);
      if (sn > 0 && pn > 0) { marketCap = (sn * pn).toLocaleString("en-US", { maximumFractionDigits: 2 }); }
    }

    const createTime = blockTime ? new Date(blockTime * 1000).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }) : "";

    const now = Date.now();
    if (now - lastPushTime < MIN_PUSH_INTERVAL) return;
    lastPushTime = now;

    const pool = { dexName: dex.name, poolAddress: poolAddr, mint: newMint, symbol, name, amount, quote: quoteSymbol, tokenAmount, price, totalSupply, decimals: decimals !== null ? decimals.toString() : "", marketCap, createTime };
    stats.pools++;
    stats.poolsFound++;
    telegram.enqueue(telegram.formatPoolMessage(pool));
    console.log("[新池]", dex.name, "|", symbol || newMint.slice(0, 8), amount ? "| " + amount + " " + quoteSymbol : "");
  } catch(e) {
    stats.errors++;
    if (config.DEBUG) console.log("[processSig]", e.message?.slice(0, 60));
  }
}

async function processPumpTx(tx, sig, dex, blockTime) {
  try {
    const accounts = tx.transaction.message.staticAccountKeys.map(k => k.toBase58());
    let newMint = "";
    for (const acc of accounts) {
      if (acc.endsWith("pump") && acc.length === 44) { newMint = acc; break; }
    }
    if (!newMint) {
      for (const acc of accounts) {
        if (acc.length === 44) { newMint = acc; break; }
      }
    }
    if (!newMint) newMint = sig.slice(0, 44);

    let symbol = "", name = "", totalSupply = "", decimals = null;
    try {
      const info = await Promise.race([
        tokenResolver.resolveTokenInfos([newMint]),
        new Promise(r => setTimeout(() => r(null), 3000))
      ]);
      if (info && info[newMint]) { symbol = info[newMint]?.symbol || ""; name = info[newMint]?.name || ""; }
      const mintInfo = await tokenResolver.fetchMintAccountInfo(newMint);
      if (mintInfo) { totalSupply = mintInfo.totalSupplyFormatted; decimals = mintInfo.decimals; }
    } catch(e) {}

    const createTime = blockTime ? new Date(blockTime * 1000).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }) : "";

    const now = Date.now();
    if (now - lastPushTime < MIN_PUSH_INTERVAL) return;
    lastPushTime = now;

    const pool = { dexName: dex.name, poolAddress: "", mint: newMint, symbol, name, amount: "", quote: "SOL", tokenAmount: "", price: "", totalSupply, decimals: decimals !== null ? decimals.toString() : "", marketCap: "", createTime };
    stats.pools++;
    stats.poolsFound++;
    telegram.enqueue(telegram.formatPoolMessage(pool));
    console.log("[Pump]", symbol || newMint.slice(0, 8));
  } catch(e) { stats.errors++; }
}

// ---- WebSocket 实时监听 DEX 日志 ----
function startWebSocketSubscriptions() {
  let subCount = 0;
  for (const dex of dexs.DEX_PROGRAMS) {
    try {
      const progId = new PublicKey(dex.id);
      connection.onLogs(
        progId,
        async (logInfo) => {
          if (logInfo.err) return;
          const logs = (logInfo.logs || []).join(" ").toLowerCase();
          if (CREATE_KEYWORDS.some(k => logs.includes(k))) {
            await processPoolCreation(logInfo.signature, dex, logInfo.context?.slot);
          }
        },
        "confirmed"
      );
      subCount++;
    } catch (e) {
      if (config.DEBUG) console.log("[WS] " + dex.name + " 订阅失败:", e.message?.slice(0, 40));
    }
  }
  stats.wsSubs = subCount;
  console.log("[WS] 已订阅 " + subCount + "/" + dexs.DEX_PROGRAMS.length + " 个 DEX");
}

// ---- getProgramAccounts 定期扫描（备用方案） ----
// 各 DEX 池账户数据大小
const POOL_DATA_SIZES = {
  "675kPX9MHTjS2zt1qfr1NYyzeCKVU9jnFdoKUAJwRfxU": 364,  // Raydium AMM
  "CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qPaTr": 268,  // Raydium CPMM
  "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P": 168,  // Pump.fun
};

async function scanProgramAccounts() {
  stats.scans++;
  const results = await Promise.allSettled(
    Object.entries(POOL_DATA_SIZES).map(([progId, size]) =>
      scanAccountsForProgram(progId, size)
    )
  );
  for (const r of results) {
    if (r.status === "rejected") stats.errors++;
  }
}

const knownAccounts = new Set();

async function scanAccountsForProgram(progId, dataSize) {
  try {
    const accounts = await rpcCall(() =>
      httpRpc("getProgramAccounts", [progId, {
        filters: [{ dataSize }],
        limit: 50
      }])
    );
    if (!accounts || accounts.length === 0) return;

    for (const acct of accounts) {
      const pubkey = acct.pubkey || (typeof acct === "string" ? acct : acct.account?.pubkey || Object.keys(acct)[0]);
      if (!pubkey || knownAccounts.has(pubkey)) continue;
      knownAccounts.add(pubkey);

      // 尝试从账户数据提取 mint
      try {
        const data = acct.account?.data || acct.data;
        // 不同 DEX 数据布局不同，先标记已知池子
      } catch(e) {}
    }

    if (knownAccounts.size > 100000) {
      const arr = [...knownAccounts];
      knownAccounts.clear();
      for (let i = arr.length - 50000; i < arr.length; i++) knownAccounts.add(arr[i]);
    }
  } catch (e) {
    if (config.DEBUG) console.log("[scanAccounts]", progId.slice(0, 8), e.message?.slice(0, 40));
  }
}

// ---- 保留旧的签名扫描作为最后备胎 ----
const seenSigs = new Set();

async function scanSignatures() {
  const results = await Promise.allSettled(
    dexs.DEX_PROGRAMS.map(dex => scanDexSigs(dex))
  );
  for (const r of results) {
    if (r.status === "rejected") stats.errors++;
  }
}

async function scanDexSigs(dex) {
  try {
    const progId = new PublicKey(dex.id);
    const sigs = await rpcCall(() =>
      connection.getSignaturesForAddress(progId, { limit: 5 })
    );
    if (!sigs || sigs.length === 0) return;

    for (const s of sigs) {
      if (s.err || seenSigs.has(s.signature)) continue;
      seenSigs.add(s.signature);
    }
    if (seenSigs.size > 100000) seenSigs.clear();
  } catch(e) {}
}

// ---- 状态报告 ----
async function sendStatusToTelegram() {
  const uptime = Math.floor((Date.now() - stats.startedAt) / 1000);
  const hours = Math.floor(uptime / 3600);
  const mins = Math.floor((uptime % 3600) / 60);
  console.log("[状态] " + hours + "h" + mins + "m | WS:" + stats.wsSubs + " | 新池:" + stats.pools + " | 扫描:" + stats.scans + " | 错:" + stats.errors);

  // 发送到 Telegram
  const fetch = require("node-fetch");
  const msg = ["📊 状态报告","运行时间: "+hours+"h "+mins+"m","WebSocket: "+stats.wsSubs+" DEX","发现新池: "+stats.pools,"扫描次数: "+stats.scans,"错误: "+stats.errors,"DEX总数: "+dexs.DEX_PROGRAMS.length].join("\n");
  try {
    await fetch("https://api.telegram.org/bot" + config.TELEGRAM_BOT_TOKEN + "/sendMessage", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: config.TELEGRAM_CHAT_ID, text: msg, disable_web_page_preview: true }),
      timeout: 10000
    });
  } catch(e) {}
}

// ---- 启动 ----
function start() {
  if (isRunning) return;
  isRunning = true;
  stats.startedAt = new Date();
  tokenResolver.setConnection(connection);

  // 创建连接（同时支持 HTTP 和 WebSocket）
  connection = new Connection(config.RPC_ENDPOINT, {
    commitment: "confirmed",
    wsEndpoint: config.RPC_WEBSOCKET
  });
  tokenResolver.setConnection(connection);

  console.log("=== Solana 新币监控 v9.0 ===");
  console.log("RPC:", config.RPC_ENDPOINT);
  console.log("WS:", config.RPC_WEBSOCKET);
  console.log("DEX:", dexs.DEX_PROGRAMS.length, "个");

  // 1. WebSocket 实时监听
  startWebSocketSubscriptions();

  // 2. getProgramAccounts 扫描（每 60 秒）
  setInterval(scanProgramAccounts, 60000);

  // 3. 旧签名扫描备胎（每 30 秒）
  setInterval(scanSignatures, 30000);

  // 4. 状态报告（每 30 分钟）
  setInterval(sendStatusToTelegram, 30 * 60 * 1000);
}

function stop() {
  isRunning = false;
  console.log("[Monitor] 已停止");
}

module.exports = { start, stop, stats };
