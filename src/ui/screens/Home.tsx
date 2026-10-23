import { useMemo, useState } from 'react';
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Copy, Eye, EyeOff, Layers, RefreshCw } from 'lucide-react';
import { useWallet, type Row } from '../state';
import { Avatar } from '../components/icons';
import { TokenRow } from '../components/common';
import { CHAINS } from '../../core/chains/registry';
import { fmtPct, fmtUsd } from '../../core/format';
import { shortAddr } from '../../core/security';

export const Home = ({ onSend, onReceive, onSwap, onBridge }: { onSend(r?: Row): void; onReceive(): void; onSwap(): void; onBridge(): void }) => {
  const { rows, accounts, loading, refresh, showToast, demo } = useWallet();
  const [chain, setChain] = useState<string>('all');
  const [hidden, setHidden] = useState(false);

  const total = rows.reduce((s, r) => s + r.usd, 0);
  const prevTotal = rows.reduce((s, r) => s + r.usd / (1 + r.change24h / 100), 0);
  const delta = total - prevTotal;
  const deltaPct = prevTotal ? (delta / prevTotal) * 100 : 0;

  const chainsWithFunds = useMemo(() => CHAINS.filter((c) => rows.some((r) => r.token.chainId === c.id)), [rows]);
  const visible = chain === 'all' ? rows : rows.filter((r) => r.token.chainId === chain);

  const copy = async () => {
    if (!accounts) return;
    await navigator.clipboard?.writeText(accounts.evm).catch(() => undefined);
    showToast('EVM address copied');
  };

  return (
    <div className="screen home">
      <header className="home-head">
        <button className="account-btn" onClick={copy} data-testid="account-btn">
          <Avatar seed={accounts?.evm ?? 'x'} />
          <div>
            <div className="account-name">Account 1 {demo && <span className="pill demo">DEMO</span>}</div>
            <div className="account-addr">{accounts ? shortAddr(accounts.evm) : ''} <Copy size={12} /></div>
          </div>
        </button>
        <div className="head-actions">
          <button className="icon-btn" onClick={() => setHidden(!hidden)} aria-label="Hide balances">{hidden ? <EyeOff size={20} /> : <Eye size={20} />}</button>
          <button className={`icon-btn ${loading ? 'spin' : ''}`} onClick={() => void refresh()} aria-label="Refresh"><RefreshCw size={20} /></button>
        </div>
      </header>

      <section className="balance">
        <div className="balance-total" data-testid="total-balance">{hidden ? '$•••••' : fmtUsd(total)}</div>
        {!hidden && (
          <div className={`balance-delta ${delta >= 0 ? 'up' : 'down'}`}>
            <span>{delta >= 0 ? '+' : '-'}{fmtUsd(Math.abs(delta))}</span>
            <span className="delta-pill">{fmtPct(deltaPct)}</span>
          </div>
        )}
      </section>

      <section className="actions">
        <button className="action" onClick={onReceive} data-testid="action-receive"><span><ArrowDownLeft size={22} /></span>Receive</button>
        <button className="action" onClick={() => onSend()} data-testid="action-send"><span><ArrowUpRight size={22} /></span>Send</button>
        <button className="action" onClick={onSwap} data-testid="action-swap"><span><ArrowLeftRight size={22} /></span>Swap</button>
        <button className="action" onClick={onBridge} data-testid="action-bridge"><span><Layers size={22} /></span>Bridge</button>
      </section>

      <div className="chips scroll-x">
        <button className={`chip ${chain === 'all' ? 'active' : ''}`} onClick={() => setChain('all')}>All chains</button>
        {chainsWithFunds.map((c) => (
          <button key={c.id} className={`chip ${chain === c.id ? 'active' : ''}`} onClick={() => setChain(c.id)} data-testid={`chip-${c.id}`}>
            <span className="chain-dot" style={{ background: c.color }} />{c.name}
          </button>
        ))}
      </div>

      <section className="token-list" data-testid="token-list">
        {visible.length === 0 && !loading && (
          <div className="empty">
            <p>No assets yet</p>
            <button className="btn secondary small" onClick={onReceive}>Receive crypto</button>
          </div>
        )}
        {loading && rows.length === 0 && [0, 1, 2, 3].map((i) => <div key={i} className="token-row skeleton" />)}
        {visible.map((r) => <TokenRow key={`${r.token.chainId}:${r.token.symbol}`} row={r} hideValue={hidden} onClick={() => onSend(r)} />)}
      </section>
    </div>
  );
};
