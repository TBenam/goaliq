# Ameliorations du moteur de pronostics GOLIAT

Ce document explique les changements apportes au pipeline de pronostics pour rendre l'application plus selective, plus fiable et plus economique en requetes Groq.

## Objectif

L'objectif n'est pas de faire analyser tous les matchs par l'IA. Ce serait couteux, lent et souvent inutile. La nouvelle logique consiste a:

- scanner tous les matchs avec un moteur rapide;
- rejeter les matchs faibles avec un vrai mode "No Bet";
- classer les meilleurs candidats selon leur qualite;
- envoyer seulement les meilleurs a Groq;
- ne jamais afficher de vieux pronos comme s'ils etaient encore valides.

L'utilisateur final ne voit pas si un prono vient de Groq ou d'un mecanisme de secours. Ces informations restent internes pour l'audit et le debug.

## Fichiers modifies

- `backend/jobs/scoringEngine.js`
- `backend/jobs/groqAnalyzer.js`
- `backend/jobs/collectMatches.js`
- `backend/routes/pronos.js`
- `backend/routes/admin.js`
- `backend/cache/manager.js`

## 1. Nouveau scoring multi-couches

Le moteur ne se limite plus au Poisson brut. Il calcule maintenant plusieurs couches internes:

- `dataQuality`: score de qualite des donnees disponibles.
- `valueEdge`: ecart entre notre probabilite et la probabilite implicite d'une cote bookmaker.
- `aiPriorityScore`: priorite d'analyse par Groq.
- `qualityGate`: decision de publier ou non le match.

Exemples de donnees prises en compte:

- forme recente;
- predictions API-Football;
- confrontations directes;
- cotes bookmaker;
- blessures;
- classement;
- calendrier et fatigue;
- meteo, xG avances et compositions probables si ces sources sont branchees plus tard.

## 2. Value betting et prix du marche

Le moteur enrichit maintenant les marches avec:

- cote juste estimee par le modele;
- cote bookmaker quand disponible;
- probabilite implicite de la cote;
- edge positif ou negatif;
- label interne: `strong_value`, `thin_value`, `fair_price`, `bad_price`, `unpriced`.

Un marche avec une mauvaise cote peut maintenant etre rejete meme si sa probabilite brute semble correcte.

## 3. No Bet Engine

Un match peut etre refuse si:

- la qualite des donnees est trop faible;
- la probabilite du meilleur marche est trop basse;
- la confiance interne est trop faible;
- le match est trop incertain;
- la cote bookmaker est defavorable.

C'est volontaire. Une application forte ne doit pas publier pour remplir une page. Elle doit savoir ne pas parier.

## 4. Budget Groq controle

Une nouvelle variable limite le nombre de matchs envoyes a Groq par cycle:

```env
GROQ_MAX_MATCHES_PER_RUN=6
```

Par defaut, seuls les 6 meilleurs candidats passent a Groq. Les autres restent en No Bet interne pour economiser les tokens.

Le classement utilise:

- confiance;
- qualite des donnees;
- probabilite du meilleur marche;
- edge value;
- importance de la ligue;
- signaux contradictoires qui meritent une analyse plus fine.

## 5. Cache frais obligatoire

Avant, l'API pouvait servir un cache vieux de plusieurs jours. Maintenant, les pronos trop anciens sont ignores.

Variable disponible:

```env
PRONOS_MAX_AGE_HOURS=12
```

Si le cache est trop vieux, les endpoints renvoient une liste vide et le frontend affiche ses etats "analyses en preparation".

Endpoints concernes:

- `GET /api/pronos/free`
- `GET /api/pronos/today`
- `GET /api/pronos/vip`

## 6. Pipeline manuel admin

Un endpoint admin permet de lancer une collecte + analyse sans attendre le cron:

```http
POST /api/admin/pipeline/run
Content-Type: application/json

{
  "secret": "VOTRE_SECRET_ADMIN"
}
```

Reponse attendue:

```json
{
  "success": true,
  "pronos_count": 4,
  "message": "4 pronos generes"
}
```

Cela sert pour forcer une regeneration apres avoir ajoute des cles API ou corrige un souci de donnees.

## 7. Sources futures recommandees

Le code accepte maintenant des champs internes prets pour des sources premium:

- `xg_metrics`
- `expected_lineups`
- `weather`
- `external_sources`

Sources prioritaires a connecter ensuite:

- Odds historiques et mouvements de cotes: Sportmonks Premium Odds, OddsPapi, The Odds API.
- xG reels: Sportmonks xG, StatsBomb, TheStatsAPI.
- Compositions probables: Sportmonks Expected Lineups.
- Meteo: Open-Meteo.
- News structurees: blessures tardives, rotation, coach suspendu, contexte derby.

## 8. Ce qu'il faut faire manuellement

Verifier ou ajouter dans `backend/.env`:

```env
GROQ_API_KEY=...
API_FOOTBALL_KEY=...
GROQ_MAX_MATCHES_PER_RUN=6
PRONOS_MAX_AGE_HOURS=12
THE_ODDS_API_KEY=...
THE_ODDS_API_REGIONS=eu
THE_ODDS_API_MARKETS=h2h
THE_ODDS_API_MAX_SPORTS_PER_RUN=4
THE_ODDS_API_CACHE_HOURS=6
```

Optionnel mais recommande:

```env
LOG_LEVEL=info
PIPELINE_INTERVAL_HOURS=8
RUN_PIPELINE_ON_START=true
```

Si tu veux brancher de nouvelles sources premium, il faudra obtenir les cles API correspondantes. Le code est pret a recevoir les donnees normalisees, mais les connecteurs Sportmonks/OddsPapi/Open-Meteo ne sont pas encore branches automatiquement.

## 10. Connexion The Odds API

The Odds API est connecte dans `backend/jobs/theOddsApiClient.js` et utilise par `backend/jobs/collectMatches.js`.

Le plan gratuit donne 500 credits par mois. Pour les economiser, l'integration actuelle:

- utilise seulement le marche `h2h` pour 1X2;
- utilise par defaut la region `eu`;
- fait un appel groupe par competition supportee, pas un appel par match;
- limite le nombre de competitions par cycle avec `THE_ODDS_API_MAX_SPORTS_PER_RUN`;
- garde un cache memoire pendant `THE_ODDS_API_CACHE_HOURS`.

Avec la configuration par defaut:

```env
THE_ODDS_API_MARKETS=h2h
THE_ODDS_API_REGIONS=eu
THE_ODDS_API_MAX_SPORTS_PER_RUN=4
THE_ODDS_API_CACHE_HOURS=6
```

Un cycle consomme au maximum environ 4 credits si 4 competitions mappables sont presentes. Le endpoint `/sports` de The Odds API ne coute pas de quota, mais le code actuel n'en a pas besoin en production car les principales ligues sont mappees localement.

Ce qui est disponible maintenant:

- cotes actuelles par bookmaker;
- consensus moyen home/draw/away;
- nombre de bookmakers;
- comparaison entre cote marche et cote juste du modele;
- `valueEdge` et `valueLabel` dans le scoring.

Ce qui reste non disponible avec ce branchement gratuit:

- opening odds;
- closing odds;
- historique complet des mouvements;
- sharp movement fiable.

Ces champs existent dans la structure (`opening`, `closing`, `movement`) mais restent `null` tant qu'un plan historique ou un fournisseur plus complet n'est pas branche.

## 9. Philosophie produit

GOLIAT doit devenir fort parce qu'il publie moins de mauvais pronos, pas parce qu'il publie plus de tickets.

Les axes importants sont:

- discipline No Bet;
- mesure de l'edge;
- controle du prix du marche;
- qualite des donnees;
- backtesting par ligue;
- backtesting par marche;
- suivi du closing line value;
- bankroll adaptee au risque.

La prochaine etape ideale est d'ajouter un module de resultats qui marque automatiquement chaque prono comme gagne/perdu et calcule ROI, Brier score et performance par categorie.
