/**
 * Static chain + token registry.
 *
 * Every token address here is hard-coded and reviewed; the wallet never
 * trusts token metadata coming back from a swap API without matching it
 * against this list first.
 */

export type ChainFamily = 'evm' | 'solana' | 'bitcoin';

export interface Chain {
  /** Stable internal id, e.g. "ethereum". */
  id: string;
  name: string;
  family: ChainFamily;
  /** EVM chain id, or the LI.FI id for non-EVM chains. */
  lifiId: number;
  evmChainId?: number;
  nativeSymbol: string;
  nativeDecimals: number;
  rpcUrl: string;
  explorerTx: (hash: string) => string;
  color: string;
}

export interface Token {
  chainId: string;
  symbol: string;
  name: string;
  decimals: number;
  /** null = the chain's native asset. */
  address: string | null;
  /** CoinGecko id used for pricing. */
  priceId: string;
  color: string;
}

export const LIFI_SOLANA_ID = 1151111081099710;
export const LIFI_BITCOIN_ID = 20000000000001;

const env = (key: string, fallback: string): string => {
  const v = (import.meta as { env?: Record<string, string | undefined> }).env?.[key];
  return v && v.startsWith('https://') ? v : fallback;
};

export const CHAINS: Chain[] = [
  {
    id: 'ethereum', name: 'Ethereum', family: 'evm', lifiId: 1, evmChainId: 1,
    nativeSymbol: 'ETH', nativeDecimals: 18,
    rpcUrl: env('VITE_RPC_ETHEREUM', 'https://ethereum-rpc.publicnode.com'),
    explorerTx: (h) => `https://etherscan.io/tx/${h}`, color: '#627EEA',
  },
  {
    id: 'base', name: 'Base', family: 'evm', lifiId: 8453, evmChainId: 8453,
    nativeSymbol: 'ETH', nativeDecimals: 18,
    rpcUrl: env('VITE_RPC_BASE', 'https://base-rpc.publicnode.com'),
    explorerTx: (h) => `https://basescan.org/tx/${h}`, color: '#0052FF',
  },
  {
    id: 'arbitrum', name: 'Arbitrum', family: 'evm', lifiId: 42161, evmChainId: 42161,
    nativeSymbol: 'ETH', nativeDecimals: 18,
    rpcUrl: env('VITE_RPC_ARBITRUM', 'https://arbitrum-one-rpc.publicnode.com'),
    explorerTx: (h) => `https://arbiscan.io/tx/${h}`, color: '#28A0F0',
  },
  {
    id: 'optimism', name: 'Optimism', family: 'evm', lifiId: 10, evmChainId: 10,
    nativeSymbol: 'ETH', nativeDecimals: 18,
    rpcUrl: env('VITE_RPC_OPTIMISM', 'https://optimism-rpc.publicnode.com'),
    explorerTx: (h) => `https://optimistic.etherscan.io/tx/${h}`, color: '#FF0420',
  },
  {
    id: 'polygon', name: 'Polygon', family: 'evm', lifiId: 137, evmChainId: 137,
    nativeSymbol: 'POL', nativeDecimals: 18,
    rpcUrl: env('VITE_RPC_POLYGON', 'https://polygon-bor-rpc.publicnode.com'),
    explorerTx: (h) => `https://polygonscan.com/tx/${h}`, color: '#8247E5',
  },
  {
    id: 'bsc', name: 'BNB Chain', family: 'evm', lifiId: 56, evmChainId: 56,
    nativeSymbol: 'BNB', nativeDecimals: 18,
    rpcUrl: env('VITE_RPC_BSC', 'https://bsc-rpc.publicnode.com'),
    explorerTx: (h) => `https://bscscan.com/tx/${h}`, color: '#F0B90B',
  },
  {
    id: 'avalanche', name: 'Avalanche', family: 'evm', lifiId: 43114, evmChainId: 43114,
    nativeSymbol: 'AVAX', nativeDecimals: 18,
    rpcUrl: env('VITE_RPC_AVALANCHE', 'https://avalanche-c-chain-rpc.publicnode.com'),
    explorerTx: (h) => `https://snowtrace.io/tx/${h}`, color: '#E84142',
  },
  {
    id: 'solana', name: 'Solana', family: 'solana', lifiId: LIFI_SOLANA_ID,
    nativeSymbol: 'SOL', nativeDecimals: 9,
    rpcUrl: env('VITE_RPC_SOLANA', 'https://solana-rpc.publicnode.com'),
    explorerTx: (h) => `https://solscan.io/tx/${h}`, color: '#9945FF',
  },
  {
    id: 'bitcoin', name: 'Bitcoin', family: 'bitcoin', lifiId: LIFI_BITCOIN_ID,
    nativeSymbol: 'BTC', nativeDecimals: 8,
    rpcUrl: env('VITE_BTC_API', 'https://mempool.space/api'),
    explorerTx: (h) => `https://mempool.space/tx/${h}`, color: '#F7931A',
  },
];

const nativeToken = (chainId: string, symbol: string, name: string, decimals: number, priceId: string, color: string): Token =>
  ({ chainId, symbol, name, decimals, address: null, priceId, color });
const usdc = (chainId: string, address: string): Token =>
  ({ chainId, symbol: 'USDC', name: 'USD Coin', decimals: chainId === 'bsc' ? 18 : 6, address, priceId: 'usd-coin', color: '#2775CA' });

export const TOKENS: Token[] = [
  nativeToken('ethereum', 'ETH', 'Ethereum', 18, 'ethereum', '#627EEA'),
  usdc('ethereum', '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'),
  { chainId: 'ethereum', symbol: 'USDT', name: 'Tether USD', decimals: 6, address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', priceId: 'tether', color: '#26A17B' },
  nativeToken('base', 'ETH', 'Ethereum', 18, 'ethereum', '#627EEA'),
  usdc('base', '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'),
  nativeToken('arbitrum', 'ETH', 'Ethereum', 18, 'ethereum', '#627EEA'),
  usdc('arbitrum', '0xaf88d065e77c8cC2239327C5EDb3A432268e5831'),
  nativeToken('optimism', 'ETH', 'Ethereum', 18, 'ethereum', '#627EEA'),
  usdc('optimism', '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85'),
  nativeToken('polygon', 'POL', 'Polygon', 18, 'polygon-ecosystem-token', '#8247E5'),
  usdc('polygon', '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359'),
  nativeToken('bsc', 'BNB', 'BNB', 18, 'binancecoin', '#F0B90B'),
  usdc('bsc', '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d'),
  nativeToken('avalanche', 'AVAX', 'Avalanche', 18, 'avalanche-2', '#E84142'),
  usdc('avalanche', '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E'),
  nativeToken('solana', 'SOL', 'Solana', 9, 'solana', '#9945FF'),
  usdc('solana', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),
  nativeToken('bitcoin', 'BTC', 'Bitcoin', 8, 'bitcoin', '#F7931A'),
];

export const getChain = (id: string): Chain => {
  const c = CHAINS.find((x) => x.id === id);
  if (!c) throw new Error(`Unknown chain: ${id}`);
  return c;
};

export const tokenKey = (t: Pick<Token, 'chainId' | 'address'>): string => `${t.chainId}:${t.address ?? 'native'}`;

export const findToken = (key: string): Token | undefined => TOKENS.find((t) => tokenKey(t) === key);

/** Address LI.FI uses to denote a chain's native asset. */
export const lifiTokenAddress = (t: Token): string => {
  if (t.address) return t.address;
  const fam = getChain(t.chainId).family;
  if (fam === 'solana') return '11111111111111111111111111111111';
  if (fam === 'bitcoin') return 'bitcoin';
  return '0x0000000000000000000000000000000000000000';
};
