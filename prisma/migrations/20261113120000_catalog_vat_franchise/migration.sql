-- Franchise en base de TVA (art. 293 B du CGI) : TutelLiv, entrepreneur individuel en micro-entreprise,
-- ne facture pas de TVA sur ses abonnements (décision du propriétaire du 13 novembre 2026).
-- Donnée seulement : la version active du catalogue passe à 0 %. Les catalogues suivants recopient ce taux.
UPDATE saas_catalog_versions
SET vat_rate_bps = 0, updated_at = CURRENT_TIMESTAMP
WHERE code = 'C11-2026-11-04' AND status = 'ACTIVE';
