import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { CHAINS, TOKENS, tokenKey, type Token } from '../../core/chains/registry';
import { fmtAmount, fmtUsd, toNumber } from '../../core/format';
import { useWallet } from '../state';
import { Sheet } from './common';
import { TokenIcon } from './icons';

export const TokenPicker = ({ title, onPick, onClose, onlyOwned }: { title: string; onPick(t: Token): void; onClose(): void; onlyOwned?: boolean }) => {
  const { rows, prices } = useWallet();
  const [q, setQ] = useState('');
  const [chain, setChain] = useState('all');

  const list = useMemo(() => {
    const owned = new Map(rows.map((r) => [tokenKey(r.token), r]));
    return TOKENS
      .filter((t) => chain === 'all' || t.chainId === chain)
      .filter((t) => !onlyOwned || owned.has(tokenKey(t)))
      .filter((t) => {
        const s = q.trim().toLowerCase();
        return !s || t.symbol.toLowerCase().includes(s) || t.name.toLowerCase().includes(s) || t.chainId.includes(s);
      })
      .map((t) => ({ t, r: owned.get(tokenKey(t)) }))
      .sort((a, b) => (b.r?.usd ?? 0) - (a.r?.usd ?? 0));
  }, [rows, chain, q, onlyOwned]);

  return (
    <Sheet title={title} onClose={onClose} tall>
      <div className="search">
        <Search size={18} />
        <input placeholder="Search tokens or networks" value={q} onChange={(e) => setQ(e.target.value)} autoFocus data-testid="token-search" />
      </div>
      <div className="chips scroll-x">
        <button className={`chip ${chain === 'all' ? 'active' : ''}`} onClick={() => setChain('all')}>All</button>
        {CHAINS.map((c) => (
          <button key={c.id} className={`chip ${chain === c.id ? 'active' : ''}`} onClick={() => setChain(c.id)}>
            <span className="chain-dot" style={{ background: c.color }} />{c.name}
          </button>
        ))}
      </div>
      <div className="picker-list">
        {list.map(({ t, r }) => (
          <button key={tokenKey(t)} className="token-row" onClick={() => onPick(t)} data-testid={`pick-${t.chainId}-${t.symbol}`}>
            <TokenIcon token={t} />
            <div className="token-mid">
              <div className="token-name">{t.symbol}<span className="token-chain">{CHAINS.find((c) => c.id === t.chainId)!.name}</span></div>
              <div className="token-sub">{t.name}</div>
            </div>
            <div className="token-right">
              {r ? <>
                <div className="token-usd">{fmtUsd(r.usd)}</div>
                <div className="token-sub">{fmtAmount(r.amount, t.decimals, 4)}</div>
              </> : <div className="token-sub">{prices[t.priceId] ? fmtUsd(prices[t.priceId].usd) : ''}</div>}
            </div>
          </button>
        ))}
        {list.length === 0 && <div className="empty"><p>No tokens found</p></div>}
      </div>
    </Sheet>
  );
};

export const usdOf = (t: Token, amount: bigint, prices: Record<string, { usd: number }>): number => toNumber(amount, t.decimals) * (prices[t.priceId]?.usd ?? 0);
