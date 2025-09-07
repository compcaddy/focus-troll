/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./popup.html",
    "./popup.js",
    "./**/*.html"
  ],
  theme: {
    extend: {
      colors: {
        'p1': '#667eea',
        'n1': '#202124',
        'n2': '#5f6368',
        'danger': '#ea4335',
        'warning': '#f57c00'
      },
      boxShadow: {
        'card': '0 1px 3px rgba(0, 0, 0, 0.1), 0 1px 2px rgba(0, 0, 0, 0.06)'
      }
    },
  },
  plugins: [],
}