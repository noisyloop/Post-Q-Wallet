import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, ExternalLink, ShieldCheck } from 'lucide-react';
import { balanceOf, useWallet } from '../state';
import { HoldButton, ScreenHeader, Spinner } from '../components/common';
import { TokenIcon } from '../components/icons';
import { TokenPicker, usdOf } from '../components/TokenPicker';
import { getChain, TOKENS, type Token } from '../../core/chains/registry';
import { formatUnits } from 'viem';
import { fmtAmount, fmtUsd, maxSendable, parseAmount } from '../../core/format';
import { looksLikePoisoned, shortAddr, validateAddress } from '../../core/security';
import { sessionSigner } from '../../core/session';

type Stage = 'form' | 'review' | 'sending' | 'done' | 'error';

export const Send = ({ initial, onClose }: { initial?: Token; onClose(): void }) => {
  const { rows, prices, backend, accounts, activity, addActivity, refresh } = useWallet();
  const [token, setToken] = useState<Token>(initial ?? rows[0]?.token ?? TOKENS[0]);
  const [picking, setPicking] = useState(false);
  const [to, setTo] = useState('');
  const [amountText, setAmountText] = useState('');
  const [stage, setStage] = useState<Stage>('form');
  const [hash, setHash] = useState('');
  const [err, setErr] = useState('');
  const [ackWarn, setAckWarn] = useState(false);

  const chain = getChain(token.chainId);
  const bal = balanceOf(rows, token);
  const amount = parseAmount(amountText, token.decimals);
  const addr = validateAddress(chain.family, to);
  const own = accounts?.[chain.family] ?? '';
  const known = useMemo(() => activity.map((a) => a.counterparty).filter((x): x is string => !!x), [activity]);

  const warnings: string[] = [];
  if (addr.ok) {
    if (addr.warning) warnings.push(addr.warning);
    if (addr.normalized.toLowerCase() === own.toLowerCase()) warnings.push('You are sending to your own address');
    const lookalike = looksLikePoisoned(addr.normalized, known);
    if (lookalike) warnings.push(`Looks similar to ${shortAddr(lookalike, 6)} from your history but is NOT the same address — possible address-poisoning scam`);
    if (!known.some((k) => k.toLowerCase() === addr.normalized.toLowerCase())) warnings.push('First time sending to this address');
  }
  const blocking = warnings.filter((w) => !w.startsWith('First time'));
  const amountErr = amount === null ? (amountText ? 'Invalid amount' : '') : amount === 0n ? 'Enter an amount' : amount > bal ? 'Insufficient balance' : '';
  const canReview = addr.ok && amount !== null && amount > 0n && !amountErr;

  const submit = async () => {
    if (!addr.ok || !amount) return;
    setStage('sending');
    try {
      const h = await backend.send(token, addr.normalized, amount, sessionSigner());
      setHash(h);
      addActivity({
        id: h, kind: 'send', ts: Date.now(), title: `Sent ${token.symbol}`, subtitle: `To ${shortAddr(addr.normalized)} · ${chain.name}`,
        amount: `-${fmtAmount(amount, token.decimals)} ${token.symbol}`, status: 'confirmed', explorer: chain.explorerTx(h), counterparty: addr.normalized,
      });
      setStage('done');
      void refresh();
    } catch (e) {
      setErr((e as Error).message);
      setStage('error');
    }
  };

  if (stage === 'done' || stage === 'error' || stage === 'sending') {
    return (
      <div className="screen overlay">
        <ScreenHeader title="Send" onBack={stage === 'sending' ? undefined : onClose} />
        <div className="result">
          {stage === 'sending' && <><Spinner size={48} /><h3>Signing & broadcasting…</h3></>}
          {stage === 'done' && <>
            <div className="result-icon ok"><CheckCircle2 size={56} /></div>
            <h3>Sent!</h3>
            <p className="muted">{fmtAmount(amount!, token.decimals)} {token.symbol} to {shortAddr(to.trim(), 6)}</p>
            <a className="link" href={chain.explorerTx(hash)} target="_blank" rel="noopener noreferrer">View on explorer <ExternalLink size={14} /></a>
            <button className="btn primary" onClick={onClose}>Done</button>
          </>}
          {stage === 'error' && <>
            <div className="result-icon bad"><AlertTriangle size={56} /></div>
            <h3>Transaction failed</h3>
            <p className="muted">{err}</p>
            <button className="btn secondary" onClick={() => setStage('form')}>Try again</button>
          </>}
        </div>
      </div>
    );
  }

  if (stage === 'review' && addr.ok && amount) {
    return (
      <div className="screen overlay">
        <ScreenHeader title="Review" onBack={() => setStage('form')} />
        <div className="review">
          <div className="review-hero">
            <TokenIcon token={token} size={56} />
            <div className="review-amt">{fmtAmount(amount, token.decimals)} {token.symbol}</div>
            <div className="muted">{fmtUsd(usdOf(token, amount, prices))}</div>
          </div>
          <div className="kv">
            <div><span>To</span><b className="mono">{shortAddr(addr.normalized, 8)}</b></div>
            <div><span>Network</span><b>{chain.name}</b></div>
            <div><span>From</span><b className="mono">{shortAddr(own, 6)}</b></div>
          </div>
          {warnings.length > 0 && (
            <div className="warn-box">
              {warnings.map((w) => <div key={w}><AlertTriangle size={16} />{w}</div>)}
              {blocking.length > 0 && (
                <label className="check-row"><input type="checkbox" checked={ackWarn} onChange={(e) => setAckWarn(e.target.checked)} />I verified the full address</label>
              )}
            </div>
          )}
          <div className="secure-note"><ShieldCheck size={16} /> Signed locally — your key never leaves this device</div>
        </div>
        <div className="ob-foot">
          <HoldButton label="Hold to send" onConfirm={submit} disabled={blocking.length > 0 && !ackWarn} />
        </div>
      </div>
    );
  }

  return (
    <div className="screen overlay">
      <ScreenHeader title="Send" onBack={onClose} />
      <div className="form">
        <button className="token-select" onClick={() => setPicking(true)} data-testid="send-token">
          <TokenIcon token={token} size={36} />
          <div><b>{token.symbol}</b><small>{chain.name} · Balance {fmtAmount(bal, token.decimals, 5)}</small></div>
          <ChevronDown size={18} />
        </button>
        <label className="label">Recipient</label>
        <textarea
          className={`input addr-input ${to && !addr.ok ? 'invalid' : ''}`}
          rows={2}
          value={to}
          spellCheck={false}
          autoComplete="off"
          placeholder={chain.family === 'evm' ? '0x…' : chain.family === 'solana' ? 'Solana address' : 'bc1…'}
          onChange={(e) => setTo(e.target.value)}
          data-testid="send-to"
        />
        {to && !addr.ok && <div className="field-error">{addr.error}</div>}
        {addr.ok && <div className="field-ok">✓ Valid {chain.name} address</div>}
        <label className="label">Amount</label>
        <div className="amount-box">
          <input className="amount-input" inputMode="decimal" placeholder="0" value={amountText} onChange={(e) => setAmountText(e.target.value.replace(',', '.'))} data-testid="send-amount" />
          <span className="amount-sym">{token.symbol}</span>
          <button className="chip small" onClick={() => setAmountText(formatUnits(maxSendable(token, bal), token.decimals))}>Max</button>
        </div>
        <div className="muted small">{amount ? fmtUsd(usdOf(token, amount, prices)) : '$0.00'}{amountErr && <span className="field-error inline"> · {amountErr}</span>}</div>
      </div>
      <div className="ob-foot">
        <button className="btn primary" disabled={!canReview} onClick={() => { setAckWarn(false); setStage('review'); }} data-testid="send-review">Review</button>
      </div>
      {picking && <TokenPicker title="Select asset" onlyOwned onClose={() => setPicking(false)} onPick={(t) => { setToken(t); setPicking(false); setTo(''); setAmountText(''); }} />}
    </div>
  );
};
