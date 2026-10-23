import { useState } from 'react';
import { ArrowLeftRight, History, Home as HomeIcon, Settings as SettingsIcon } from 'lucide-react';
import { useWallet, type Row, type Tab } from './state';
import { Onboarding, Unlock } from './screens/Onboarding';
import { Home } from './screens/Home';
import { Swap } from './screens/Swap';
import { Send } from './screens/Send';
import { Receive } from './screens/Receive';
import { Activity } from './screens/Activity';
import { Settings } from './screens/Settings';

type Overlay = { kind: 'send'; row?: Row } | { kind: 'receive' } | { kind: 'bridge' } | null;

const TABS: { id: Tab; label: string; Icon: typeof HomeIcon }[] = [
  { id: 'home', label: 'Home', Icon: HomeIcon },
  { id: 'swap', label: 'Swap', Icon: ArrowLeftRight },
  { id: 'activity', label: 'Activity', Icon: History },
  { id: 'settings', label: 'Settings', Icon: SettingsIcon },
];

export const App = () => {
  const { phase, tab, setTab, toast } = useWallet();
  const [overlay, setOverlay] = useState<Overlay>(null);

  let body;
  if (phase === 'welcome') body = <Onboarding />;
  else if (phase === 'locked') body = <Unlock />;
  else {
    body = (
      <>
        <main className="tab-body">
          {tab === 'home' && (
            <Home
              onSend={(row) => setOverlay({ kind: 'send', row })}
              onReceive={() => setOverlay({ kind: 'receive' })}
              onSwap={() => setTab('swap')}
              onBridge={() => setOverlay({ kind: 'bridge' })}
            />
          )}
          {tab === 'swap' && <Swap />}
          {tab === 'activity' && <Activity />}
          {tab === 'settings' && <Settings />}
        </main>
        <nav className="tabbar">
          {TABS.map(({ id, label, Icon }) => (
            <button key={id} className={tab === id ? 'active' : ''} onClick={() => { setOverlay(null); setTab(id); }} data-testid={`tab-${id}`}>
              <Icon size={22} /><span>{label}</span>
            </button>
          ))}
        </nav>
        {overlay?.kind === 'send' && <Send initial={overlay.row?.token} onClose={() => setOverlay(null)} />}
        {overlay?.kind === 'bridge' && <Swap preset="bridge" onClose={() => setOverlay(null)} />}
        {overlay?.kind === 'receive' && <Receive onClose={() => setOverlay(null)} />}
      </>
    );
  }

  return (
    <div className="device">
      <div className="app">
        {body}
        {toast && <div className="toast">{toast}</div>}
      </div>
    </div>
  );
};
