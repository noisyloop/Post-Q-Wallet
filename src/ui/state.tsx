import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Accounts } from '../core/keyring';
import {
  clearVault, decryptVault, encryptVault, loadVault, lockoutRemaining, recordUnlockFailure, resetUnlockFailures, saveVault,
  WrongPasswordError,
} from '../core/vault';
import { closeSession, openSession, touchSession } from '../core/session';
import { createLiveBackend } from '../core/backend/live';
import { createDemoBackend } from '../core/backend/demo';
import type { Backend, Holding, LaunchRecord, Prices } from '../core/backend/types';
import { tokenKey, type Token } from '../core/chains/registry';
import { toNumber } from '../core/format';

export type Phase = 'welcome' | 'locked' | 'ready';
export type Tab = 'home' | 'swap' | 'launch' | 'activity' | 'settings';

export interface ActivityItem {
  id: string;
  kind: 'send' | 'swap' | 'receive' | 'launch';
  ts: number;
  title: string;
  subtitle: string;
  amount: string;
  status: 'pending' | 'confirmed' | 'failed';
  explorer?: string;
  counterparty?: string;
}

export interface Row { token: Token; amount: bigint; usd: number; change24h: number; price: number }

interface Ctx {
  phase: Phase;
  demo: boolean;
  setDemo(v: boolean): void;
  accounts: Accounts | null;
  backend: Backend;
  rows: Row[];
  prices: Prices;
  loading: boolean;
  refresh(): Promise<void>;
  activity: ActivityItem[];
  addActivity(a: ActivityItem): void;
  launches: LaunchRecord[];
  saveLaunch(r: LaunchRecord): void;
  createWallet(mnemonic: string, password: string): Promise<void>;
  unlock(password: string): Promise<void>;
  verifyPassword(password: string): Promise<string>;
  lock(): void;
  reset(): void;
  tab: Tab;
  setTab(t: Tab): void;
  toast: string | null;
  showToast(msg: string): void;
}

const WalletCtx = createContext<Ctx | null>(null);

const MODE_KEY = 'pqw.mode';
const ACTIVITY_KEY = 'pqw.activity';
const LAUNCHES_KEY = 'pqw.launches';

const initialDemo = (): boolean => {
  // ?demo only applies before a wallet exists, so a crafted link can't make an
  // existing live wallet display simulated balances.
  if (!loadVault(localStorage) && new URLSearchParams(location.search).has('demo')) return true;
  return localStorage.getItem(MODE_KEY) === 'demo';
};

const loadLaunches = (): LaunchRecord[] => {
  try {
    const a = JSON.parse(localStorage.getItem(LAUNCHES_KEY) ?? '[]');
    return Array.isArray(a) ? a.slice(0, 50) : [];
  } catch {
    return [];
  }
};

const loadActivity = (): ActivityItem[] => {
  try {
    const a = JSON.parse(localStorage.getItem(ACTIVITY_KEY) ?? '[]');
    return Array.isArray(a) ? a.slice(0, 200) : [];
  } catch {
    return [];
  }
};

export const WalletProvider = ({ children }: { children: ReactNode }) => {
  const [phase, setPhase] = useState<Phase>(() => (loadVault(localStorage) ? 'locked' : 'welcome'));
  const [demo, setDemoState] = useState(initialDemo);
  const [accounts, setAccounts] = useState<Accounts | null>(null);
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [prices, setPrices] = useState<Prices>({});
  const [loading, setLoading] = useState(false);
  const [activity, setActivity] = useState<ActivityItem[]>(loadActivity);
  const [launches, setLaunches] = useState<LaunchRecord[]>(loadLaunches);
  const [tab, setTab] = useState<Tab>('home');
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>();

  const backend = useMemo(() => (demo ? createDemoBackend() : createLiveBackend()), [demo]);

  const setDemo = useCallback((v: boolean) => {
    localStorage.setItem(MODE_KEY, v ? 'demo' : 'live');
    setDemoState(v);
  }, []);

  const onLocked = useCallback(() => {
    setAccounts(null);
    setHoldings([]);
    setPhase(loadVault(localStorage) ? 'locked' : 'welcome');
  }, []);

  const refresh = useCallback(async () => {
    if (!accounts) return;
    setLoading(true);
    try {
      const [h, p] = await Promise.all([backend.balances(accounts), backend.prices().catch(() => ({}) as Prices)]);
      setHoldings(h);
      setPrices(p);
    } finally {
      setLoading(false);
    }
  }, [accounts, backend]);

  useEffect(() => { void refresh(); }, [refresh]);

  // Any interaction resets the auto-lock timer.
  useEffect(() => {
    const h = () => touchSession();
    window.addEventListener('pointerdown', h);
    window.addEventListener('keydown', h);
    return () => {
      window.removeEventListener('pointerdown', h);
      window.removeEventListener('keydown', h);
    };
  }, []);

  const createWallet = useCallback(async (mnemonic: string, password: string) => {
    const blob = await encryptVault(mnemonic, password);
    saveVault(localStorage, blob);
    resetUnlockFailures(localStorage);
    setAccounts(openSession(mnemonic, onLocked));
    setPhase('ready');
    setTab('home');
  }, [onLocked]);

  const decryptWithThrottle = useCallback(async (password: string): Promise<string> => {
    const wait = lockoutRemaining(localStorage);
    if (wait > 0) throw new Error(`Too many attempts. Try again in ${Math.ceil(wait / 1000)}s`);
    const blob = loadVault(localStorage);
    if (!blob) throw new Error('No wallet found on this device');
    try {
      const m = await decryptVault(blob, password);
      resetUnlockFailures(localStorage);
      return m;
    } catch (e) {
      if (e instanceof WrongPasswordError) recordUnlockFailure(localStorage);
      throw e;
    }
  }, []);

  const unlock = useCallback(async (password: string) => {
    const m = await decryptWithThrottle(password);
    setAccounts(openSession(m, onLocked));
    setPhase('ready');
    setTab('home');
  }, [decryptWithThrottle, onLocked]);

  const lock = useCallback(() => closeSession(true), []);

  const reset = useCallback(() => {
    closeSession(false);
    clearVault(localStorage);
    localStorage.removeItem(ACTIVITY_KEY);
    localStorage.removeItem(LAUNCHES_KEY);
    setActivity([]);
    setLaunches([]);
    setAccounts(null);
    setPhase('welcome');
  }, []);

  const addActivity = useCallback((a: ActivityItem) => {
    setActivity((prev) => {
      const next = [a, ...prev.filter((x) => x.id !== a.id)].slice(0, 200);
      localStorage.setItem(ACTIVITY_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const saveLaunch = useCallback((r: LaunchRecord) => {
    setLaunches((prev) => {
      const next = [r, ...prev.filter((x) => x.id !== r.id)].slice(0, 50);
      localStorage.setItem(LAUNCHES_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2200);
  }, []);

  const rows = useMemo<Row[]>(() => holdings
    .map((h) => {
      const p = prices[h.token.priceId] ?? { usd: 0, change24h: 0 };
      return { token: h.token, amount: h.amount, price: p.usd, change24h: p.change24h, usd: toNumber(h.amount, h.token.decimals) * p.usd };
    })
    .filter((r) => r.amount > 0n)
    .sort((a, b) => b.usd - a.usd), [holdings, prices]);

  const value: Ctx = {
    phase, demo, setDemo, accounts, backend, rows, prices, loading, refresh, activity, addActivity, launches, saveLaunch,
    createWallet, unlock, verifyPassword: decryptWithThrottle, lock, reset, tab, setTab, toast, showToast,
  };
  return <WalletCtx.Provider value={value}>{children}</WalletCtx.Provider>;
};

export const useWallet = (): Ctx => {
  const c = useContext(WalletCtx);
  if (!c) throw new Error('useWallet outside provider');
  return c;
};

export const balanceOf = (rows: Row[], t: Token): bigint => rows.find((r) => tokenKey(r.token) === tokenKey(t))?.amount ?? 0n;
