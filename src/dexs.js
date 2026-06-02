const DEX_PROGRAMS = [
  { name: 'Raydium AMM',        id: '675kPX9MHTjS2zt1qfr1NYyzeCKVU9jnFdoKUAJwRfxU' },
  { name: 'Raydium CPMM',       id: 'CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qPaTr' },
  { name: 'Raydium CLMM',       id: 'CAMMCzo5YLJwZxV9X9kXqY7hFj9PZxGxY1QKuXf7Dq9o' },
  { name: 'Orca Whirlpools',    id: 'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc' },
  { name: 'Orca v1',            id: '9W959DqEETiGZocYWCQPaJ6sBmUzgfxXfqGeTEdg3qQP' },
  { name: 'Orca v2',            id: '2PH1quJjEGCzBYVZb8TNYzACCrr7QPFh3bSjL3JfYwyP' },
  { name: 'Meteora DLMM',       id: 'LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo' },
  { name: 'Meteora Pools',      id: 'Eo7WjKq67rjJQSZxS6jDSR2S5kH2E2HjY8M7TZ9Yc2c' },
  { name: 'Pump.fun',           id: '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P' },
  { name: 'Pump.fun AMM',       id: 'pAMMPumpkinz1g8RQgLQA2KzJXzoVQL3NbtBv6CgT4f' },
  { name: 'Moonshot',           id: 'MoonShoT6VC3BHGi9is6wXgjHkHTQzF5fJQy5K9F5x' },
  { name: 'FluxBeam',           id: 'FLUXubRmkEi2q1BLWujY1p7q7VQo7LJ7Pc3TfS3xN3y' },
  { name: 'Phoenix',            id: 'PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY' },
  { name: 'OpenBook v1',        id: 'srmqPvymJeFKQ4zGQed1GFppgkRHL9ka3CzTZ7M5t3i' },
  { name: 'OpenBook v2',        id: 'opnb2LAfJYbRMAHHvqjCwQx5Zn3qC4wBk6SEN3pxRi5' },
  { name: 'Lifinity v1',        id: 'EewxvdBjFSzwTu5u6e2H8KLCAMN8mFmKTsx4g9Jjc4X' },
  { name: 'Lifinity v2',        id: 'LfYnV6e6g9i3jSg8z7kXMkY3qVpjyPSjx3XsquFwJq5' },
  { name: 'Invariant',          id: 'HyaB3W9qPLcySmwXWZJzYqG5JwKjLGwKdVLEq8kGVyV' },
  { name: 'Aldrin',             id: 'CJsLwbP1iu5DuUikHEJnLfANgKy6stB2uFgvBBHikexW' },
  { name: 'Step Finance',       id: 'SSwpkEEcbUqx4vtoEByFjSkhKdCT862DNVb52nZg1UZ' },
  { name: 'Cropper',            id: 'H8WjN8jYxGViXmUQCFmFFQDoYEG9Jv3iLqWzYz9Z6cP' },
  { name: 'Saber',              id: 'SSwpEEcbUqx4vtoEByFjSkhKdCT862DNVb52nZg1UZ' },
  { name: 'GooseFX',            id: 'GFXsSL5sSaQxN9ukG7hkYWKf5R7LHpsSmLJdMqQ5Jk5' },
];

const ANCHOR_TOKENS = {
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': 'USDC',
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB': 'USDT',
  'So11111111111111111111111111111111111111112': 'WSOL',
  'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263': 'BONK',
  'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm': 'WIF',
};

function isAnchorToken(mint) { return mint in ANCHOR_TOKENS; }
function getAnchorSymbol(mint) { return ANCHOR_TOKENS[mint] || null; }
function getProgramIds() { return DEX_PROGRAMS.map(p => p.id); }
function getProgramName(programId) { const f = DEX_PROGRAMS.find(p => p.id === programId); return f ? f.name : programId.slice(0, 12) + '...'; }

module.exports = { DEX_PROGRAMS, ANCHOR_TOKENS, isAnchorToken, getAnchorSymbol, getProgramIds, getProgramName };
