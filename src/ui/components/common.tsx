import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, Eye, EyeOff, X } from 'lucide-react';
import type { Row } from '../state';
import { fmtAmount, fmtPct, fmtUsd } from '../../core/format';
import { getChain } from '../../core/chains/registry';
import { TokenIcon } from './icons';

export const Sheet = ({ title, onClose, children, tall }: { title: string; onClose(): void; children: ReactNode; tall?: boolean }) => {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className={`sheet ${tall ? 'tall' : ''}`} role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grab" />
        <div className="sheet-head">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={20} /></button>
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
};

export const ScreenHeader = ({ title, onBack, right }: { title: string; onBack?: () => void; right?: ReactNode }) => (
  <header className="screen-head">
    {onBack ? <button className="icon-btn" onClick={onBack} aria-label="Back"><ArrowLeft size={22} /></button> : <span className="icon-btn-spacer" />}
    <h2>{title}</h2>
    {right ?? <span className="icon-btn-spacer" />}
  </header>
);

/**
 * Press-and-hold confirmation. Prevents accidental taps / clickjacking-style
 * single-click approvals of value-moving actions.
 */
export const HoldButton = ({ label, onConfirm, disabled, ms = 1200, danger }: { label: string; onConfirm(): void; disabled?: boolean; ms?: number; danger?: boolean }) => {
  const [progress, setProgress] = useState(0);
  const raf = useRef<number>();
  const start = useRef(0);
  const done = useRef(false);

  const stop = () => {
    if (raf.current) cancelAnimationFrame(raf.current);
    if (!done.current) setProgress(0);
  };
  const begin = () => {
    if (disabled || done.current) return;
    start.current = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - start.current) / ms);
      setProgress(p);
      if (p >= 1) {
        done.current = true;
        onConfirm();
        return;
      }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  };
  useEffect(() => () => { if (raf.current) cancelAnimationFrame(raf.current); }, []);

  return (
    <button
      className={`btn primary hold ${danger ? 'danger' : ''}`}
      disabled={disabled}
      onPointerDown={begin}
      onPointerUp={stop}
      onPointerLeave={stop}
      onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) begin(); }}
      onKeyUp={stop}
      data-testid="hold-button"
    >
      <span className="hold-fill" style={{ transform: `scaleX(${progress})` }} />
      <span className="hold-label">{progress > 0 && progress < 1 ? 'Keep holding…' : label}</span>
    </button>
  );
};

export const TokenRow = ({ row, onClick, hideValue }: { row: Row; onClick?: () => void; hideValue?: boolean }) => (
  <button className="token-row" onClick={onClick}>
    <TokenIcon token={row.token} />
    <div className="token-mid">
      <div className="token-name">{row.token.name}{getChain(row.token.chainId).name !== row.token.name && <span className="token-chain">{getChain(row.token.chainId).name}</span>}</div>
      <div className="token-sub">{hideValue ? '••••' : `${fmtAmount(row.amount, row.token.decimals, 4)} ${row.token.symbol}`}</div>
    </div>
    <div className="token-right">
      <div className="token-usd">{hideValue ? '••••' : fmtUsd(row.usd)}</div>
      <div className={`token-chg ${row.change24h >= 0 ? 'up' : 'down'}`}>{fmtPct(row.change24h)}</div>
    </div>
  </button>
);

export const PasswordField = ({ value, onChange, placeholder, autoFocus, testId }: { value: string; onChange(v: string): void; placeholder: string; autoFocus?: boolean; testId?: string }) => {
  const [show, setShow] = useState(false);
  return (
    <div className="input-wrap">
      <input
        className="input"
        type={show ? 'text' : 'password'}
        value={value}
        placeholder={placeholder}
        autoFocus={autoFocus}
        autoComplete="new-password"
        spellCheck={false}
        data-testid={testId}
        onChange={(e) => onChange(e.target.value)}
      />
      <button type="button" className="input-icon" onClick={() => setShow(!show)} aria-label={show ? 'Hide' : 'Show'}>
        {show ? <EyeOff size={18} /> : <Eye size={18} />}
      </button>
    </div>
  );
};

export const Spinner = ({ size = 18 }: { size?: number }) => <span className="spinner" style={{ width: size, height: size }} />;
