import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#eef6ff",
          100: "#d8eaff",
          200: "#b8d8ff",
          300: "#89bdff",
          400: "#569bff",
          500: "#347eff",
          600: "#1e63f5",
          700: "#184ee0",
          800: "#1a43b5",
          900: "#1c3d8e"
        },
        ink: {
          900: "#1d222b",
          800: "#2e3744",
          700: "#414d5e",
          600: "#58667a"
        },
        accent: {
          sand: "#f5f1e7",
          teal: "#0f766e",
          amber: "#f59e0b",
          red: "#dc2626"
        }
      },
      boxShadow: {
        card: "0 6px 20px rgba(29, 34, 43, 0.08)"
      },
      borderRadius: {
        xl: "1rem",
        "2xl": "1.25rem"
      },
      fontFamily: {
        sans: ["var(--font-manrope)", "sans-serif"],
        display: ["var(--font-space-grotesk)", "sans-serif"]
      },
      backgroundImage: {
        "app-gradient": "linear-gradient(160deg, #f8fbff 0%, #e9f0ff 42%, #f7f4ec 100%)"
      }
    }
  },
  plugins: []
};

export default config;
