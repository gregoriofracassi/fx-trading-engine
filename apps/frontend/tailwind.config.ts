import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Design tokens — extend as needed
      },
      borderRadius: {
        // Design tokens
      },
    },
  },
  plugins: [],
};

export default config;
