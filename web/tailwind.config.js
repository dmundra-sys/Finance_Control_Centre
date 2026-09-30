/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: { sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'] },
      colors: {
        navy: { 50: '#f1f5fa', 100: '#e1eaf4', 200: '#c3d3e8', 300: '#96b0d3', 400: '#6183b5', 500: '#3f629a', 600: '#2f4d7e', 700: '#263f66', 800: '#1a2f4d', 900: '#0f2a4a', 950: '#0a1b30' },
      },
      boxShadow: { card: '0 1px 2px rgba(15,42,74,.05), 0 1px 3px rgba(15,42,74,.06)', pop: '0 10px 30px rgba(15,42,74,.18)' },
    },
  },
  plugins: [],
};
