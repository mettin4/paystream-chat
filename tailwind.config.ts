import type { Config } from "tailwindcss";
import typography from "@tailwindcss/typography";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        app: {
          base: "var(--bg-base)",
          elevated: "var(--bg-elevated)",
          sunken: "var(--bg-sunken)",
        },
        stroke: {
          subtle: "var(--border-subtle)",
          strong: "var(--border-strong)",
        },
        ink: {
          primary: "var(--text-primary)",
          secondary: "var(--text-secondary)",
          tertiary: "var(--text-tertiary)",
          quaternary: "var(--text-quaternary)",
        },
        accent: {
          DEFAULT: "var(--accent)",
          hover: "var(--accent-hover)",
          subtle: "var(--accent-subtle)",
          border: "var(--accent-border)",
        },
      },
      fontFamily: {
        sans: [
          "var(--font-geist-sans)",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "sans-serif",
        ],
        mono: [
          "var(--font-geist-mono)",
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Monaco",
          "Consolas",
          "monospace",
        ],
      },
      transitionDuration: {
        DEFAULT: "150ms",
      },
      transitionTimingFunction: {
        DEFAULT: "cubic-bezier(0.33, 1, 0.68, 1)",
      },
    },
  },
  plugins: [typography],
};
export default config;
