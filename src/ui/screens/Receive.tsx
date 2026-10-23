import { useMemo, useState } from 'react';
import { Copy, Info } from 'lucide-react';
import { renderSVG } from 'uqr';
import { useWallet } from '../state';
import { Sheet } from '../components/common';
import { ChainBadge } from '../components/icons';
import { CHAINS } from '../../core/chains/registry';

type Fam = 'evm' | 'solana' | 'bitcoin';

const NOTE: Record<Fam, string> = {
  evm: `Same address on ${CHAINS.filter((c) => c.family === 'evm').map((c) => c.name).join(', ')}. Only send EVM assets here.`,
  solana: 'Only send SOL and Solana (SPL) tokens to this address.',
  bitcoin: 'Native SegWit (bc1…) address. Only send BTC on the Bitcoin network.',
};

export const Receive = ({ onClose }: { onClose(): void }) => {
  const { accounts, showToast } = useWallet();
  const [fam, setFam] = useState<Fam>('evm');
  const address = accounts?.[fam] ?? '';
  // uqr renders a static SVG string from local data only — no scripts, no network.
  const svg = useMemo(() => (address ? renderSVG(address, { border: 1, ecc: 'M' }) : ''), [address]);

  const copy = async () => {
    await navigator.clipboard?.writeText(address).catch(() => undefined);
    showToast('Address copied');
  };

  return (
    <Sheet title="Receive" onClose={onClose} tall>
      <div className="seg">
        {(['evm', 'solana', 'bitcoin'] as Fam[]).map((f) => (
          <button key={f} className={fam === f ? 'active' : ''} onClick={() => setFam(f)} data-testid={`recv-${f}`}>
            <ChainBadge chainId={f === 'evm' ? 'ethereum' : f} size={16} />{f === 'evm' ? 'EVM' : f === 'solana' ? 'Solana' : 'Bitcoin'}
          </button>
        ))}
      </div>
      <div className="qr-card">
        <div className="qr" dangerouslySetInnerHTML={{ __html: svg }} />
        <div className="qr-addr" data-testid="recv-address">{address}</div>
        <button className="btn secondary" onClick={copy}><Copy size={16} /> Copy address</button>
      </div>
      {fam === 'evm' && (
        <div className="chain-row">{CHAINS.filter((c) => c.family === 'evm').map((c) => <ChainBadge key={c.id} chainId={c.id} size={22} />)}</div>
      )}
      <div className="note"><Info size={16} /><span>{NOTE[fam]}</span></div>
    </Sheet>
  );
};
