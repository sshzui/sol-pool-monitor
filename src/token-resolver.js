const fetch = require('node-fetch');
const config = require('./config');

const tokenCache = new Map();
const supplyCache = new Map();
const METADATA_PROGRAM_ID = 'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s';
let connection = null;

function setConnection(conn) { connection = conn; }

function findMetadataPDA(mint) {
  const { PublicKey } = require('@solana/web3.js');
  const mp = new PublicKey(METADATA_PROGRAM_ID);
  const [pda] = PublicKey.findProgramAddressSync([Buffer.from('metadata'), mp.toBuffer(), new PublicKey(mint).toBuffer()], mp);
  return pda.toBase58();
}

function decodeMetadata(data) {
  try {
    let off = 1 + 32 + 32;
    const nl = data.readUInt32LE(off); off += 4;
    const name = data.slice(off, off + nl).toString('utf8').replace(/\0/g, '').trim(); off += nl;
    const sl = data.readUInt32LE(off); off += 4;
    const symbol = data.slice(off, off + sl).toString('utf8').replace(/\0/g, '').trim(); off += sl;
    const ul = data.readUInt32LE(off); off += 4;
    const uri = data.slice(off, off + ul).toString('utf8').replace(/\0/g, '').trim();
    return { name, symbol, uri };
  } catch(e) { return null; }
}

async function fetchOnChainMetadata(mint) {
  if (!connection) return null;
  try {
    const { PublicKey } = require('@solana/web3.js');
    const info = await connection.getAccountInfo(new PublicKey(findMetadataPDA(mint)));
    return (info && info.data && info.data.length >= 100) ? decodeMetadata(info.data) : null;
  } catch(e) { return null; }
}

async function fetchMintAccountInfo(mint) {
  if (!connection) return null;
  if (supplyCache.has(mint)) return supplyCache.get(mint);
  try {
    const { PublicKey } = require('@solana/web3.js');
    const info = await connection.getAccountInfo(new PublicKey(mint));
    if (!info || !info.data || info.data.length < 82) return null;
    const data = info.data;
    const supplyRaw = data.readBigUInt64LE(36);
    const decimals = data.readUInt8(44);
    const result = { decimals, totalSupply: supplyRaw.toString(), totalSupplyFormatted: (Number(supplyRaw) / Math.pow(10, decimals)).toLocaleString('en-US', { maximumFractionDigits: 2 }) };
    supplyCache.set(mint, result);
    return result;
  } catch(e) { return null; }
}

function shortMint(mint) { return mint ? mint.slice(0, 4) + '...' + mint.slice(-4) : '???'; }

const KNOWN_TOKENS = {
  'So11111111111111111111111111111111111111112': { symbol: 'SOL', name: 'Wrapped SOL', decimals: 9 },
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': { symbol: 'USDC', name: 'USD Coin', decimals: 6 },
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB': { symbol: 'USDT', name: 'Tether USD', decimals: 6 },
  'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263': { symbol: 'BONK', name: 'Bonk', decimals: 5 },
  'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm': { symbol: 'WIF', name: 'dogwifhat', decimals: 6 },
};

function isBaseToken(mint) { return ['So11111111111111111111111111111111111111112','EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v','Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'].includes(mint); }

async function resolveTokenInfo(mint) {
  if (tokenCache.has(mint)) return tokenCache.get(mint);
  if (KNOWN_TOKENS[mint]) { tokenCache.set(mint, KNOWN_TOKENS[mint]); return KNOWN_TOKENS[mint]; }
  try {
    const resp = await fetch('https://tokens.jup.ag/token/' + mint, { timeout: 5000 });
    if (resp.ok) {
      const data = await resp.json();
      if (data && !data.error) {
        const info = { symbol: data.symbol || shortMint(mint), name: data.name || '', decimals: data.decimals || 0 };
        tokenCache.set(mint, info);
        return info;
      }
    }
  } catch(e) { if (config.DEBUG) console.error('[Token] Jupiter失败', mint.slice(0,8)); }
  try {
    const meta = await fetchOnChainMetadata(mint);
    if (meta && meta.name && meta.symbol) { tokenCache.set(mint, { symbol: meta.symbol, name: meta.name, decimals: 0 }); return tokenCache.get(mint); }
  } catch(e) {}
  const fb = { symbol: shortMint(mint), name: '', decimals: 0 };
  tokenCache.set(mint, fb);
  return fb;
}

async function resolveTokenInfos(mints) {
  const results = {};
  await Promise.all([...new Set(mints.filter(m => m))].map(async m => { results[m] = await resolveTokenInfo(m); }));
  return results;
}

module.exports = { resolveTokenInfo, resolveTokenInfos, isBaseToken, setConnection, shortMint, KNOWN_TOKENS, fetchMintAccountInfo };
