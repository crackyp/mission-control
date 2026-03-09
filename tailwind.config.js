/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  darkMode: 'media',
  theme: {
    extend: {
      colors: {
        linear: {
          bg: '#0e0e10',
          'bg-secondary': '#151518',
          'bg-tertiary': '#1c1c1f',
          'bg-hover': '#222226',
          'bg-active': '#2a2a2e',
          border: '#2a2a2e',
          'border-subtle': '#1f1f23',
          text: '#f7f8f8',
          'text-secondary': '#8a8f98',
          'text-tertiary': '#5c616b',
          accent: '#5e6ad2',
          'accent-hover': '#6872d9',
          success: '#4ade80',
          warning: '#fbbf24',
          error: '#ef4444',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
      boxShadow: {
        'linear': '0 1px 3px rgba(0, 0, 0, 0.3), 0 1px 2px rgba(0, 0, 0, 0.2)',
        'linear-lg': '0 10px 25px -5px rgba(0, 0, 0, 0.4), 0 8px 10px -6px rgba(0, 0, 0, 0.2)',
        'glow': '0 0 20px rgba(94, 106, 210, 0.3)',
      },
    },
  },
  plugins: [],
};
