const fs = require('fs');
const path = require('path');
const config = require('./config');

const SEEN_FILE = path.resolve(config.SEEN_PAIRS_FILE);

function loadSeenPairs() {
  try {
    if (fs.existsSync(SEEN_FILE)) {
      const data = fs.readFileSync(SEEN_FILE, 'utf8');
      return new Set(JSON.parse(data));
    }
  } catch (e) {
    if (config.DEBUG) console.error('[Storage] 读取失败:', e.message);
  }
  return new Set();
}

let seenPairs = loadSeenPairs();

function saveSeenPair(pairKey) {
  seenPairs.add(pairKey);
  try {
    fs.writeFileSync(SEEN_FILE, JSON.stringify([...seenPairs].sort()), 'utf8');
  } catch (e) {
    if (config.DEBUG) console.error('[Storage] 保存失败:', e.message);
  }
}

function hasSeen(pairKey) {
  return seenPairs.has(pairKey);
}

function makePairKey(mints) {
  return [...mints].sort().join(':');
}

// 运行时内存去重
const seenPools = new Set();
const seenMints = new Set();
const seenTxSigs = new Set();

function cleanup() {
  if (seenTxSigs.size > 50000) seenTxSigs.clear();
  if (seenMints.size > 50000) seenMints.clear();
}

module.exports = {
  saveSeenPair, hasSeen, makePairKey,
  seenPools, seenMints, seenTxSigs, cleanup
};
