import lightBackground from '../assets/logo/sepenta-logo-light-bg.png';
import darkBackground from '../assets/logo/sepenta-logo-dark-bg.png';

export type LogoVariant = 'light' | 'dark';

/** The Sepenta logo. `light` is for white and light surfaces, `dark` for navy surfaces. Rules: docs/design/brand-tokens.md. */
export function Logo({ variant = 'light', width = 260 }: { variant?: LogoVariant; width?: number }) {
  return <img className="logo" src={variant === 'dark' ? darkBackground : lightBackground} alt="Sepenta: Powering Intelligent Growth" style={{ width: Math.max(160, width) }} />;
}
