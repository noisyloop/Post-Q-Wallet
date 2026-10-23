import { useState } from 'react';
import { AlertTriangle, ChevronRight, Clock, EyeOff, FlaskConical, KeyRound, Lock, ShieldCheck, Trash2 } from 'lucide-react';
import { useWallet } from '../state';
import { PasswordField, ScreenHeader, Sheet, Spinner } from '../components/common';
import { AUTO_LOCK_MS } from '../../core/session';

const PROTECTIONS = [
  ['Encrypted vault', 'scrypt (N=2¹⁷) + AES-256-GCM. 256-bit symmetric crypto stays secure against quantum computers.'],
  ['Keys stay local', 'Private keys are derived only at signing time and wiped from memory right after.'],
  ['Auto-lock', 'Seed is erased from memory after 5 minutes of inactivity.'],
  ['Brute-force throttling', 'Exponential back-off after 3 failed unlock attempts.'],
  ['Quote verification', 'Swap transactions must target the verified LI.FI router, the right chain and your own address.'],
  ['Exact approvals', 'Tokens are approved for the exact swap amount — never unlimited.'],
  ['Hold to confirm', 'Value-moving actions need a deliberate press-and-hold.'],
  ['Address checks', 'Checksum validation plus address-poisoning look-alike detection.'],
  ['Strict CSP', 'No third-party scripts, no analytics; network access limited to RPCs and LI.FI.'],
];

export const Settings = () => {
  const { lock, reset, verifyPassword, demo } = useWallet();
  const [reveal, setReveal] = useState(false);
  const [pw, setPw] = useState('');
  const [phrase, setPhrase] = useState<string[] | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [showReset, setShowReset] = useState(false);
  const [confirm, setConfirm] = useState('');

  const doReveal = async () => {
    setBusy(true);
    setErr('');
    try {
      setPhrase((await verifyPassword(pw)).split(' '));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
      setPw('');
    }
  };

  const closeReveal = () => {
    setReveal(false);
    setPhrase(null);
    setPw('');
    setErr('');
  };

  return (
    <div className="screen settings">
      <ScreenHeader title="Settings" />
      <div className="settings-group">
        <button className="settings-row" onClick={lock} data-testid="lock-now"><Lock size={18} /><span>Lock wallet now</span><ChevronRight size={18} /></button>
        <button className="settings-row" onClick={() => setReveal(true)}><KeyRound size={18} /><span>Show recovery phrase</span><ChevronRight size={18} /></button>
        <div className="settings-row static"><Clock size={18} /><span>Auto-lock</span><b>{AUTO_LOCK_MS / 60000} min</b></div>
        <div className="settings-row static"><FlaskConical size={18} /><span>Mode</span><b>{demo ? 'Demo (simulated)' : 'Live (mainnet)'}</b></div>
      </div>

      <h4 className="group-label">Security model</h4>
      <div className="settings-group protections" data-testid="protections">
        {PROTECTIONS.map(([t, d]) => (
          <div key={t} className="protection"><ShieldCheck size={18} /><div><b>{t}</b><small>{d}</small></div></div>
        ))}
      </div>

      <div className="settings-group">
        <button className="settings-row danger" onClick={() => setShowReset(true)}><Trash2 size={18} /><span>Remove wallet from this device</span></button>
      </div>
      <p className="muted small center">Post-Q Wallet v0.1.0 · open source</p>

      {reveal && (
        <Sheet title="Recovery phrase" onClose={closeReveal} tall>
          {!phrase ? (
            <form onSubmit={(e) => { e.preventDefault(); void doReveal(); }} className="stack">
              <div className="warn-box"><div><AlertTriangle size={16} />Never share this phrase. Anyone who asks for it — including "support" — is trying to steal your funds.</div></div>
              <PasswordField value={pw} onChange={setPw} placeholder="Enter password to continue" autoFocus />
              {err && <div className="field-error">{err}</div>}
              <button className="btn primary" disabled={!pw || busy}>{busy ? <><Spinner /> Verifying…</> : 'Reveal'}</button>
            </form>
          ) : (
            <>
              <div className="phrase-grid">{phrase.map((w, i) => <div key={i} className="phrase-word"><span>{i + 1}</span>{w}</div>)}</div>
              <div className="note"><EyeOff size={16} /><span>Copying is disabled on purpose — clipboards can be read by other apps.</span></div>
              <button className="btn secondary" onClick={closeReveal}>Hide</button>
            </>
          )}
        </Sheet>
      )}

      {showReset && (
        <Sheet title="Remove wallet" onClose={() => setShowReset(false)}>
          <div className="danger-box">
            <p>This deletes the encrypted wallet from this device. Without your recovery phrase your funds are lost forever. Type <b>DELETE</b> to confirm.</p>
            <input className="input" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="DELETE" />
            <button className="btn danger" disabled={confirm !== 'DELETE'} onClick={reset}>Remove wallet</button>
          </div>
        </Sheet>
      )}
    </div>
  );
};
