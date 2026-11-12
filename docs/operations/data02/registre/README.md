# Registre des effacements (DATA-02)

Un fichier `<companyId>.json` par entreprise effacée, écrit par `npm run data02:company-erasure -- erase <companyId> --apply` et jamais réécrit. C'est le manifeste de l'effacement : identifiant de l'entreprise, dates de l'export et de l'effacement, nombres d'éléments effacés, factures gardées (identifiant, chemin, empreinte). Aucune donnée personnelle.

Il est tenu dans le dépôt, hors de la base, pour qu'une restauration de sauvegarde ne le fasse pas disparaître : après toute restauration, `npm run data02:company-erasure -- replay-registry` ré-efface les entreprises revenues. Procédure : [`../README.md`](../README.md), section « Sauvegardes et reprise après restauration ».

Committer chaque nouveau fichier sur `preproduction` aussitôt après l'effacement. Ne jamais en supprimer.
