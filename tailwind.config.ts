import type { Config } from 'tailwindcss';

// Design tokens live as CSS variables in app/globals.css. Light, warm "paper" theme.
// New names are primary; the old dark-theme names are kept as aliases so nothing breaks mid-migration.
const c = (v: string) => `rgb(var(--${v}) / <alpha-value>)`;

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: c('canvas'), surface: c('surface'), subtle: c('subtle'),
        line: c('line'), 'line-strong': c('line-strong'),
        text: c('text'), mute: c('mute'), faint: c('faint'),
        accent: c('accent'), 'accent-soft': c('accent-soft'),
        ok: c('ok'), 'ok-soft': c('ok-soft'),
        warn: c('warn'), 'warn-soft': c('warn-soft'),
        crit: c('crit'), 'crit-soft': c('crit-soft'),
        info: c('info'), 'info-soft': c('info-soft'),
        // legacy aliases (old dark theme names → light equivalents)
        ink: c('canvas'), panel: c('surface'), raised: c('subtle'), rule: c('line-strong'), bone: c('text'), dim: c('faint'),
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: ['var(--font-display)', 'ui-serif', 'Georgia', 'serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      boxShadow: {
        card: '0 1px 2px rgb(31 27 22 / 0.04), 0 1px 1px rgb(31 27 22 / 0.03)',
        lift: '0 4px 14px rgb(31 27 22 / 0.08)',
      },
      letterSpacing: { arch: '0.02em' },
    },
  },
  plugins: [],
};
export default config;
