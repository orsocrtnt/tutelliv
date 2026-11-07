import localFont from "next/font/local";

/** Police du site public, partagée par la barre et les pages : la barre reste identique partout, accueil compris. */
export const growthFont = localFont({
  src: "../../fonts/plus-jakarta-sans-latin-wght.woff2",
  weight: "200 800",
  variable: "--font-growth",
  display: "swap",
});
