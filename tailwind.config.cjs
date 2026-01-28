/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './index.html',
    './index.tsx',
    './App.tsx',
    './components/**/*.{ts,tsx}',
    './services/**/*.{ts,tsx}',
    './utils.ts',
    './types.ts'
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
      },
      animation: {
        'wind-gust': 'windGust 1.2s ease-in-out forwards 2s',
        'ice-out': 'iceOut 1.5s ease-in forwards 2.2s',
        'ice-float': 'iceFloat 3s ease-in-out infinite',
        'puddle-grow': 'puddleGrow 2s ease-out forwards',
        'drop-1': 'dropSlide 1.8s ease-in infinite 0.2s',
        'drop-2': 'dropSlide 2.2s ease-in infinite 0.8s',
        'drop-3': 'dropSlide 2s ease-in infinite 1.2s',
        'drop-4': 'dropSlide 2.5s ease-in infinite 0.5s',
        'logo-reveal': 'logoReveal 1s ease-out forwards 2.8s',
        'fade-in-up': 'fadeInUp 0.8s ease-out forwards 3s',
        'luxury-shine': 'luxuryShine 2.8s ease-in-out infinite',
        'luxury-shine-soft': 'luxuryShineSoft 5.8s ease-in-out infinite',
        'luxury-glow': 'luxuryGlow 3.6s ease-in-out infinite',
        'luxury-glow-soft': 'luxuryGlowSoft 6s ease-in-out infinite',
      },
      keyframes: {
        windGust: {
          '0%': { transform: 'translateX(-150%)', opacity: '0' },
          '10%': { opacity: '0.8' },
          '100%': { transform: 'translateX(150vw)', opacity: '0' },
        },
        iceOut: {
          '0%': { transform: 'translateX(0) rotate(0deg)', opacity: '1' },
          '100%': { transform: 'translateX(150vw) rotate(45deg)', opacity: '0' },
        },
        iceFloat: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-6px)' },
        },
        puddleGrow: {
          '0%': { transform: 'scale(0.8)', opacity: '0' },
          '100%': { transform: 'scale(2.5)', opacity: '0.6' },
        },
        dropSlide: {
          '0%': { opacity: '0', transform: 'translateY(0)' },
          '20%': { opacity: '0.8', transform: 'translateY(5px)' },
          '80%': { opacity: '0.6', transform: 'translateY(25px)' },
          '100%': { opacity: '0', transform: 'translateY(35px)' },
        },
        logoReveal: {
          '0%': { opacity: '0', filter: 'blur(12px)', transform: 'scale(0.9)' },
          '100%': { opacity: '1', filter: 'blur(0)', transform: 'scale(1)' },
        },
        fadeInUp: {
          '0%': { opacity: '0', transform: 'translateY(20px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        luxuryShine: {
          '0%': { transform: 'translateX(-120%)', opacity: '0' },
          '15%': { opacity: '0.6' },
          '60%': { opacity: '0.9' },
          '100%': { transform: 'translateX(120%)', opacity: '0' },
        },
        luxuryShineSoft: {
          '0%': { transform: 'translateX(-120%)', opacity: '0' },
          '30%': { opacity: '0.35' },
          '70%': { opacity: '0.5' },
          '100%': { transform: 'translateX(120%)', opacity: '0' },
        },
        luxuryGlow: {
          '0%, 100%': { boxShadow: '0 0 0 rgba(248, 215, 124, 0)' },
          '50%': { boxShadow: '0 0 16px rgba(248, 215, 124, 0.45)' },
        },
        luxuryGlowSoft: {
          '0%, 100%': { boxShadow: '0 0 0 rgba(248, 215, 124, 0)' },
          '50%': { boxShadow: '0 0 10px rgba(248, 215, 124, 0.25)' },
        }
      },
      colors: {
        status: {
          red: '#FF0000',
          orange: '#FF9900',
          green: '#003CFF00',
          greenLight: '#B6D7A8',
          gold: '#F6B26B',
          yellow: '#FFD966',
          blue: '#003E7DB1',
          gray: '#D9D9D9',
        },
      },
    },
  },
  plugins: [],
};
