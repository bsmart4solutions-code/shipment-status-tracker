import type { Config } from 'tailwindcss';

export default {
  darkMode: 'class',
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Neutral ERP palette; primary can be re-branded in one place
        primary: { DEFAULT: '#2563eb', hover: '#1d4ed8', muted: '#dbeafe' },
      },
    },
  },
  plugins: [],
} satisfies Config;
