/** Locally drawn token/chain marks — no remote images (privacy + CSP). */
import { getChain, type Token } from '../../core/chains/registry';

const Glyph = ({ symbol }: { symbol: string }) => {
  switch (symbol) {
    case 'ETH':
      return (
        <g fill="#fff">
          <path d="M16 5 9.5 16.2 16 20l6.5-3.8z" opacity=".95" />
          <path d="M16 21.3 9.5 17.5 16 27l6.5-9.5z" opacity=".75" />
        </g>
      );
    case 'SOL':
      return (
        <g fill="#fff">
          <path d="M10.5 10h12.4l-2 2.3H8.5z" />
          <path d="M8.5 14.9h12.4l2 2.3H10.5z" />
          <path d="M10.5 19.8h12.4l-2 2.3H8.5z" />
        </g>
      );
    case 'BTC':
      return <text x="16" y="22" textAnchor="middle" fontSize="17" fontWeight="800" fill="#fff" transform="rotate(12 16 16)">₿</text>;
    case 'USDC':
      return (
        <g fill="none" stroke="#fff" strokeWidth="1.8">
          <circle cx="16" cy="16" r="9" />
          <text x="16" y="20.5" textAnchor="middle" fontSize="12" fontWeight="800" fill="#fff" stroke="none">$</text>
        </g>
      );
    case 'USDT':
      return <text x="16" y="21.5" textAnchor="middle" fontSize="15" fontWeight="800" fill="#fff">₮</text>;
    case 'BNB':
      return (
        <g fill="#fff">
          <path d="m16 7 3 3-3 3-3-3zM10 13l3 3-3 3-3-3zM22 13l3 3-3 3-3-3zM16 19l3 3-3 3-3-3zM16 13l3 3-3 3-3-3z" />
        </g>
      );
    case 'AVAX':
      return <path d="M16 8 25 24h-6l-3-5.4-3 5.4H7z" fill="#fff" />;
    case 'POL':
      return <path d="m12 11 4-2.3 4 2.3v4.6l-4 2.3-4-2.3zm4 7 4-2.3 4 2.3v4.6L20 25l-4-2.3z" fill="none" stroke="#fff" strokeWidth="1.8" />;
    default:
      return <text x="16" y="21" textAnchor="middle" fontSize="12" fontWeight="800" fill="#fff">{symbol.slice(0, 3)}</text>;
  }
};

export const TokenIcon = ({ token, size = 40, badge = true }: { token: Token; size?: number; badge?: boolean }) => {
  const chain = getChain(token.chainId);
  const showBadge = badge && !(token.address === null && ['ethereum', 'solana', 'bitcoin', 'bsc', 'avalanche', 'polygon'].includes(chain.id));
  return (
    <span className="token-icon" style={{ width: size, height: size }}>
      <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden>
        <circle cx="16" cy="16" r="16" fill={token.color} />
        <Glyph symbol={token.symbol} />
      </svg>
      {showBadge && <ChainBadge chainId={chain.id} size={Math.round(size * 0.42)} />}
    </span>
  );
};

export const ChainBadge = ({ chainId, size = 16 }: { chainId: string; size?: number }) => {
  const c = getChain(chainId);
  return (
    <span className="chain-badge" style={{ width: size, height: size, background: c.color, fontSize: size * 0.55 }} title={c.name}>
      {c.name[0]}
    </span>
  );
};

export const ChainDot = ({ chainId }: { chainId: string }) => (
  <span className="chain-dot" style={{ background: getChain(chainId).color }} />
);

/** Rainbow-style gradient avatar derived from the address. */
export const Avatar = ({ seed, size = 36 }: { seed: string; size?: number }) => {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const a = h % 360;
  const b = (a + 70 + (h % 90)) % 360;
  const emoji = ['🦄', '🌈', '🐸', '🦊', '🐼', '🐙', '🦋', '🐳', '🌵', '🍄'][h % 10];
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.52, background: `linear-gradient(135deg, hsl(${a} 90% 62%), hsl(${b} 90% 58%))` }}>
      {emoji}
    </span>
  );
};

export const Logo = ({ size = 72 }: { size?: number }) => (
  <svg viewBox="0 0 72 72" width={size} height={size} aria-label="Post-Q Wallet">
    <defs>
      <linearGradient id="lg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#FF5CA8" />
        <stop offset=".35" stopColor="#FFB547" />
        <stop offset=".65" stopColor="#4CE3A5" />
        <stop offset="1" stopColor="#6C7BFF" />
      </linearGradient>
    </defs>
    <rect width="72" height="72" rx="22" fill="url(#lg)" />
    <circle cx="35" cy="34" r="15" fill="none" stroke="#0E0E14" strokeWidth="7" />
    <path d="m41 40 11 11" stroke="#0E0E14" strokeWidth="7" strokeLinecap="round" />
  </svg>
);
