export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'w95-teal': '#008080',
        'w95-gray': '#c0c0c0',
        'w95-panel': '#ece9d8',
        'w95-blue': '#000080',
        'w95-blue-light': '#1084d0',
        'w95-dark': '#808080',
        'w95-black': '#000000',
        'w95-yellow': '#ffffcc',
      },
      fontFamily: {
        tahoma: ['Tahoma', '-apple-system', 'sans-serif'],
        mono: ['Consolas', 'Courier New', 'monospace'],
        comic: ['Comic Neue', 'Segoe UI', 'sans-serif'],
      }
    },
  },
  plugins: [],
}
