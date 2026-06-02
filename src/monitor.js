// ============================================================
// Solana 新币监控 v8.7 - 增加池子数据（价格/市值/总量）
// ============================================================

const { Connection, PublicKey } = require("@solana/web3.js");
const config = require("./config");
const dexs = require("./dexs");
const telegram = require("./telegram");
const tokenResolver = require("./token-resolver");

let connection, isRunning = false, pollTimer = null;
let stats = { pools: 0, scans: 0, errors: 0, startedAt: null, poolsFound: 0 };

const seenSigs = new Set(), seenPools = new Set();
let lastPushTime = 0;
const MIN_PUSH_INTERVAL = 500;
const PUMPFUN_ID = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";

async function rpcCall(fn, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (e) {
      const isRateLimit = e.message && (
        e.message.includes("rate limit") ||
        e.message.includes("429") ||
        e.message.includes("too many") ||
        e.message.includes("timeout") ||
        e.message.includes("fetch")
      );
      if (isRateLimit && i < retries - 1) {
        const wait = (i + 1) * 2000;
        console.log("[RPC] 限流，等待 " + wait + "ms 后重试 (" + (i + 1) + "/" + retries + ")");
        await new Promise(r => setTimeout(r, wait));
        continue;
      }
      throw e;
    }
  }
}

async function scan() {
  stats.scans++;
  const results = await Promise.allSettled(dexs.DEX_PROGRAMS.map((dex) => scanDex(dex)));
  for (const r of results) {
    if (r.status === "rejected") { stats.errors++; }
  }
}

function cleanSet(set, max, keep) {
  if (set.size > max) {
    const arr = [...set];
    set.clear();
    for (let i = arr.length - keep; i < arr.length; i++) set.add(arr[i]);
  }
}

async function scanDex(dex) {
  try {
    const progId = new PublicKey(dex.id);
    const limit = dex.id === PUMPFUN_ID ? 50 : 10;
    const sigs = await rpcCall(() =>
      connection.getSignaturesForAddress(progId, { limit })
    );
    if (!sigs || sigs.length === 0) return;

    const newSigs = sigs.filter((s) => !s.err && !seenSigs.has(s.signature));
    if (newSigs.length === 0) return;

    for (const s of newSigs) seenSigs.add(s.signature);
    cleanSet(seenSigs, 100000, 80000);

    if (dex.id === PUMPFUN_ID) {
      for (const s of newSigs) await processPumpSig(s.signature, dex);
    } else {
      for (let i = 0; i < newSigs.length; i += 3) {
        await Promise.all(newSigs.slice(i, i + 3).map((s) => processSig(s.signature, dex)));
      }
    }
  } catch (e) {
    if (config.DEBUG) console.log("[ScanDex] " + dex.name + ":", e.message?.slice(0, 60));
  }
}

async function processPumpSig(sig, dex) {
  try {
    const tx = await rpcCall(() =>
      connection.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 })
    );
    if (!tx || !tx.meta || tx.meta.err) return;

    const logs = (tx.meta.logMessages || []).join(" ").toLowerCase();
    if (!logs.includes("create") && !logs.includes("initialize")) return;

    const accounts = tx.transaction.message.staticAccountKeys.map((k) => k.toBase58());
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

    if (seenPools.has(newMint)) return;
    seenPools.add(newMint);
    cleanSet(seenPools, 20000, 15000);

    const now = Date.now();
    if (now - lastPushTime < MIN_PUSH_INTERVAL) return;
    lastPushTime = now;

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

    const blockTime = tx.blockTime ? new Date(tx.blockTime * 1000).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }) : "";
    const pool = { dexName: dex.name, poolAddress: "", mint: newMint, symbol, name, amount: "", quote: "SOL", tokenAmount: "", price: "", totalSupply, decimals: decimals !== null ? decimals.toString() : "", marketCap: "", createTime: blockTime };
    stats.pools++;
    stats.poolsFound++;
    telegram.enqueue(telegram.formatPoolMessage(pool));
    console.log("[Pump]", symbol || newMint.slice(0, 8), totalSupply ? "| 总量:" + totalSupply : "");
  } catch(e) { stats.errors++; }
}

async function processSig(sig, dex) {
  try {
    const tx = await rpcCall(() =>
      connection.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 })
    );
    if (!tx || !tx.meta || tx.meta.err) return;

    const logs = (tx.meta.logMessages || []).join(" ").toLowerCase();
    const createKw = ["initialize", "create_pool", "createpool", "init_pool"];
    if (!createKw.some((w) => logs.includes(w))) return;

    const post = tx.meta.postTokenBalances || [];
    const pre = tx.meta.preTokenBalances || [];
    const postMints = [...new Set(post.map((b) => b.mint))];
    const anchorMints = postMints.filter((m) => dexs.isAnchorToken(m));
    if (anchorMints.length === 0) return;

    const quoteMint = anchorMints[0];
    const quoteSymbol = dexs.getAnchorSymbol(quoteMint);
    const preMints = new Set(pre.map((b) => b.mint));
    const newMints = postMints.filter((m) => !preMints.has(m) && !dexs.isAnchorToken(m));
    if (newMints.length === 0) return;

    const newMint = newMints[0];
    const accounts = tx.transaction.message.staticAccountKeys.map((k) => k.toBase58());

    let poolAddr = "";
    for (const ix of tx.transaction.message.compiledInstructions) {
      if (accounts[ix.programIdIndex] === dex.id) {
        for (const idx of ix.accountKeyIndexes) {
          if (idx < accounts.length && accounts[idx] !== dex.id && accounts[idx].length === 44) { poolAddr = accounts[idx]; break; }
        }
      }
      if (poolAddr) break;
    }
    if (!poolAddr) poolAddr = sig.slice(0, 44);

    if (seenPools.has(newMint)) return;
    seenPools.add(newMint);
    cleanSet(seenPools, 20000, 15000);

    const now = Date.now();
    if (now - lastPushTime < MIN_PUSH_INTERVAL) return;
    lastPushTime = now;

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

    let amount = "";
    for (const p of post) {
      if (p.mint !== quoteMint) continue;
      const prev = pre.find((x) => x.accountIndex === p.accountIndex && x.mint === quoteMint);
      if (!prev) continue;
      const diff = parseFloat(p.uiTokenAmount.uiAmountString || "0") - parseFloat(prev.uiTokenAmount.uiAmountString || "0");
      if (diff > 0) { amount = diff.toLocaleString("en-US", { maximumFractionDigits: 2 }); break; }
    }

    let tokenAmount = "";
    for (const p of post) {
      if (p.mint !== newMint) continue;
      const prev = pre.find((x) => x.accountIndex === p.accountIndex && x.mint === newMint);
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

    const blockTime = tx.blockTime ? new Date(tx.blockTime * 1000).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }) : "";
    const pool = { dexName: dex.name, poolAddress: poolAddr, mint: newMint, symbol, name, amount, quote: quoteSymbol, tokenAmount, price, totalSupply, decimals: decimals !== null ? decimals.toString() : "", marketCap, createTime: blockTime };
    stats.pools++;
    stats.poolsFound++;
    telegram.enqueue(telegram.formatPoolMessage(pool));
    console.log("[新币]", dex.name, "|", symbol || newMint.slice(0, 8), amount ? "| " + amount + " " + quoteSymbol : "", price ? "| 价格:" + price : "", marketCap ? "| 市值:" + marketCap : "");
  } catch(e) { stats.errors++; }
}

function start() {
  if (isRunning) return;
  isRunning = true;
  stats.startedAt = new Date();
  connection = new Connection(config.RPC_ENDPOINT, { commitment: "confirmed" });
  tokenResolver.setConnection(connection);
  console.log("Solana 新币监控 v8.7 | DEX:", dexs.DEX_PROGRAMS.length, "个");
  scan();
  pollTimer = setInterval(scan, config.POLL_INTERVAL_MS);
}

function stop() {
  isRunning = false;
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  console.log("[Monitor] 已停止");
}

module.exports = { start, stop, stats };
