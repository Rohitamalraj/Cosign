/** Hex-derived tokens: ink on opal, 1px radius, violet/citrine/jade accents. */
module.exports = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    borderRadius: { none: '0', sm: '1px', DEFAULT: '1px', md: '1px', lg: '1px', xl: '1px', full: '9999px' },
    extend: {
      colors: {
        ink: '#080720',
        opal: '#FBF9F9',
        violet: '#5F509D',
        minsk: '#473982',
        amethyst: '#A477B2',
        citrine: '#CDA849',
        gold: '#d49e46',
        sand: '#ecc484',
        jade: '#5CB198',
        moss: '#5c9c4c',
        cement: '#717A94',
        lilac: '#bcb4d4',
        rose: '#F5C0C0',
        eggplant: '#31263B',
      },
      fontFamily: {
        display: ['var(--font-display)', 'sans-serif'],
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'monospace'],
        serif: ['var(--font-serif)', 'Georgia', 'serif'],
      },
      maxWidth: { page: '1440px' },
      letterSpacing: { h1: '-1.58px', h3: '-0.7px' },
    },
  },
  plugins: [],
};
