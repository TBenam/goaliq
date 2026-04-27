# Rapport d'audit Goliat

Date: 27 avril 2026

## Synthese

Goliat est passe d'une PWA de pronostics avec acces VIP a une base de suite business:

- CRM admin lie a l'app
- mot de passe admin code en dur
- tracking des visites et pages vues
- suivi des abonnements et encaissements
- segmentation VIP
- relances recommandees
- dashboard personnel VIP
- tracker de tickets
- image partageable de ticket VIP
- records verifies
- bankroll responsable

## Niveau de satisfaction

Satisfaction actuelle: 8/10.

Pourquoi pas 10/10:

- le tracker client est local au navigateur, pas encore synchronise par compte utilisateur
- le CRM utilise SQLite local, suffisant pour MVP, mais a migrer vers Firestore/Postgres en production multi-admin
- les odds comparison et line movements ne sont pas encore branches a une vraie API de cotes live
- les records verifies dependent de l'historique disponible dans l'app
- le lancement serveur local a rencontre un probleme Windows `Path/PATH` dans l'outil d'execution, meme si les controles syntaxiques passent

## Points forts

### Produit

- Le VIP n'est plus seulement une page de vente.
- Le client peut suivre sa bankroll et ses tickets.
- L'app affiche une posture plus professionnelle avec ROI, records, risque et discipline.
- Le CRM donne des actions commerciales concretes: relancer, reactiver, vendre un upgrade.

### Business

- Le CRM suit l'argent encaisse.
- Les plans sont mesurables par revenu.
- Les expirations VIP peuvent declencher des relances.
- Les clics VIP permettent de mesurer l'intention d'achat.

### Technique

- Le backend centralise les chiffres CRM dans SQLite.
- Le mot de passe admin est force a `stabak`.
- Les routes admin restent protegees par le mot de passe.
- Les evenements analytics sont separes dans `backend/routes/analytics.js`.
- Les changements restent compatibles avec l'architecture PWA existante.

## Risques identifies

### Securite admin

Un mot de passe code en dur est simple pour un MVP, mais pas ideal en production. Il faudra ensuite passer a:

- login admin
- session serveur
- rotation du mot de passe
- journalisation des actions admin

### Donnees utilisateur

Le tracker VIP local ne suit pas le client sur plusieurs appareils. Pour une vraie experience premium, il faudra synchroniser les tickets avec un compte.

### Donnees de cotes

Les fonctionnalites "line movement", alertes de cotes et odds comparison necessitent une source de donnees externe fiable.

### Conformite

L'app doit eviter toute promesse de gains garantis. Les messages de bankroll responsable sont une bonne base, mais il faut les renforcer avant une mise en production large.

## Tests effectues

Les controles syntaxiques suivants passent:

```text
node --check app.js
node --check backend/db/localDb.js
node --check backend/routes/admin.js
node --check backend/routes/analytics.js
node --check backend/server.js
```

Un test direct SQLite a confirme que:

- les evenements CRM peuvent etre enregistres
- les transactions peuvent etre enregistrees
- le rapport CRM retourne les totaux attendus

Les donnees de test ont ete supprimees apres verification.

## Recommandation finale

Goliat est pret pour une phase MVP commerciale plus serieuse. La prochaine priorite doit etre la synchronisation des tickets VIP par utilisateur et l'automatisation des relances WhatsApp.

