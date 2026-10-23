import { useEffect, useMemo, useState } from 'react';
import { formatUnits, parseUnits } from 'viem';
import {
  AlertTriangle, Check, CheckCircle2, Clock, Copy, Download, ExternalLink, FileJson, Lock, Rocket, ShieldCheck, Snowflake, Zap,
} from 'lucide-react';
import { balanceOf, useWallet } from '../state';
import { HoldButton, ScreenHeader, Sheet, Spinner } from '../components/common';
import { ChainBadge } from '../components/icons';
import { findToken } from '../../core/chains/registry';
import { fmtUsd } from '../../core/format';
import { shortAddr } from '../../core/security';
import { sessionSigner } from '../../core/session';
import {
  END_FEE_OPTIONS, fmtBps, fmtSecs, roundBps, LAUNCH_COST_LAMPORTS, MAX_CREATOR_PCT, OPEN_DELAYS, planLaunch, TAX_PRESETS, validateMetadata,
  type LaunchConfig,
} from '../../core/launch/plan';
import { sniperTaxAt, type SniperTax } from '../../core/launch/meteora';
import { configFromJson } from '../../core/launch/record';
import type { LaunchPhase, LaunchRecord } from '../../core/backend/types';

type Preset = keyof typeof TAX_PRESETS;

const fmtSol = (lamports: bigint) => Number(formatUnits(lamports, 9)).toLocaleString('en-US', { maximumFractionDigits: 4 });

const STEPS: { key: LaunchPhase; label: string }[] = [
  { key: 'token', label: 'Create token & revoke mint authority' },
  { key: 'pool', label: 'Create pool with sniper tax + lock liquidity' },
  { key: 'done', label: 'Live' },
];

const TokenAvatar = ({ symbol, size = 56 }: { symbol: string; size?: number }) => {
  let h = 0;
  for (const ch of symbol || '?') h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const a = h % 360;
  return (
    <span className="avatar launch-avatar" style={{ width: size, height: size, fontSize: size * 0.4, background: `linear-gradient(135deg, hsl(${a} 90% 60%), hsl(${(a + 80) % 360} 90% 55%))` }}>
      {(symbol || '?').slice(0, 1).toUpperCase()}
    </span>
  );
};

/** Fee-over-time sparkline for the sniper tax. */
const TaxChart = ({ tax }: { tax: SniperTax }) => {
  const W = 300, H = 74, span = tax.durationSec * 1.25;
  const pts = Array.from({ length: 61 }, (_, i) => {
    const t = (span * i) / 60;
    return `${(W * i) / 60},${H - 4 - ((H - 12) * sniperTaxAt(tax, t)) / 9900}`;
  });
  return (
    <svg className="tax-chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-label="Sniper tax over time">
      <defs>
        <linearGradient id="taxfill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ff5c7a" stopOpacity=".45" />
          <stop offset="1" stopColor="#ff5c7a" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`0,${H} ${pts.join(' ')} ${W},${H}`} fill="url(#taxfill)" />
      <polyline points={pts.join(' ')} fill="none" stroke="#ff5c7a" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
};

const MetadataHelper = ({ name, symbol, onClose }: { name: string; symbol: string; onClose(): void }) => {
  const [desc, setDesc] = useState('');
  const [image, setImage] = useState('');
  const [site, setSite] = useState('');
  const [x, setX] = useState('');
  const [tg, setTg] = useState('');
  const download = () => {
    const json = {
      name, symbol, description: desc, image,
      ...(site || x || tg ? { extensions: { ...(site && { website: site }), ...(x && { twitter: x }), ...(tg && { telegram: tg }) } } : {}),
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${symbol || 'token'}-metadata.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <Sheet title="Metadata JSON" onClose={onClose} tall>
      <p className="muted small">Wallets and explorers read your logo and links from a JSON file. Fill this in, download it, upload it with your image to IPFS or Arweave, then paste the file's link as the Metadata URI.</p>
      <input className="input" placeholder="Description" value={desc} onChange={(e) => setDesc(e.target.value)} />
      <input className="input" placeholder="Image URL (https:// or ipfs://)" value={image} onChange={(e) => setImage(e.target.value)} />
      <input className="input" placeholder="Website" value={site} onChange={(e) => setSite(e.target.value)} />
      <input className="input" placeholder="X / Twitter" value={x} onChange={(e) => setX(e.target.value)} />
      <input className="input" placeholder="Telegram" value={tg} onChange={(e) => setTg(e.target.value)} />
      <button className="btn secondary" onClick={download}><Download size={16} /> Download metadata.json</button>
    </Sheet>
  );
};

const LaunchLinks = ({ r }: { r: LaunchRecord }) => (
  <div className="launch-links">
    <a href={`https://solscan.io/token/${r.mint}`} target="_blank" rel="noopener noreferrer">Solscan <ExternalLink size={12} /></a>
    {r.pool && <a href={`https://app.meteora.ag/dammv2/${r.pool}`} target="_blank" rel="noopener noreferrer">Meteora <ExternalLink size={12} /></a>}
    {r.pool && <a href={`https://dexscreener.com/solana/${r.pool}`} target="_blank" rel="noopener noreferrer">DexScreener <ExternalLink size={12} /></a>}
  </div>
);

export const Launch = () => {
  const { rows, prices, backend, accounts, launches, saveLaunch, refresh, showToast, addActivity } = useWallet();
  const [name, setName] = useState('');
  const [symbol, setSymbol] = useState('');
  const [uri, setUri] = useState('');
  const [supplyText, setSupplyText] = useState('1000000000');
  const [solText, setSolText] = useState('5');
  const [creatorPct, setCreatorPct] = useState(0);
  const [preset, setPreset] = useState<Preset>('standard');
  const [endBps, setEndBps] = useState(100);
  const [delay, setDelay] = useState(900);
  const [review, setReview] = useState(false);
  const [ack, setAck] = useState(false);
  const [mdHelper, setMdHelper] = useState(false);
  const [phase, setPhase] = useState<LaunchPhase | null>(null);
  const [result, setResult] = useState<LaunchRecord | null>(null);
  const [err, setErr] = useState('');
  const [resume, setResume] = useState<LaunchRecord | null>(null);

  // Re-evaluate time-based validation (opening time) while the form is open.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const i = setInterval(() => setTick((t) => t + 1), 15_000);
    return () => clearInterval(i);
  }, []);

  const solToken = findToken('solana:native')!;
  const solBal = balanceOf(rows, solToken);
  const solUsd = prices.solana?.usd ?? 0;

  const config: LaunchConfig = useMemo(() => {
    let solLiquidity = 0n;
    try { solLiquidity = parseUnits(solText || '0', 9); } catch { /* invalid input */ }
    const supply = /^\d{1,14}$/.test(supplyText) ? BigInt(supplyText) : 0n;
    const { label: _l, ...t } = TAX_PRESETS[preset];
    return {
      name, symbol: symbol.toUpperCase(), uri, supply, solLiquidity, creatorPct,
      tax: { ...t, endBps },
      // Resolved to an absolute time when the plan is built (and again at launch).
      openAt: delay ? Math.floor(Date.now() / 1000) + delay : null,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, symbol, uri, supplyText, solText, creatorPct, preset, endBps, delay, tick]);

  const plan = useMemo(() => planLaunch(config, solBal), [config, solBal]);
  const metaErrors = validateMetadata(config);
  const canReview = plan.errors.length === 0;

  const start = async () => {
    setErr('');
    setPhase('token');
    // Re-plan with a fresh opening time so the delay is measured from now.
    const fresh = planLaunch({ ...config, openAt: delay ? Math.floor(Date.now() / 1000) + delay : null }, solBal);
    try {
      const r = await backend.launchToken(fresh, sessionSigner(), (p) => setPhase(p.phase), saveLaunch);
      setResult(r);
      addActivity({
        id: r.poolTx ?? r.id, kind: 'launch', ts: Date.now(), title: `Launched $${r.symbol}`,
        subtitle: `Solana · ${fmtSol(fresh.poolB)} SOL locked in pool`, amount: `-${fmtSol(fresh.poolB)} SOL`,
        status: 'confirmed', explorer: `https://solscan.io/token/${r.mint}`,
      });
      void refresh();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const finishResume = async (r: LaunchRecord) => {
    setResume(r);
    setErr('');
    setResult(null);
    setReview(true);
    setPhase('pool');
    const now = Math.floor(Date.now() / 1000);
    const cfg = configFromJson(r.config);
    const p = planLaunch({ ...cfg, openAt: cfg.openAt && cfg.openAt > now + 60 ? cfg.openAt : now + 300 }, solBal);
    try {
      const done = await backend.launchToken(p, sessionSigner(), (x) => setPhase(x.phase), saveLaunch, r);
      setResult(done);
      void refresh();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const closeReview = () => {
    if (phase && phase !== 'done' && !err) return;
    setReview(false);
    setPhase(null);
    setAck(false);
    setResume(null);
    if (result) {
      setResult(null);
      setName('');
      setSymbol('');
      setUri('');
      showToast('Token launched');
    }
  };

  const copy = async (v: string) => {
    await navigator.clipboard?.writeText(v).catch(() => undefined);
    showToast('Copied');
  };

  const mcapUsd = plan.startMcapSol * solUsd;
  const reviewName = resume?.name ?? config.name;
  const reviewSymbol = resume?.symbol ?? config.symbol;

  return (
    <div className="screen launch">
      <ScreenHeader title="Launch a token" right={<span className="net-pill"><ChainBadge chainId="solana" size={14} />Solana</span>} />

      <div className="launch-hero">
        <TokenAvatar symbol={config.symbol} />
        <div>
          <b>Fair launch, no insiders</b>
          <small>100% of supply goes into a locked pool. A decaying sniper tax makes first-block bots pay up to {fmtBps(TAX_PRESETS.max.startBps)} — straight into your LP.</small>
        </div>
      </div>

      <section className="card">
        <h4 className="card-title">Token</h4>
        <div className="row2">
          <input className="input" placeholder="Name (e.g. Post Q Doge)" value={name} maxLength={32} onChange={(e) => setName(e.target.value)} data-testid="launch-name" />
          <input className="input ticker" placeholder="TICKER" value={symbol} maxLength={10} onChange={(e) => setSymbol(e.target.value.toUpperCase().replace(/\s/g, ''))} data-testid="launch-symbol" />
        </div>
        <div className="input-wrap">
          <input className="input" placeholder="Metadata URI (optional, https:// / ipfs://)" value={uri} onChange={(e) => setUri(e.target.value.trim())} />
          <button type="button" className="input-icon" onClick={() => setMdHelper(true)} aria-label="Create metadata JSON"><FileJson size={18} /></button>
        </div>
        {(name || symbol || uri) && metaErrors.map((m) => <div key={m} className="field-error">{m}</div>)}
      </section>

      <section className="card">
        <h4 className="card-title">Supply & liquidity</h4>
        <label className="label">Total supply</label>
        <input className="input" inputMode="numeric" value={supplyText} onChange={(e) => setSupplyText(e.target.value.replace(/\D/g, '').slice(0, 14))} />
        <label className="label">SOL paired in the pool <span className="muted">· balance {formatUnits(solBal, 9).slice(0, 8)} SOL</span></label>
        <div className="amount-box">
          <input className="amount-input" inputMode="decimal" value={solText} onChange={(e) => setSolText(e.target.value.replace(',', '.'))} data-testid="launch-sol" />
          <span className="amount-sym">SOL</span>
          {['1', '5', '10'].map((v) => <button key={v} className="chip small" onClick={() => setSolText(v)}>{v}</button>)}
        </div>
        <label className="label">Creator allocation (kept outside the pool)</label>
        <div className="seg">
          {[0, 2, 5, MAX_CREATOR_PCT].map((p) => <button key={p} className={creatorPct === p ? 'active' : ''} onClick={() => setCreatorPct(p)}>{p === 0 ? 'None' : `${p}%`}</button>)}
        </div>
        <div className="launch-stats">
          <div><span>Starting price</span><b>{plan.startPriceSol ? plan.startPriceSol.toExponential(3) : '—'} SOL</b></div>
          <div><span>Starting market cap</span><b>{plan.startMcapSol.toLocaleString('en-US', { maximumFractionDigits: 2 })} SOL{solUsd ? ` · ${fmtUsd(mcapUsd, { compact: true })}` : ''}</b></div>
          <div><span>In the pool</span><b>{100 - creatorPct}% of supply</b></div>
        </div>
      </section>

      <section className="card">
        <h4 className="card-title"><Zap size={16} /> Anti-snipe protection</h4>
        <label className="label">Sniper tax</label>
        <div className="seg">
          {(Object.keys(TAX_PRESETS) as Preset[]).map((k) => (
            <button key={k} className={preset === k ? 'active' : ''} onClick={() => setPreset(k)} data-testid={`tax-${k}`}>{TAX_PRESETS[k].label}</button>
          ))}
        </div>
        <div className="tax-box">
          <TaxChart tax={config.tax} />
          <div className="tax-legend">
            <span><b>{fmtBps(config.tax.startBps)}</b> at open</span>
            <span><b>{fmtBps(roundBps(sniperTaxAt(config.tax, 60)))}</b> after 1 min</span>
            <span><b>{fmtBps(endBps)}</b> after {fmtSecs(config.tax.durationSec)}</span>
          </div>
        </div>
        <label className="label">Long-term trading fee</label>
        <div className="seg">
          {END_FEE_OPTIONS.map((b) => <button key={b} className={endBps === b ? 'active' : ''} onClick={() => setEndBps(b)}>{fmtBps(b)}</button>)}
        </div>
        <label className="label">Trading opens</label>
        <div className="seg">
          {OPEN_DELAYS.map((d) => <button key={d} className={delay === d ? 'active' : ''} onClick={() => setDelay(d)}>{d === 0 ? 'Now' : `in ${fmtSecs(d)}`}</button>)}
        </div>
        <p className="muted small">A delayed open lets everyone verify the locked pool and revoked mint before buying — nobody, including you, can trade earlier.</p>
      </section>

      <section className="card always-on">
        <h4 className="card-title"><ShieldCheck size={16} /> Always on</h4>
        <div><Lock size={15} /> Liquidity permanently locked — no rug pull possible</div>
        <div><ShieldCheck size={15} /> Mint authority revoked — supply fixed forever</div>
        <div><Snowflake size={15} /> No freeze authority — holders can't be frozen</div>
        <div><FileJson size={15} /> Immutable metadata</div>
      </section>

      {launches.length > 0 && (
        <section className="card">
          <h4 className="card-title"><Rocket size={16} /> Your launches</h4>
          {launches.map((r) => (
            <div key={r.id} className="launch-row">
              <TokenAvatar symbol={r.symbol} size={36} />
              <div className="token-mid">
                <div className="token-name">${r.symbol} <span className={`pill ${r.status === 'live' ? 'live' : 'demo'}`}>{r.status === 'live' ? 'LIVE' : 'NO POOL'}</span></div>
                <button className="token-sub mono" onClick={() => void copy(r.mint)}>{shortAddr(r.mint, 5)} <Copy size={11} /></button>
              </div>
              {r.status === 'token-created'
                ? <button className="chip small" onClick={() => void finishResume(r)}>Finish launch</button>
                : <LaunchLinks r={r} />}
            </div>
          ))}
        </section>
      )}

      <div className="swap-foot">
        <button className="btn primary" disabled={!canReview || !accounts} onClick={() => { setAck(false); setReview(true); }} data-testid="launch-review">
          {canReview ? <><Rocket size={18} /> Review launch</> : plan.errors[0]}
        </button>
      </div>

      {mdHelper && <MetadataHelper name={config.name} symbol={config.symbol} onClose={() => setMdHelper(false)} />}

      {review && (
        <Sheet title={result ? 'Launched' : phase ? 'Launching' : 'Review launch'} onClose={closeReview} tall>
          <div className="review-pair launch-pair">
            <div><TokenAvatar symbol={reviewSymbol} size={44} /><b>${reviewSymbol}</b><small>{reviewName}</small></div>
          </div>

          {!phase && !resume && <>
            <div className="checks" data-testid="launch-checks">
              {plan.checks.map((c) => (
                <div key={c.label} className={`check ${c.level}`}>
                  {c.level === 'ok' ? <Check size={16} /> : <AlertTriangle size={16} />}
                  <span>{c.label}<small>{c.detail}</small></span>
                </div>
              ))}
            </div>
            <div className="kv compact">
              <div><span>Liquidity</span><b>{fmtSol(plan.poolB)} SOL + {(100 - creatorPct)}% supply</b></div>
              <div><span>Rent & network fees</span><b>≈ {formatUnits(LAUNCH_COST_LAMPORTS, 9)} SOL</b></div>
              <div><span>Pool</span><b>Meteora DAMM v2</b></div>
              <div><span>Transactions</span><b>2, signed on this device</b></div>
            </div>
            <label className="check-row">
              <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} data-testid="launch-ack" />
              I understand the SOL I add is locked forever, memecoins are highly speculative, and launching a token may have legal obligations where I live.
            </label>
            <HoldButton label="Hold to launch" onConfirm={() => void start()} disabled={!ack} />
          </>}

          {phase && (
            <div className="progress" data-testid="launch-progress">
              {STEPS.map((s, i) => {
                const cur = STEPS.findIndex((x) => x.key === phase);
                const done = result ? true : i < cur;
                const active = !result && i === cur && !err;
                return (
                  <div key={s.key} className={`pstep ${done ? 'done' : active ? 'active' : ''}`}>
                    <span className="pdot">{done ? <Check size={14} /> : active ? <Spinner size={14} /> : null}</span>
                    <span>{s.label}</span>
                  </div>
                );
              })}
              {err && (
                <div className="result compact">
                  <div className="result-icon bad"><AlertTriangle size={44} /></div>
                  <p className="muted">{err}</p>
                  <p className="muted small">If the token was created but the pool wasn't, use “Finish launch” under Your launches.</p>
                  <button className="btn secondary" onClick={() => { setErr(''); setPhase(null); setReview(false); setResume(null); }}>Close</button>
                </div>
              )}
              {result && (
                <div className="result compact">
                  <div className="result-icon ok rainbow"><CheckCircle2 size={48} /></div>
                  <h3 data-testid="launch-done">${result.symbol} is live</h3>
                  {result.opensAt && <p className="muted"><Clock size={14} /> Trading opens at {new Date(result.opensAt * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>}
                  <div className="kv compact full">
                    <div><span>Mint</span><button className="mono" onClick={() => void copy(result.mint)}>{shortAddr(result.mint, 6)} <Copy size={11} /></button></div>
                    {result.pool && <div><span>Pool</span><button className="mono" onClick={() => void copy(result.pool!)}>{shortAddr(result.pool, 6)} <Copy size={11} /></button></div>}
                  </div>
                  <LaunchLinks r={result} />
                  <p className="muted small">The LP position NFT in this wallet earns all trading fees, including the sniper tax.</p>
                  <button className="btn primary" onClick={closeReview}>Done</button>
                </div>
              )}
            </div>
          )}
        </Sheet>
      )}
    </div>
  );
};
