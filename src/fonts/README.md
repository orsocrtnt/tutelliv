# Polices hébergées dans le dépôt

Fichiers WOFF2 variables (sous-ensemble latin, accents français, `’` et `€` compris) copiés depuis Google Fonts le 7 novembre 2026 et chargés par `next/font/local`.
Raison : `next/font/google` les téléchargeait à chaque build ; quand Google renvoyait une adresse sans extension `.woff2`, le build CI échouait (`Cannot read properties of null (reading '1')`).

- `inter-latin-wght.woff2` : Inter v20, graisses 100–900 (`src/app/layout.tsx`)
- `sora-latin-wght.woff2` : Sora v17, graisses 100–800 (`src/app/(client-portal)/portal-font.ts`)
- `plus-jakarta-sans-latin-wght.woff2` : Plus Jakarta Sans v12, graisses 200–800 (`src/features/landing/growth-font.ts`)

Licence : SIL Open Font License 1.1 (https://openfontlicense.org).
