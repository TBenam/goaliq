# Goliat CRM & VIP Suite

Ce document decrit les fonctionnalites CRM/VIP ajoutees a Goliat et la facon de les utiliser.

## Acces admin

L'espace admin est accessible depuis l'app via le petit bouton discret dans la barre du haut.

- URL directe: `http://localhost:5500/#admin`
- Mot de passe admin code en dur: `stabak`
- Backend CRM: `GET /api/admin/crm/overview?secret=stabak`

## Fonctionnalites admin

Le CRM admin permet de suivre:

- visites du jour
- pages vues du jour
- abonnements du jour
- argent encaisse
- performance 7 jours
- taux de conversion clic VIP -> abonnement
- panier moyen
- revenu par page vue
- revenus par plan
- top pages
- derniers abonnements
- VIP actifs, expires, proches expiration
- relances recommandees

## Activation VIP

Dans l'espace admin:

1. Entrer le mot de passe `stabak`.
2. Renseigner le code client `GIQ-XXXXXX`.
3. Choisir le plan.
4. Entrer le montant encaisse.
5. Entrer le numero WhatsApp si disponible.
6. Cliquer sur `Activer et enregistrer le paiement`.

L'activation cree l'acces VIP et enregistre une transaction dans SQLite.

## Tracking analytics

L'app envoie des evenements vers:

```text
POST /api/analytics/event
```

Evenements suivis:

- `page_view`
- `vip_checkout`
- `vip_activation_check`
- `admin_open`

Les donnees sont stockees dans `backend/db/data/goliat-local.db`.

## Espace VIP client

Pour les VIP, la page VIP contient:

- dashboard personnel
- profit suivi
- ROI personnel
- taux de tickets gagnes
- tickets en attente
- ajout du prono du jour au tracker
- ajout manuel d'un ticket
- statut gagne/perdu
- image partageable du ticket VIP
- rappel bankroll responsable

Le tracker personnel est stocke localement dans le navigateur du client avec `localStorage`.

## Records verifies

La page VIP affiche une synthese des resultats historiques:

- taux de reussite
- tickets gagnes
- tickets perdus
- cote moyenne

Objectif: renforcer la confiance sans promettre de gain garanti.

## Positionnement commercial

Goliat doit etre vendu comme:

> Une suite VIP pour parieurs francophones: pronostics IA, discipline bankroll, tracker de tickets, preuves de performance et accompagnement WhatsApp.

Le message important:

- ne pas vendre seulement des pronostics
- vendre un systeme complet pour mieux decider, suivre et progresser
- insister sur la discipline et le suivi, pas sur le reve de gain facile

## Commandes utiles

Backend:

```powershell
cd C:\Users\pc\Downloads\stitch_prono_ia_predictor\goaliq-pwa
$env:ENABLE_BACKGROUND_JOBS="false"
npm run api
```

Frontend:

```powershell
cd C:\Users\pc\Downloads\stitch_prono_ia_predictor\goaliq-pwa
npm run frontend
```

Puis ouvrir:

```text
http://localhost:5500
```

