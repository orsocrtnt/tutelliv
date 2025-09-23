import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx}",
    "./components/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: "#2563eb", // bleu principal
        secondary: "#6b7280", // gris
      },
      screens: {
        // (garde le système tailwind par défaut ; ajout optionnel si besoin)
      },
    },
  },
  plugins: [],
};

export default config;
