/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/renderer/src/**/*.{js,ts,jsx,tsx}", "./src/renderer/index.html"],
  theme: {
    extend: {
      colors: {
        surface: {
          900: "#0a0b0f",
          800: "#12141c",
          700: "#1a1d28",
          600: "#222638",
          500: "#2d3148",
          400: "#3d4260",
        },
        accent: {
          gold:   "#f0a500",
          blue:   "#4d9eff",
          purple: "#8b5cf6",
        },
        trust: {
          certified: "#22c55e",
          warning:   "#f59e0b",
          danger:    "#ef4444",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
      },
      boxShadow: {
        card:       "0 4px 24px rgba(0,0,0,0.4)",
        "glow-purple": "0 0 20px rgba(139,92,246,0.25)",
        "glow-green":  "0 0 20px rgba(34,197,94,0.25)",
      },
      animation: {
        "spin-slow": "spin 3s linear infinite",
        "pulse-dot": "pulse 2s cubic-bezier(0.4,0,0.6,1) infinite",
      },
    },
  },
  plugins: [],
};
