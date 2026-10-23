import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, ExternalLink } from 'lucide-react';
import { useWallet } from '../state';
import { ScreenHeader } from '../components/common';

const ICON = { send: ArrowUpRight, receive: ArrowDownLeft, swap: ArrowLeftRight };

const day = (ts: number) => {
  const d = new Date(ts);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return 'Today';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

export const Activity = () => {
  const { activity } = useWallet();
  const groups = activity.reduce<Record<string, typeof activity>>((g, a) => {
    (g[day(a.ts)] ??= []).push(a);
    return g;
  }, {});

  return (
    <div className="screen activity">
      <ScreenHeader title="Activity" />
      {activity.length === 0 && <div className="empty tall"><ArrowLeftRight size={32} /><p>Your transactions will appear here</p></div>}
      {Object.entries(groups).map(([d, items]) => (
        <section key={d}>
          <h4 className="group-label">{d}</h4>
          {items.map((a) => {
            const Icon = ICON[a.kind];
            return (
              <a key={a.id} className="activity-row" href={a.explorer} target="_blank" rel="noopener noreferrer">
                <span className={`act-icon ${a.kind}`}><Icon size={18} /></span>
                <div className="token-mid">
                  <div className="token-name">{a.title}</div>
                  <div className="token-sub">{a.subtitle}</div>
                </div>
                <div className="token-right">
                  <div className={`token-usd ${a.amount.startsWith('+') ? 'up' : ''}`}>{a.amount}</div>
                  <div className={`status ${a.status}`}>{a.status}{a.explorer && <ExternalLink size={11} />}</div>
                </div>
              </a>
            );
          })}
        </section>
      ))}
    </div>
  );
};
