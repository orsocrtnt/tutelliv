import localFont from "next/font/local";

/**
 * Sora (DESIGN.md : display, headline, title) chargée uniquement avec le portail client ; les autres espaces
 * gardent Inter seule. Variable posée par le layout du portail (div et <html>), règle dans globals.css.
 */
export const sora = localFont({
  src: "../../fonts/sora-latin-wght.woff2",
  weight: "100 800",
  variable: "--font-sora",
  display: "swap",
});
