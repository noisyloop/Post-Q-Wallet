import {
  createPublicClient, createWalletClient, encodeFunctionData, erc20Abi, http, bytesToHex,
  type Address, type Hex, type PublicClient, type Chain as ViemChain,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { getChain, TOKENS, type Token } from './registry';

const clients = new Map<string, PublicClient>();

const viemChain = (id: string): ViemChain => {
  const c = getChain(id);
  return {
    id: c.evmChainId!,
    name: c.name,
    nativeCurrency: { name: c.nativeSymbol, symbol: c.nativeSymbol, decimals: c.nativeDecimals },
    rpcUrls: { default: { http: [c.rpcUrl] } },
  };
};

export const evmClient = (chainId: string): PublicClient => {
  let c = clients.get(chainId);
  if (!c) {
    c = createPublicClient({ chain: viemChain(chainId), transport: http(getChain(chainId).rpcUrl, { timeout: 15_000 }) }) as PublicClient;
    clients.set(chainId, c);
  }
  return c;
};

export const evmBalances = async (chainId: string, owner: Address): Promise<Map<Token, bigint>> => {
  const client = evmClient(chainId);
  const out = new Map<Token, bigint>();
  await Promise.all(TOKENS.filter((t) => t.chainId === chainId).map(async (t) => {
    const bal = t.address
      ? await client.readContract({ address: t.address as Address, abi: erc20Abi, functionName: 'balanceOf', args: [owner] })
      : await client.getBalance({ address: owner });
    out.set(t, bal);
  }));
  return out;
};

export interface EvmTxRequest {
  chainId: string;
  to: Address;
  data?: Hex;
  value?: bigint;
  gas?: bigint;
}

/** Signs locally with a short-lived key and broadcasts the raw transaction. */
export const evmSendRaw = async (priv: Uint8Array, req: EvmTxRequest): Promise<Hex> => {
  const account = privateKeyToAccount(bytesToHex(priv));
  const wallet = createWalletClient({ account, chain: viemChain(req.chainId), transport: http(getChain(req.chainId).rpcUrl) });
  return wallet.sendTransaction({ to: req.to, data: req.data, value: req.value ?? 0n, gas: req.gas, chain: viemChain(req.chainId) });
};

export const evmTransferRequest = (token: Token, to: Address, amount: bigint): EvmTxRequest =>
  token.address
    ? { chainId: token.chainId, to: token.address as Address, data: encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [to, amount] }) }
    : { chainId: token.chainId, to, value: amount };

export const evmAllowance = (chainId: string, token: Address, owner: Address, spender: Address) =>
  evmClient(chainId).readContract({ address: token, abi: erc20Abi, functionName: 'allowance', args: [owner, spender] });

/** Exact-amount approval — the wallet never grants unlimited allowances. */
export const evmApproveRequest = (chainId: string, token: Address, spender: Address, amount: bigint): EvmTxRequest => ({
  chainId,
  to: token,
  data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [spender, amount] }),
});

export const evmWaitForReceipt = (chainId: string, hash: Hex) =>
  evmClient(chainId).waitForTransactionReceipt({ hash, timeout: 180_000 });
