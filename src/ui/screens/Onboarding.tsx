import { useMemo, useState } from 'react';
import { EyeOff, KeyRound, Lock, ShieldCheck, Sparkles, Wallet } from 'lucide-react';
import { useWallet } from '../state';
import { Logo } from '../components/icons';
import { PasswordField, ScreenHeader, Spinner } from '../components/common';
import { checkPassword } from '../../core/security';
import { isValidMnemonic, newMnemonic, normalizeMnemonic } from '../../core/keyring';

type Step = 'welcome' | 'password' | 'phrase' | 'verify' | 'import';

const randomIndices = (n: number, count: number): number[] => {
  const picked = new Set<number>();
  const buf = new Uint32Array(1);
  while (picked.size < count) {
    crypto.getRandomValues(buf);
    picked.add(buf[0] % n);
  }
  return [...picked].sort((a, b) => a - b);
};

const shuffle = <T,>(xs: T[]): T[] => {
  const a = [...xs];
  const buf = new Uint32Array(1);
  for (let i = a.length - 1; i > 0; i--) {
    crypto.getRandomValues(buf);
    const j = buf[0] % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

const StrengthMeter = ({ pw }: { pw: string }) => {
  const c = checkPassword(pw);
  if (!pw) return null;
  return (
    <div className="strength">
      <div className="strength-bars">{[0, 1, 2, 3].map((i) => <span key={i} className={i < c.score ? `on s${c.score}` : ''} />)}</div>
      <span className={c.ok ? 'ok' : 'bad'}>{c.hint}</span>
    </div>
  );
};

export const Onboarding = () => {
  const { createWallet, demo, setDemo } = useWallet();
  const [step, setStep] = useState<Step>('welcome');
  const [mode, setMode] = useState<'create' | 'import'>('create');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [mnemonic, setMnemonic] = useState('');
  const [revealed, setRevealed] = useState(false);
  const [ack, setAck] = useState(false);
  const [importText, setImportText] = useState('');
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const words = useMemo(() => mnemonic.split(' '), [mnemonic]);
  const quiz = useMemo(() => (mnemonic ? randomIndices(words.length, 3) : []), [mnemonic, words.length]);
  const options = useMemo(() => Object.fromEntries(quiz.map((i) => {
    const decoys = shuffle([...new Set(words.filter((w) => w !== words[i]))]).slice(0, 2);
    return [i, shuffle([words[i], ...decoys])];
  })), [quiz, words]);

  const pwCheck = checkPassword(pw);
  const pwOk = pwCheck.ok && pw === pw2;

  const finish = async (phrase: string) => {
    setBusy(true);
    setErr('');
    try {
      await createWallet(phrase, pw);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };

  if (step === 'welcome') {
    return (
      <div className="screen onboarding welcome">
        <div className="welcome-hero">
          <div className="orb orb1" /><div className="orb orb2" /><div className="orb orb3" />
          <Logo size={88} />
          <h1>Post-Q Wallet</h1>
          <p>One self-custodial wallet for Ethereum, Solana, Bitcoin and every major L2 — with cross-chain swaps built in.</p>
        </div>
        <div className="welcome-features">
          <div><ShieldCheck size={18} /> Keys never leave this device</div>
          <div><KeyRound size={18} /> 256-bit, quantum-resistant vault encryption</div>
          <div><Sparkles size={18} /> Swap across 9 chains in one tap</div>
        </div>
        <div className="welcome-actions">
          <button className="btn primary" data-testid="create-wallet" onClick={() => { setMode('create'); setStep('password'); }}>Create a new wallet</button>
          <button className="btn secondary" data-testid="import-wallet" onClick={() => { setMode('import'); setStep('password'); }}>I already have a wallet</button>
          <label className="toggle-row">
            <input type="checkbox" checked={demo} onChange={(e) => setDemo(e.target.checked)} data-testid="demo-toggle" />
            <span className="toggle" />
            <span>Demo mode <small>simulated balances, nothing is broadcast</small></span>
          </label>
        </div>
      </div>
    );
  }

  if (step === 'password') {
    return (
      <div className="screen onboarding">
        <ScreenHeader title="Create a password" onBack={() => setStep('welcome')} />
        <div className="ob-body">
          <div className="ob-icon"><Lock size={28} /></div>
          <p className="muted center">This password encrypts your wallet on this device. It can't be recovered — your recovery phrase is the only backup.</p>
          <PasswordField value={pw} onChange={setPw} placeholder="Password" autoFocus testId="pw1" />
          <StrengthMeter pw={pw} />
          <PasswordField value={pw2} onChange={setPw2} placeholder="Confirm password" testId="pw2" />
          {pw2 && pw !== pw2 && <div className="field-error">Passwords don't match</div>}
        </div>
        <div className="ob-foot">
          <button
            className="btn primary"
            disabled={!pwOk}
            data-testid="pw-continue"
            onClick={() => {
              if (mode === 'create') {
                setMnemonic(newMnemonic(256));
                setStep('phrase');
              } else setStep('import');
            }}
          >Continue</button>
        </div>
      </div>
    );
  }

  if (step === 'phrase') {
    return (
      <div className="screen onboarding">
        <ScreenHeader title="Recovery phrase" onBack={() => { setMnemonic(''); setRevealed(false); setStep('password'); }} />
        <div className="ob-body">
          <p className="muted center">Write these 24 words down in order and store them offline. Anyone with this phrase controls your funds.</p>
          <div className={`phrase-grid ${revealed ? '' : 'blurred'}`} data-testid="phrase-grid">
            {words.map((w, i) => <div key={i} className="phrase-word"><span>{i + 1}</span>{w}</div>)}
            {!revealed && (
              <button className="phrase-reveal" onClick={() => setRevealed(true)} data-testid="reveal-phrase">
                <EyeOff size={22} /> Tap to reveal<small>Make sure nobody is watching your screen</small>
              </button>
            )}
          </div>
          <label className="check-row">
            <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} data-testid="ack-phrase" />
            I saved my recovery phrase somewhere safe. I understand it is never stored unencrypted and can't be copied to the clipboard.
          </label>
        </div>
        <div className="ob-foot">
          <button className="btn primary" disabled={!revealed || !ack} onClick={() => setStep('verify')} data-testid="phrase-continue">Continue</button>
        </div>
      </div>
    );
  }

  if (step === 'verify') {
    const allRight = quiz.every((i) => answers[i] === words[i]);
    return (
      <div className="screen onboarding">
        <ScreenHeader title="Confirm your phrase" onBack={() => setStep('phrase')} />
        <div className="ob-body">
          <p className="muted center">Select the correct word for each position.</p>
          {quiz.map((i) => (
            <div key={i} className="quiz">
              <div className="quiz-label">Word #{i + 1}</div>
              <div className="quiz-opts">
                {options[i].map((w) => (
                  <button
                    key={w}
                    className={`chip big ${answers[i] === w ? (w === words[i] ? 'correct' : 'wrong') : ''}`}
                    onClick={() => setAnswers({ ...answers, [i]: w })}
                    data-testid={w === words[i] ? `quiz-correct-${i}` : undefined}
                  >{w}</button>
                ))}
              </div>
            </div>
          ))}
          {err && <div className="field-error">{err}</div>}
        </div>
        <div className="ob-foot">
          <button className="btn primary" disabled={!allRight || busy} onClick={() => finish(mnemonic)} data-testid="verify-finish">
            {busy ? <><Spinner /> Encrypting vault…</> : 'Create wallet'}
          </button>
        </div>
      </div>
    );
  }

  // import
  const valid = isValidMnemonic(importText);
  const wordCount = importText.trim() ? normalizeMnemonic(importText).split(' ').length : 0;
  return (
    <div className="screen onboarding">
      <ScreenHeader title="Import wallet" onBack={() => setStep('password')} />
      <div className="ob-body">
        <div className="ob-icon"><Wallet size={28} /></div>
        <p className="muted center">Enter your 12 or 24-word recovery phrase. It is encrypted locally and never sent anywhere.</p>
        <textarea
          className="input phrase-input"
          rows={5}
          value={importText}
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="off"
          placeholder="word1 word2 word3 …"
          onChange={(e) => setImportText(e.target.value)}
          data-testid="import-text"
        />
        <div className={valid ? 'field-ok' : 'muted small'}>{valid ? '✓ Valid recovery phrase' : wordCount ? `${wordCount} words — checksum ${wordCount === 12 || wordCount === 24 ? 'invalid' : 'incomplete'}` : ' '}</div>
        {err && <div className="field-error">{err}</div>}
      </div>
      <div className="ob-foot">
        <button className="btn primary" disabled={!valid || busy} onClick={() => finish(normalizeMnemonic(importText))} data-testid="import-finish">
          {busy ? <><Spinner /> Encrypting vault…</> : 'Import wallet'}
        </button>
      </div>
    </div>
  );
};

export const Unlock = () => {
  const { unlock, reset } = useWallet();
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmReset, setConfirmReset] = useState('');
  const [showReset, setShowReset] = useState(false);

  const submit = async () => {
    setBusy(true);
    setErr('');
    try {
      await unlock(pw);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
      setPw('');
    }
  };

  return (
    <div className="screen onboarding unlock">
      <div className="welcome-hero small">
        <div className="orb orb1" /><div className="orb orb3" />
        <Logo size={76} />
        <h1>Welcome back</h1>
        <p>Enter your password to unlock</p>
      </div>
      <form className="ob-body" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <PasswordField value={pw} onChange={setPw} placeholder="Password" autoFocus testId="unlock-pw" />
        {err && <div className="field-error">{err}</div>}
        <button className="btn primary" disabled={!pw || busy} type="submit" data-testid="unlock-btn">
          {busy ? <><Spinner /> Decrypting…</> : 'Unlock'}
        </button>
      </form>
      <div className="ob-foot">
        {!showReset ? (
          <button className="link" onClick={() => setShowReset(true)}>Forgot password?</button>
        ) : (
          <div className="danger-box">
            <p>Resetting deletes the encrypted wallet from this device. You can restore it only with your recovery phrase. Type <b>DELETE</b> to confirm.</p>
            <input className="input" value={confirmReset} onChange={(e) => setConfirmReset(e.target.value)} placeholder="DELETE" />
            <button className="btn danger" disabled={confirmReset !== 'DELETE'} onClick={reset}>Reset wallet</button>
          </div>
        )}
      </div>
    </div>
  );
};
