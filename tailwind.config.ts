import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        alien: {
          void: "#03040a",
          deep: "#070b14",
          panel: "#0c1220",
          border: "#1a2740",
          cyan: "#00f0ff",
          green: "#39ff14",
          purple: "#b14eff",
          orange: "#F7931A",
          muted: "#8b9bb4",
        },
        candle: {
          green: "#26a69a",
          red: "#ef5350",
        },
      },
      fontFamily: {
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Monaco", "Consolas", "monospace"],
        display: ["ui-sans-serif", "system-ui", "sans-serif"],
      },
      boxShadow: {
        glow: "0 0 20px rgba(0, 240, 255, 0.25)",
        "glow-strong": "0 0 30px rgba(0, 240, 255, 0.45)",
        "glow-green": "0 0 20px rgba(57, 255, 20, 0.3)",
      },
      animation: {
        "pulse-slow": "pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite",
      },
    },
  },
  plugins: [],
};

export default config;