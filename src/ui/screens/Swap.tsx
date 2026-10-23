import { useEffect, useMemo, useRef, useState } from 'react';
import { formatUnits } from 'viem';
import {
  AlertTriangle, ArrowDown, Check, CheckCircle2, ChevronDown, Clock, ExternalLink, Fuel, Route, Settings2, ShieldAlert, ShieldCheck, XCircle,
} from 'lucide-react';
import { balanceOf, useWallet } from '../state';
import { HoldButton, ScreenHeader, Sheet, Spinner } from '../components/common';
import { TokenIcon } from '../components/icons';
import { TokenPicker, usdOf } from '../components/TokenPicker';
import { findToken, getChain, type Token } from '../../core/chains/registry';
import { fmtAmount, fmtDuration, fmtUsd, maxSendable, parseAmount, toNumber } from '../../core/format';
import { hasBlocker, hasWarning, QUOTE_TTL_MS, validateQuote, type SafetyCheck } from '../../core/swap/validate';
import type { QuoteRequest, SwapProgress, SwapQuote } from '../../core/swap/types';
import { sessionSigner } from '../../core/session';

const SLIPPAGES = [0.003, 0.005, 0.01, 0.03];

const PHASES: { key: SwapProgress['phase']; label: string }[] = [
  { key: 'approving', label: 'Approve token' },
  { key: 'signing', label: 'Sign transaction' },
  { key: 'submitted', label: 'Confirm on source chain' },
  { key: 'bridging', label: 'Bridge to destination' },
  { key: 'done', label: 'Complete' },
];

export const Swap = ({ preset, onClose }: { preset?: 'bridge'; onClose?: () => void }) => {
  const { rows, prices, backend, accounts, addActivity, refresh, showToast } = useWallet();
  const [from, setFrom] = useState<Token>(() => rows[0]?.token ?? findToken('ethereum:native')!);
  const [to, setTo] = useState<Token>(() => findToken(preset === 'bridge' ? 'base:native' : 'solana:native')!);
  const [amountText, setAmountText] = useState('');
  const [slippage, setSlippage] = useState(0.005);
  const [picker, setPicker] = useState<'from' | 'to' | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [quote, setQuote] = useState<SwapQuote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [quoteErr, setQuoteErr] = useState('');
  // The quote being reviewed/executed is pinned so balance refreshes or new
  // quotes can't swap it out from under the user mid-flow.
  const [active, setActive] = useState<SwapQuote | null>(null);
  const [progress, setProgress] = useState<SwapProgress | null>(null);
  const [seen, setSeen] = useState<SwapProgress['phase'][]>([]);
  const [ackWarn, setAckWarn] = useState(false);
  const [now, setNow] = useState(Date.now());
  const abort = useRef<AbortController>();

  const amount = parseAmount(amountText, from.decimals);
  const bal = balanceOf(rows, from);
  const insufficient = amount !== null && amount > bal;

  const req: QuoteRequest | null = useMemo(() => {
    if (!accounts || !amount || amount === 0n) return null;
    return {
      from, to, fromAmount: amount, slippage,
      fromAddress: accounts[getChain(from.chainId).family],
      toAddress: accounts[getChain(to.chainId).family],
    };
  }, [accounts, amount, from, to, slippage]);

  // Debounced quote fetch.
  useEffect(() => {
    setQuote(null);
    setQuoteErr('');
    if (!req || insufficient) return;
    if (from.chainId === to.chainId && from.address === to.address) { setQuoteErr('Choose two different tokens'); return; }
    const t = setTimeout(async () => {
      abort.current?.abort();
      const ac = new AbortController();
      abort.current = ac;
      setQuoting(true);
      try {
        const q = await backend.quote(req, ac.signal);
        if (!ac.signal.aborted) setQuote(q);
      } catch (e) {
        if (!ac.signal.aborted) setQuoteErr((e as Error).message);
      } finally {
        if (!ac.signal.aborted) setQuoting(false);
      }
    }, 450);
    return () => clearTimeout(t);
  }, [req, backend, insufficient, from, to]);

  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(i);
  }, []);

  const checks: SafetyCheck[] = useMemo(() => (quote && req ? validateQuote(quote, req, now) : []), [quote, req, now]);
  const activeChecks: SafetyCheck[] = useMemo(() => (active ? validateQuote(active, {
    from: active.from, to: active.to, fromAmount: active.fromAmount, fromAddress: active.fromAddress, toAddress: active.toAddress, slippage: active.slippage,
  }, now) : []), [active, now]);
  const expired = quote ? now - quote.fetchedAt >= QUOTE_TTL_MS : false;
  const activeExpired = active ? now - active.fetchedAt >= QUOTE_TTL_MS : false;
  const review = active !== null;
  const activeCross = active ? active.from.chainId !== active.to.chainId : false;
  const crossChain = from.chainId !== to.chainId;

  // Keep the on-screen quote fresh while the user is still deciding.
  useEffect(() => {
    if (expired && !review && !quoting) void refreshQuote();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expired, review]);

  const flip = () => {
    setFrom(to);
    setTo(from);
    setAmountText('');
  };

  const refreshQuote = async () => {
    if (!req) return;
    setQuoting(true);
    try {
      const q = await backend.quote(req);
      setQuote(q);
      if (active && !progress) setActive(q);
    } catch (e) { setQuoteErr((e as Error).message); } finally { setQuoting(false); }
  };

  const execute = async () => {
    const quote = active;
    if (!quote) return;
    setSeen([]);
    setProgress({ phase: 'signing', message: 'Preparing' });
    try {
      const final = await backend.executeSwap(quote, sessionSigner(), (p) => {
        setProgress(p);
        setSeen((s) => (s.includes(p.phase) ? s : [...s, p.phase]));
      });
      setProgress(final);
      setSeen((s) => [...s, final.phase]);
      if (final.srcHash) {
        addActivity({
          id: final.srcHash, kind: 'swap', ts: Date.now(),
          title: quote.from.chainId !== quote.to.chainId ? `Bridged ${quote.from.symbol} → ${quote.to.symbol}` : `Swapped ${quote.from.symbol} → ${quote.to.symbol}`,
          subtitle: `${getChain(quote.from.chainId).name} → ${getChain(quote.to.chainId).name} · ${quote.toolName}`,
          amount: `+${fmtAmount(quote.toAmount, quote.to.decimals, 4)} ${quote.to.symbol}`,
          status: final.phase === 'done' ? 'confirmed' : final.phase === 'failed' ? 'failed' : 'pending',
          explorer: getChain(quote.from.chainId).explorerTx(final.srcHash),
        });
      }
      void refresh();
    } catch (e) {
      setProgress({ phase: 'failed', message: (e as Error).message });
    }
  };

  const closeReview = () => {
    setActive(null);
    if (progress?.phase === 'done') {
      setProgress(null);
      setQuote(null);
      setAmountText('');
      showToast('Swap complete');
    } else if (progress?.phase === 'failed') setProgress(null);
  };

  const fromUsd = amount ? usdOf(from, amount, prices) : 0;
  const toUsd = quote ? usdOf(to, quote.toAmount, prices) : 0;
  const rate = quote ? toNumber(quote.toAmount, to.decimals) / toNumber(quote.fromAmount, from.decimals) : 0;

  const cta = !amount ? 'Enter an amount' : insufficient ? `Insufficient ${from.symbol}` : quoting ? 'Finding best route…' : quoteErr ? 'No route available' : !quote ? 'Enter an amount' : hasBlocker(checks) ? 'Quote failed safety checks' : 'Review swap';

  return (
    <div className={`screen swap ${onClose ? 'overlay' : ''}`}>
      <ScreenHeader
        title={preset === 'bridge' ? 'Bridge' : 'Swap'}
        onBack={onClose}
        right={<button className="icon-btn" onClick={() => setShowSettings(true)} aria-label="Swap settings"><Settings2 size={20} /></button>}
      />

      <div className="swap-cards">
        <div className="swap-card">
          <div className="swap-card-head"><span>You pay</span><span className="muted">Balance {fmtAmount(bal, from.decimals, 5)}</span></div>
          <div className="swap-card-main">
            <input
              className="swap-amount"
              inputMode="decimal"
              placeholder="0"
              value={amountText}
              onChange={(e) => setAmountText(e.target.value.replace(',', '.'))}
              data-testid="swap-amount"
            />
            <button className="token-pill" onClick={() => setPicker('from')} data-testid="swap-from">
              <TokenIcon token={from} size={28} /><span><b>{from.symbol}</b><small>{getChain(from.chainId).name}</small></span><ChevronDown size={16} />
            </button>
          </div>
          <div className="swap-card-foot">
            <span className="muted">{fmtUsd(fromUsd)}</span>
            <span className="quick">
              {[0.25, 0.5].map((f) => (
                <button key={f} className="chip small" onClick={() => setAmountText(formatUnits((maxSendable(from, bal) * BigInt(f * 100)) / 100n, from.decimals))}>{f * 100}%</button>
              ))}
              <button className="chip small" onClick={() => setAmountText(formatUnits(maxSendable(from, bal), from.decimals))}>Max</button>
            </span>
          </div>
        </div>

        <button className="flip" onClick={flip} aria-label="Flip"><ArrowDown size={20} /></button>

        <div className="swap-card">
          <div className="swap-card-head"><span>You receive</span>{crossChain && <span className="xchain-pill">Cross-chain</span>}</div>
          <div className="swap-card-main">
            <div className={`swap-amount out ${quoting ? 'loading' : ''}`} data-testid="swap-out">
              {quote ? fmtAmount(quote.toAmount, to.decimals, 6) : quoting ? '…' : '0'}
            </div>
            <button className="token-pill" onClick={() => setPicker('to')} data-testid="swap-to">
              <TokenIcon token={to} size={28} /><span><b>{to.symbol}</b><small>{getChain(to.chainId).name}</small></span><ChevronDown size={16} />
            </button>
          </div>
          <div className="swap-card-foot"><span className="muted">{quote ? fmtUsd(toUsd) : '$0.00'}</span></div>
        </div>
      </div>

      {quote && (
        <div className="quote-card" data-testid="quote-card">
          <div className="quote-row"><span>Rate</span><b>1 {from.symbol} ≈ {rate.toLocaleString('en-US', { maximumFractionDigits: 6 })} {to.symbol}</b></div>
          <div className="quote-row"><span><Route size={14} /> Route</span><b className="route">{quote.route.join(' → ')}</b></div>
          <div className="quote-row"><span><Clock size={14} /> Est. time</span><b>{fmtDuration(quote.durationSec)}</b></div>
          <div className="quote-row"><span><Fuel size={14} /> Network + bridge fees</span><b>{fmtUsd(quote.gasUsd + quote.feeUsd)}</b></div>
          <div className="quote-row"><span>Minimum received</span><b>{fmtAmount(quote.toAmountMin, to.decimals, 6)} {to.symbol}</b></div>
          <div className={`quote-row safety ${hasBlocker(checks) ? 'bad' : hasWarning(checks) ? 'warn' : 'ok'}`}>
            <span>{hasBlocker(checks) ? <ShieldAlert size={14} /> : <ShieldCheck size={14} />} Safety checks</span>
            <b>{checks.filter((c) => c.ok).length}/{checks.length} passed</b>
          </div>
        </div>
      )}
      {quoteErr && <div className="warn-box"><div><AlertTriangle size={16} />{quoteErr}</div></div>}

      <div className="swap-foot">
        <button
          className="btn primary"
          disabled={!quote || quoting || hasBlocker(checks) || insufficient}
          onClick={() => { setAckWarn(false); setActive(quote); }}
          data-testid="swap-review"
        >{cta}</button>
      </div>

      {picker && (
        <TokenPicker
          title={picker === 'from' ? 'You pay' : 'You receive'}
          onlyOwned={picker === 'from'}
          onClose={() => setPicker(null)}
          onPick={(t) => {
            if (picker === 'from') { setFrom(t); setAmountText(''); } else setTo(t);
            setPicker(null);
          }}
        />
      )}

      {showSettings && (
        <Sheet title="Swap settings" onClose={() => setShowSettings(false)}>
          <label className="label">Max slippage</label>
          <div className="seg">
            {SLIPPAGES.map((s) => <button key={s} className={slippage === s ? 'active' : ''} onClick={() => setSlippage(s)}>{(s * 100).toFixed(1)}%</button>)}
          </div>
          <p className="muted small">If the price moves more than this before your transaction confirms, it reverts and you keep your funds. Bridges refund on the source chain on failure.</p>
        </Sheet>
      )}

      {active && (
        <Sheet title={progress ? (progress.phase === 'done' ? 'Success' : progress.phase === 'failed' ? 'Failed' : 'Swapping') : 'Review swap'} onClose={progress && !['done', 'failed'].includes(progress.phase) ? () => undefined : closeReview} tall>
          <div className="review-pair">
            <div><TokenIcon token={active.from} size={44} /><b>{fmtAmount(active.fromAmount, active.from.decimals, 6)} {active.from.symbol}</b><small>{getChain(active.from.chainId).name}</small></div>
            <div className="review-arrow"><ArrowDown size={18} /></div>
            <div><TokenIcon token={active.to} size={44} /><b>{fmtAmount(active.toAmount, active.to.decimals, 6)} {active.to.symbol}</b><small>{getChain(active.to.chainId).name}</small></div>
          </div>

          {!progress && <>
            <div className="checks" data-testid="safety-checks">
              {activeChecks.map((c) => (
                <div key={c.label} className={`check ${c.level}`}>
                  {c.level === 'ok' ? <Check size={16} /> : c.level === 'warn' ? <AlertTriangle size={16} /> : <XCircle size={16} />}
                  <span>{c.label}{c.level !== 'ok' && c.detail && <small>{c.detail}</small>}</span>
                </div>
              ))}
            </div>
            <div className="kv compact">
              <div><span>Provider</span><b>{active.toolName} via LI.FI</b></div>
              <div><span>Receiving address</span><b className="mono">{active.toAddress.slice(0, 6)}…{active.toAddress.slice(-4)} (you)</b></div>
              <div><span>Slippage</span><b>{(active.slippage * 100).toFixed(1)}%</b></div>
              {active.approvalAddress && <div><span>Token approval</span><b>Exact amount only</b></div>}
            </div>
            {hasWarning(activeChecks) && (
              <label className="check-row"><input type="checkbox" checked={ackWarn} onChange={(e) => setAckWarn(e.target.checked)} />I understand the warnings above</label>
            )}
            {activeExpired
              ? <button className="btn secondary" onClick={() => void refreshQuote()}>Quote expired — refresh</button>
              : <HoldButton label={`Hold to ${activeCross ? 'bridge' : 'swap'}`} onConfirm={() => void execute()} disabled={hasBlocker(activeChecks) || (hasWarning(activeChecks) && !ackWarn)} />}
            <div className="muted small center">Quote refreshes in {Math.max(0, Math.ceil((QUOTE_TTL_MS - (now - active.fetchedAt)) / 1000))}s</div>
          </>}

          {progress && (
            <div className="progress" data-testid="swap-progress">
              {PHASES.filter((p) => (p.key !== 'approving' || (active.from.address && getChain(active.from.chainId).family === 'evm')) && (p.key !== 'bridging' || activeCross)).map((p) => {
                const isActive = progress.phase === p.key;
                const doneStep = (seen.includes(p.key) && !isActive) || progress.phase === 'done';
                return (
                  <div key={p.key} className={`pstep ${doneStep ? 'done' : isActive ? 'active' : ''}`}>
                    <span className="pdot">{doneStep ? <Check size={14} /> : isActive ? <Spinner size={14} /> : null}</span>
                    <span>{p.label}{isActive && progress.phase !== 'done' && <small>{progress.message}</small>}</span>
                  </div>
                );
              })}
              {progress.phase === 'done' && (
                <div className="result compact">
                  <div className="result-icon ok rainbow"><CheckCircle2 size={48} /></div>
                  <h3>{fmtAmount(active.toAmount, active.to.decimals, 6)} {active.to.symbol} received</h3>
                  {progress.srcHash && <a className="link" href={getChain(active.from.chainId).explorerTx(progress.srcHash)} target="_blank" rel="noopener noreferrer">Source tx <ExternalLink size={14} /></a>}
                  {progress.dstHash && <a className="link" href={getChain(active.to.chainId).explorerTx(progress.dstHash)} target="_blank" rel="noopener noreferrer">Destination tx <ExternalLink size={14} /></a>}
                  <button className="btn primary" onClick={closeReview} data-testid="swap-done">Done</button>
                </div>
              )}
              {progress.phase === 'failed' && (
                <div className="result compact">
                  <div className="result-icon bad"><XCircle size={48} /></div>
                  <p className="muted">{progress.message}</p>
                  <button className="btn secondary" onClick={closeReview}>Close</button>
                </div>
              )}
            </div>
          )}
        </Sheet>
      )}
    </div>
  );
};
