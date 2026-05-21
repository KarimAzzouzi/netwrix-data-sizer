export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        primary: { DEFAULT: '#1B3A6B', light: '#2A5298', dark: '#122654' },
        accent: '#E8702A',
        netwrix: { blue: '#1B3A6B', orange: '#E8702A' }
      }
    }
  },
  plugins: []
}
