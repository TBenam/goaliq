/* ====================================================
   GOLIAT PWA – app.js
   SPA Router + Views + Gamification + PWA Logic
   ==================================================== */

'use strict';

/* ============================================================
   API & FIREBASE CONFIG
   ============================================================ */

// Auto-détecte l'URL : sur le serveur = même domaine/IP, en local = localhost:3001
const API_BASE = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
  ? 'http://localhost:3001/api'
  : `${window.location.protocol}//${window.location.hostname}/api`;

// Firebase config — Projet: goliat-8bf4a
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyA26ONSrmGIMw66QY__fClwDMlnFo-6UN4",
  authDomain: "goliat-8bf4a.firebaseapp.com",
  projectId: "goliat-8bf4a",
  storageBucket: "goliat-8bf4a.firebasestorage.app",
  messagingSenderId: "126041681895",
  appId: "1:126041681895:web:ddd88974dde8895b3bd742",
  // !! ACTION REQUISE: Ajouter la clé VAPID Firebase Cloud Messaging
  // Firebase Console → Paramètres Projet → Cloud Messaging → Certificats Push Web
  vapidKey: "BL1nSImv_eRyV2E0fvpESD-BePNSK0nz3c6JVFAdJD17CFckuOfFGF49ehLYQxKnh5nW6U4VOcEoGalNQGBh3v8"
};

// Firebase references (populated after initFirebase())
let _fbAuth = null;
let _fbMessaging = null;
let _fbUser = null; // Firebase anonymous user

/* ============================================================
   CONFIG — Liens de paiement MoneyFusion
   ============================================================ */
// ── Numéro WhatsApp GOLIAT ──────────────────────────
const WA_NUMBER = '237697259094';

// ── Génère un code client unique et persistant ───────
function getVipCode() {
  let code = localStorage.getItem('goliat_vip_code');
  if (!code) {
    // Génère GIQ-XXXXXX (6 chars alphanumériques)
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    code = 'GIQ-' + Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    localStorage.setItem('goliat_vip_code', code);
  }
  return code;
}

// ── Construit un lien WhatsApp avec message pré-rempli ─
function buildWaLink(plan) {
  const code = getVipCode();
  const messages = {
    weekly:    `Bonjour Goliat 👋\n\nJe souhaite souscrire au plan *VIP 7 jours* (3 500 FCFA).\n\nMon code d'activation : *${code}*\n\nMerci !`,
    monthly:   `Bonjour Goliat 👋\n\nJe souhaite souscrire au plan *VIP Mensuel* (10 000 FCFA).\n\nMon code d'activation : *${code}*\n\nMerci !`,
    quarterly: `Bonjour Goliat 👋\n\nJe souhaite souscrire au plan *VIP Trimestriel* (25 000 FCFA).\n\nMon code d'activation : *${code}*\n\nMerci !`,
    bonus:     `Bonjour Goliat 👋\n\nJe veux débloquer le *Prono Caché Bonus* (1 000 FCFA).\n\nMon code d'activation : *${code}*\n\nMerci !`
  };
  const msg = encodeURIComponent(messages[plan] || messages.monthly);
  return `https://wa.me/${WA_NUMBER}?text=${msg}`;
}

const CONFIG = {
  version: '1.0.0',
  appName: 'Goliat',
  payment: {
    weekly: {
      id: 'weekly',
      name: 'Hebdomadaire',
      price: '3 500',
      currency: 'FCFA',
      duration: '7 jours',
      features: ['Pronos quotidiens (7j)', 'Coupons combinés', 'Support WhatsApp'],
      highlight: false
    },
    monthly: {
      id: 'monthly',
      name: 'Mensuel',
      price: '10 000',
      currency: 'FCFA',
      duration: '30 jours',
      features: ['Analyses prioritaires', 'Scores exacts inclus', 'Groupe Telegram Privé', 'La Montante VIP'],
      highlight: true,
      badge: 'PLUS POPULAIRE'
    },
    quarterly: {
      id: 'quarterly',
      name: 'Trimestriel',
      price: '25 000',
      currency: 'FCFA',
      duration: '90 jours',
      features: ['Économisez 5 000 FCFA', 'Support VIP dédié 24/7', 'Accès Beta nouvelles options', 'Bankroll Manager'],
      highlight: false
    }
  }
};


const ANALYSES_POOL = [
  {
    free: {
      kicker: 'Bases Bankroll',
      titre: 'L\'importance de la gestion de bankroll',
      extrait: 'La règle numéro un du parieur n\'est pas de gagner, mais de ne pas tout perdre. Découvrez pourquoi miser plus de 5% de son capital sur un pari est une erreur mathématique qui mène inévitablement à la banqueroute.',
      emoji: '💰',
      bgGradient: 'linear-gradient(135deg, #1e3a8a, #3b82f6)'
    },
    vip: [
      {
        kicker: 'Modèles Probabilistes',
        titre: 'Modélisation Poisson : Scores exacts',
        extrait: 'La loi de Poisson permet de modéliser le nombre de buts attendus. En calculant les forces d\'attaque et de défense relatives, découvrez comment notre IA détecte les cotes "Value" sur les scores exacts.',
        emoji: '📐',
        temps: 'Il y a 3h'
      },
      {
        kicker: 'Smart Money',
        titre: 'Analyse des baisses de cotes (Dropping odds)',
        extrait: 'Suivez l\'argent intelligent. Une chute soudaine de la cote d\'une équipe à l\'extérieur indique souvent une information privée : blessure cachée ou rotation massive.',
        emoji: '📉',
        temps: 'Hier'
      }
    ]
  },
  {
    free: {
      kicker: 'Psychologie',
      titre: 'La psychologie du parieur : Éviter le tilt',
      extrait: 'Le "tilt", ou la perte de contrôle émotionnel après une série de paris perdants, est le pire ennemi du parieur. Apprenez à accepter la variance et à garder une approche logique.',
      emoji: '🧠',
      bgGradient: 'linear-gradient(135deg, #4c1d95, #8b5cf6)'
    },
    vip: [
      {
        kicker: 'Analyse Avancée',
        titre: 'Exploitation des Expected Goals (xG) en direct',
        extrait: 'Les xG ne servent pas qu\'à analyser le passé. En live, une équipe avec un fort différentiel de xG généré contre les buts réels marqués offre d\'énormes opportunités sur les paris.',
        emoji: '🎯',
        temps: 'Il y a 1h'
      },
      {
        kicker: 'Stratégie de Couverture',
        titre: 'Couvrir ses paris (Hedging)',
        extrait: 'Quand utiliser le Cash Out manuellement ? Le hedging permet de sécuriser des profits ou réduire les risques, mais les bookmakers prennent une marge. Voici la formule mathématique.',
        emoji: '🛡️',
        temps: 'Hier'
      }
    ]
  },
  {
    free: {
      kicker: 'Concept Clé',
      titre: 'Comprendre la "Value Bet" : L\'essentiel',
      extrait: 'Parier sur une équipe juste parce qu\'elle "va gagner" est une erreur. Une Value Bet existe uniquement quand la probabilité réelle de l\'événement est supérieure à celle estimée par la cote.',
      emoji: '💎',
      bgGradient: 'linear-gradient(135deg, #14532d, #22c55e)'
    },
    vip: [
      {
        kicker: 'Stratégie Live',
        titre: 'Corners pour trouver des values en live',
        extrait: 'La domination territoriale ne se traduit pas toujours par des buts. L\'analyse croisée de la possession dans le tiers adverse et des corners concédés permet de parier intelligemment.',
        emoji: '🚩',
        temps: 'Il y a 4h'
      },
      {
        kicker: 'Facteurs Externes',
        titre: 'Fatigue structurelle : l\'impact du calendrier',
        extrait: 'Les équipes jouant l\'Europe en milieu de semaine sous-performent statistiquement de 14% lors de leur match de championnat suivant. Comment identifier ces failles de cotation.',
        emoji: '🔋',
        temps: 'Avant-hier'
      }
    ]
  },
  {
    free: {
      kicker: 'Les Pièges',
      titre: 'Pourquoi éviter les paris combinés gigantesques',
      extrait: 'Les bookmakers adorent les parieurs qui combinent 10 matchs. La marge du bookmaker se multiplie à chaque sélection, détruisant mathématiquement toute espérance de gain sur le long terme.',
      emoji: '⚠️',
      bgGradient: 'linear-gradient(135deg, #7f1d1d, #ef4444)'
    },
    vip: [
      {
        kicker: 'Profilage',
        titre: 'Les paris sur les buteurs : croiser xG et faiblesses',
        extrait: 'Parier sur un buteur demande plus que son nom. Découvrez comment nous croisons les "Expected Goals" d\'un attaquant avec la propension de l\'équipe adverse à concéder des occasions.',
        emoji: '👟',
        temps: 'Il y a 2h'
      },
      {
        kicker: 'Marchés de niche',
        titre: 'Erreurs de cotation sur les ligues mineures',
        extrait: 'Les bookmakers manquent de données précises sur les championnats de seconde division ou les ligues exotiques. C\'est là que les algorithmes prédictifs créent le plus de marge.',
        emoji: '🌍',
        temps: 'Hier'
      }
    ]
  },
  {
    free: {
      kicker: 'Analyse Météo',
      titre: 'L\'impact de la météo sur les matchs de football',
      extrait: 'Ne pariez jamais sans regarder la météo. Une forte pluie ou des vents violents nivellent les niveaux techniques et augmentent drastiquement la probabilité de matchs pauvres en buts.',
      emoji: '⛈️',
      bgGradient: 'linear-gradient(135deg, #0f766e, #14b8a6)'
    },
    vip: [
      {
        kicker: 'Stratégie',
        titre: 'Stratégie avancée sur le "Draw No Bet" (DNB)',
        extrait: 'Le pari "Remboursé si Nul" est sous-utilisé. Il permet de sécuriser des cotes intéressantes tout en éliminant un des trois résultats possibles. Découvrez dans quelles configurations il est indispensable.',
        emoji: '⚖️',
        temps: 'Il y a 5h'
      },
      {
        kicker: 'Gestion de Capital',
        titre: 'Modèle de Kelly Criterion pour optimiser les mises',
        extrait: 'Plutôt que des mises fixes, le critère de Kelly ajuste la taille de votre pari proportionnellement à la Value détectée (Avantage). Une approche mathématique pour maximiser la croissance.',
        emoji: '📈',
        temps: 'Il y a 10h'
      }
    ]
  }
];

function generateBigMatchAiAnalysis(match) {
  const matchLabel = match.match || `${match.equipe1 || 'Équipe'} vs ${match.equipe2 || 'Adversaire'}`;
  return {
    kicker: 'Intelligence Artificielle',
    titre: `Décryptage IA : ${matchLabel}`,
    extrait: `Nos algorithmes ont ciblé cette affiche majeure de ${match.competition || 'Championnat'}. En modélisant les Expected Goals (xG), la profondeur de banc et la variance de forme récente, l'IA identifie une forte Value sur le prono "${match.prono}". Le raisonnement s'appuie sur la corrélation entre les zones de faiblesses défensives adverses et le volume de création d'occasions de l'équipe ciblée. Edge détecté à la cote de @${match.cote}.`,
    emoji: '🤖',
    temps: 'À l\'instant',
    isAiGen: true
  };
}

function getDailyAnalyses() {
  const dayIndex = new Date().getDate() % ANALYSES_POOL.length;
  // Clone to avoid mutating the static pool
  const daily = JSON.parse(JSON.stringify(ANALYSES_POOL[dayIndex]));

  // Inject dynamic AI analysis for big matches if any are available today
  const allPronos = [...(DATA.pronos_gratuits || []), ...(DATA.pronos_vip || [])];
  const topComps = ['champions league', 'ligue des champions', 'premier league', 'laliga', 'serie a', 'europa league', 'euro', 'world cup', 'mondial'];
  
  const bigMatch = allPronos.find(p => p && p.competition && topComps.some(c => p.competition.toLowerCase().includes(c)));
  
  if (bigMatch) {
    const aiArticle = generateBigMatchAiAnalysis(bigMatch);
    // Add it as the first VIP article so it appears prominently in the expert feed
    daily.vip.unshift(aiArticle);
  }

  return daily;
}

/* ============================================================
   DATA — Pronostics, articles, témoignages
   ============================================================ */
const DATA = {
  stats: { taux: 84, roi: '+14.2u', cote_vip: '4.50', membres: '2 847' },

  pronos_gratuits: [],

  pronos_vip: [],

  historique: [],

  tendances: [
    { rang: '01', titre: 'Chute des cotes sur le favori', detail: 'Volume de mises anormal sur le nul détecté.' },
    { rang: '02', titre: 'Faille détectée en Serie A', detail: 'Concentration de data sur les corners.' },
    { rang: '03', titre: 'Anomalie des déplacements en Ligue 1', detail: 'Moins de 2.5 buts à 78% sur 10 matchs.' }
  ],

  temoignages: [
    { texte: "J'ai transformé 30 000 FCFA en 1 500 000 FCFA en 7 jours grâce à La Montante VIP. C'est du sérieux.", auteur: 'Mamadou K.', ville: 'Dakar', pays: '🇸🇳', etoiles: 5 },
    { texte: "GOLIAT est le seul service qui m'a rendu rentable en 6 mois de paris. Les analyses sont vraiment différentes.", auteur: 'Kouassi A.', ville: 'Abidjan', pays: '🇨🇮', etoiles: 5 },
    { texte: "Les grosses cotes VIP sont dingues. J'ai touché @12.00 sur un score exact la semaine dernière.", auteur: 'Ibrahima D.', ville: 'Bamako', pays: '🇲🇱', etoiles: 5 },
    { texte: "Le groupe Telegram est incroyable. Les alertes arrivent 2h avant les autres. J'ai le temps de cliquer.", auteur: 'Chantal M.', ville: 'Douala', pays: '🇨🇲', etoiles: 5 }
  ],

  live_feed: [
    { nom: 'Moussa', ville: 'Dakar', gain: '+87 500 FCFA', action: 'validé la Montante Jour 7' },
    { nom: 'Fatou', ville: 'Abidjan', gain: '+42 000 FCFA', action: 'gagné le coupon combiné @4.50' },
    { nom: 'Kofi', ville: 'Accra', gain: '+18 200 FCFA', action: 'validé le prono Safe @1.85' },
    { nom: 'Aminata', ville: 'Bamako', gain: '+215 000 FCFA', action: 'touché le score exact @9.00' },
    { nom: 'Franck', ville: 'Douala', gain: '+55 000 FCFA', action: 'validé le combo Serie A' },
    { nom: 'Modibo', ville: 'Conakry', gain: '+31 500 FCFA', action: 'gagné avec les grosses cotes VIP' }
  ],

  montante: {
    objectif: '100 000 FCFA',
    depart: '10 000 FCFA',
    actuel: '24 500 FCFA',
    duree: '7 jours',
    rendement: '+900%',
    jour_actuel: 3,
    paliers: [
      { jour: 1, match: 'Match Ligue 1 — Safe', prono: 'Favori over 1.5 buts', cote: 1.30, gain: '+3 000', gagne: true },
      { jour: 2, match: 'Match LaLiga — Safe', prono: 'Victoire favori domicile', cote: 1.45, gain: '+4 500', gagne: true },
      { jour: 3, match: 'Match Ligue 1 — Value', prono: 'Victoire extérieur', cote: 1.85, gain: null, gagne: null }
    ]
  }
};

if (DATA.temoignages?.[1]?.texte) {
  DATA.temoignages[1].texte = DATA.temoignages[1].texte.replace('GOLIAT', CONFIG.appName);
}

function getCurrentDateLabel() {
  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: 'long'
  }).format(new Date());
}

function getCurrentDateLabelWithYear() {
  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric'
  }).format(new Date());
}

function formatKickoffTime(kickoff) {
  if (!kickoff) return '--:--';
  const date = new Date(kickoff);
  if (Number.isNaN(date.getTime())) return '--:--';

  return date.toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit'
  });
}

function mapPronoForUi(prono = {}, options = {}) {
  const locked = options.locked ?? Boolean(prono.locked);
  const hideDetails = options.hideDetails ?? false;
  const matchLabel = prono.match || [prono.home_team, prono.away_team].filter(Boolean).join(' vs ') || 'Match à confirmer';
  const odds = prono.cote ?? prono.cote_estimee;

  return {
    id: prono.fixture_id || prono.id || `${matchLabel}-${prono.kickoff || prono.heure || ''}`,
    fixture_id: prono.fixture_id || prono.id || null,
    competition: prono.competition || prono.league_name || 'Pronostic du jour',
    match: matchLabel,
    equipe1: prono.equipe1 || '⚽',
    equipe2: prono.equipe2 || '🏆',
    home_team_logo: prono.home_team_logo || null,
    away_team_logo: prono.away_team_logo || null,
    prono: hideDetails ? 'Verrouillé' : (prono.prono || prono.prono_principal || 'Analyse en cours'),
    cote: hideDetails ? '?.??' : (odds ?? '--'),
    heure: prono.heure || formatKickoffTime(prono.kickoff),
    fiabilite: Number.isFinite(Number(prono.fiabilite)) ? Number(prono.fiabilite) : 0,
    categorie: prono.categorie || (locked ? 'VIP' : 'Pronostic'),
    description: prono.description || prono.analyse_courte || '',
    analyse_vip: prono.analyse_vip || '',
    locked
  };
}

function splitMatchLabel(match = '') {
  const [home = 'Equipe 1', away = 'Equipe 2'] = String(match).split(' vs ');
  return { home, away };
}

function getTeamVisual(logo, fallback, alt) {
  if (logo) {
    return `<img src="${logo}" alt="${alt}" style="width:100%;height:100%;object-fit:contain;">`;
  }
  return fallback || '⚽';
}

function jsStringLiteral(value) {
  return JSON.stringify(String(value || ''));
}

function getFeaturedProno() {
  return DATA.pronos_gratuits[0] || DATA.pronos_vip[0] || null;
}

function buildFeaturedPronoCard() {
  const featuredProno = getFeaturedProno();
  if (!featuredProno) {
    return `
      <div class="card-elevated mb-6" id="main-match-card" style="padding:28px;text-align:center;">
        <span class="material-symbols-outlined" style="font-size:3rem;color:var(--primary);margin-bottom:12px;display:block;opacity:0.5;">hourglass_top</span>
        <div style="font-weight:900;font-size:1.1rem;margin-bottom:6px;">Analyses en cours…</div>
        <div style="font-size:0.82rem;color:var(--on-surface-variant);line-height:1.6;max-width:280px;margin:0 auto;">Notre IA analyse les matchs du jour. Le pronostic principal apparaîtra ici dès qu’il sera prêt.</div>
        <div style="margin-top:20px;display:flex;flex-direction:column;gap:10px;">
          <div style="height:50px;background:var(--surface-container);border-radius:var(--radius-lg);animation:pulse-badge 1.5s infinite;"></div>
          <div style="height:30px;background:var(--surface-container-high);border-radius:var(--radius-md);width:70%;margin:0 auto;animation:pulse-badge 1.5s infinite;"></div>
        </div>
      </div>`;
  }
  const { home, away } = splitMatchLabel(featuredProno?.match);
  const competition = featuredProno?.competition || 'Pronostic du jour';
  const kickoff = featuredProno?.heure || '--:--';
  const prono = featuredProno?.prono || 'Analyse en cours';
  const cote = featuredProno?.cote || '--';
  const analysis = featuredProno?.analyse_vip || featuredProno?.description || 'Les analyses automatiques seront affichées ici dès que le pipeline serveur termine son cycle.';
  const shareMatch = jsStringLiteral(featuredProno?.match || CONFIG.appName);
  const shareProno = jsStringLiteral(prono);
  const shareCote = Number(featuredProno?.cote || 0);

  return `
    <div class="card-elevated mb-6" id="main-match-card">
      <div style="padding:20px;padding-bottom:0;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
          <span class="badge badge-primary">${competition}</span>
          <span style="display:flex;align-items:center;gap:5px;font-size:0.78rem;font-weight:600;color:var(--outline);">
            <span class="material-symbols-outlined icon-sm">schedule</span> ${kickoff}
          </span>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:0 12px;margin-bottom:14px;">
          <div style="display:flex;flex-direction:column;align-items:center;gap:8px;flex:1;">
            <div style="width:60px;height:60px;background:var(--surface-container);border-radius:14px;display:flex;align-items:center;justify-content:center;font-size:2rem;">${getTeamVisual(featuredProno?.home_team_logo, featuredProno?.equipe1 || '⚽', home)}</div>
            <span style="font-weight:700;font-size:0.82rem;text-align:center;">${home}</span>
          </div>
          <span style="font-weight:900;font-size:1rem;color:var(--outline-variant);opacity:0.3;">VS</span>
          <div style="display:flex;flex-direction:column;align-items:center;gap:8px;flex:1;">
            <div style="width:60px;height:60px;background:var(--surface-container);border-radius:14px;display:flex;align-items:center;justify-content:center;font-size:2rem;">${getTeamVisual(featuredProno?.away_team_logo, featuredProno?.equipe2 || '🏆', away)}</div>
            <span style="font-weight:700;font-size:0.82rem;text-align:center;">${away}</span>
          </div>
        </div>
        <div style="background:var(--surface-container-low);border-radius:var(--radius-lg);padding:14px;display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
          <div>
            <div style="font-size:0.62rem;font-weight:800;text-transform:uppercase;letter-spacing:0.1em;color:var(--outline);">Pronostic IA</div>
            <div style="font-size:1rem;font-weight:900;color:var(--primary);margin-top:2px;">${prono}</div>
          </div>
          <div style="text-align:right;">
            <div style="font-size:0.62rem;font-weight:800;text-transform:uppercase;letter-spacing:0.1em;color:var(--outline);">Cote</div>
            <div style="font-size:1.5rem;font-weight:900;">@${cote}</div>
          </div>
        </div>
      </div>

      <div style="position:relative;overflow:hidden;">
        <div style="padding:16px 20px;background:rgba(231,232,233,0.4);filter:blur(5px);pointer-events:none;">
          <div style="font-weight:700;font-size:0.9rem;margin-bottom:8px;">Analyse Tactique</div>
          <div style="font-size:0.82rem;color:var(--on-surface-variant);line-height:1.6;">${analysis}</div>
          <div style="height:10px;background:rgba(187,202,191,0.3);border-radius:6px;width:80%;margin-top:8px;"></div>
        </div>
        <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);background:rgba(225,227,228,0.55);">
          <span style="font-size:1.6rem;">🔒</span>
          <span style="font-size:0.75rem;font-weight:800;text-transform:uppercase;letter-spacing:0.1em;color:var(--on-surface);">Analyse Tactique VIP</span>
          <button class="btn-ghost" onclick="Modal.open()">Passer VIP</button>
        </div>
      </div>

      <div style="padding:16px 20px;display:flex;gap:10px;align-items:center;">
        <button class="btn-primary" style="flex:1;" onclick="UI.shareTicket(${shareMatch},${shareProno},${shareCote})">
          <span class="material-symbols-outlined icon-sm">confirmation_number</span> VOIR LE TICKET
        </button>
        <button style="width:48px;height:48px;background:var(--surface-container);border-radius:50%;display:flex;align-items:center;justify-content:center;border:none;cursor:pointer;color:#25D366;font-size:1.2rem;" onclick="UI.shareTicket(${shareMatch},${shareProno},${shareCote})">
          <span class="material-symbols-outlined">share</span>
        </button>
      </div>
    </div>`;
}

function hydrateRenderedView(container, view) {
  container.innerHTML = container.innerHTML
    .replaceAll('21 Avril 2026', getCurrentDateLabelWithYear())
    .replaceAll('21 Avril', getCurrentDateLabel());

  if (view === 'pronos') {
    const subtitle = container.querySelector('.view > div:first-child p');
    if (subtitle) {
      subtitle.textContent = `Les pépites IA pour aujourd'hui — ${getCurrentDateLabel()}`;
    }
  }
}

async function refreshLiveData() {
  try {
    const [freePronos, todayData, history, vipPronos] = await Promise.all([
      API.loadFreeProno(),
      API.loadTodayPronos(),
      API.loadHistory(),
      STATE.isVip ? API.loadVipProno() : Promise.resolve(null)
    ]);

    if (freePronos?.length > 0) {
      DATA.pronos_gratuits = freePronos;
    } else if (todayData?.free?.length > 0) {
      DATA.pronos_gratuits = todayData.free.map((p) => mapPronoForUi(p));
    }

    if (history?.length > 0) {
      DATA.historique = history;
    }

    if (STATE.isVip && vipPronos?.length > 0) {
      DATA.pronos_vip = vipPronos;
    } else if (todayData?.vip_preview?.length > 0) {
      DATA.pronos_vip = todayData.vip_preview.map((p) =>
        mapPronoForUi(p, {
          locked: p.locked !== false,
          hideDetails: p.locked !== false
        })
      );
    }

    if (todayData?.meta?.total > 0) {
      console.info(`[${CONFIG.appName}] ${todayData.meta.total} pronos chargés depuis le serveur ✅`);
    }

    if (['accueil', 'pronos', 'vip'].includes(STATE.currentView)) {
      App.render(STATE.currentView);
    }
  } catch (err) {
    console.warn('[Init] Synchronisation live impossible:', err.message);
  }
}

/* ============================================================
   FIREBASE CLIENT — Initialize lazily when IDs are available
   ============================================================ */
const FirebaseClient = {
  isReady: false,

  async init() {
    // Skip if Firebase IDs not yet configured
    if (FIREBASE_CONFIG.apiKey === 'VOTRE_API_KEY') {
      console.info('[Firebase] Config manquante. Fonctionnement en mode hors-ligne Firebase.');
      return;
    }

    try {
      // Dynamically import Firebase modules (CDN)
      const { initializeApp } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js');
      const { getAuth, signInAnonymously } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js');
      const { getMessaging, getToken, onMessage } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging.js');

      const app = initializeApp(FIREBASE_CONFIG);
      _fbAuth = getAuth(app);

      // Anonymous sign-in (gets a stable UID for this device)
      const cred = await signInAnonymously(_fbAuth);
      _fbUser = cred.user;
      console.info('[Firebase] Connecté anonymement:', _fbUser.uid);

      // Register user in backend
      await API.registerUser();

      // FCM setup
      try {
        _fbMessaging = getMessaging(app);
        const token = await getToken(_fbMessaging, { vapidKey: FIREBASE_CONFIG.vapidKey });
        if (token) {
          await API.subscribeNotifications(token);
          console.info('[FCM] Token enregistré');
        }

        // Handle foreground messages
        onMessage(_fbMessaging, (payload) => {
          const { title, body } = payload.notification || {};
          if (title && body) UI.showToast(`🔔 ${title}`);
        });
      } catch (fcmErr) {
        console.warn('[FCM] Non disponible:', fcmErr.message);
      }

      this.isReady = true;
    } catch (err) {
      console.warn('[Firebase] Erreur init:', err.message);
    }
  },

  async getIdToken() {
    if (!_fbUser) return null;
    return _fbUser.getIdToken();
  }
};

/* (shareTicket is defined once in the UI object — duplicates removed) */

/* ============================================================
   API LAYER — Calls to backend, with static DATA fallback
   ============================================================ */
const API = {
  // ── Shared fetch with auth header ─────────────────
  async fetch(path, options = {}) {
    const token = await FirebaseClient.getIdToken();
    const headers = {
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      ...options.headers
    };

    const response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw Object.assign(new Error(err.error || `HTTP ${response.status}`), { status: response.status, code: err.code });
    }
    return response.json();
  },

  // ── Register user in Firestore ─────────────────────
  async registerUser() {
    try {
      await this.fetch('/auth/register', { method: 'POST' });
    } catch (err) {
      console.warn('[API] Erreur register:', err.message);
    }
  },

  // ── Load free pronos ───────────────────────────────
  async loadFreeProno() {
    try {
      const pronos = await this.fetch('/pronos/free');
      // If API returns empty (no data yet), keep static fallback
      if (!pronos || pronos.length === 0) return DATA.pronos_gratuits;

      // Map API response → component format
      return pronos.map(p => ({
        id: p.fixture_id || p.id,
        competition: p.competition,
        match: p.match,
        equipe1: p.home_team_logo ? '' : '⚽',
        equipe2: p.away_team_logo ? '' : '🏆',
        home_team_logo: p.home_team_logo,
        away_team_logo: p.away_team_logo,
        prono: p.prono,
        cote: p.cote,
        heure: p.heure,
        fiabilite: p.fiabilite,
        categorie: p.categorie,
        description: p.description,
        analyse_vip: p.analyse_vip
      }));
    } catch (err) {
      console.warn('[API] Fallback pronos gratuits:', err.message);
      return DATA.pronos_gratuits; // Static fallback
    }
  },

  // ── Load today's pronos (free + VIP preview) ──────
  async loadTodayPronos() {
    try {
      const result = await this.fetch('/pronos/today');
      if (!result?.free?.length && !result?.vip_preview?.length) return null;
      return result;
    } catch (err) {
      console.warn('[API] Fallback today:', err.message);
      return null;
    }
  },

  // ── Load VIP pronos (requires VIP auth) ───────────
  async loadVipProno() {
    try {
      const pronos = await this.fetch('/pronos/vip');
      return (pronos || []).map(p => ({
        id: p.fixture_id,
        competition: p.competition,
        match: p.match,
        equipe1: p.home_team_logo ? '' : '⚽', equipe2: p.away_team_logo ? '' : '🏆',
        home_team_logo: p.home_team_logo,
        away_team_logo: p.away_team_logo,
        prono: p.prono,
        cote: p.cote,
        heure: p.heure,
        fiabilite: p.fiabilite,
        categorie: p.categorie,
        description: p.description,
        analyse_vip: p.analyse_vip,
        locked: false
      }));
    } catch (err) {
      if (err.code === 'VIP_REQUIRED') return null; // User not VIP
      console.warn('[API] Fallback pronos VIP:', err.message);
      return DATA.pronos_vip;
    }
  },

  // ── Load history ───────────────────────────────────
  async loadHistory() {
    try {
      const { history, stats } = await this.fetch('/pronos/history');
      const mapped = (history || []).map(p => ({
        match: p.match,
        marche: p.prono,
        cote: p.cote,
        ligue: p.competition,
        date: p.kickoff ? new Date(p.kickoff).toLocaleDateString('fr', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '--',
        gagne: p.result === 'won'
      }));
      if (stats) DATA.stats.taux = stats.win_rate;
      return mapped;
    } catch (err) {
      console.warn('[API] Fallback historique:', err.message);
      return DATA.historique;
    }
  },

  // ── Activate VIP via code ──────────────────────────
  async activateVip(code) {
    const result = await this.fetch('/auth/activate-vip', {
      method: 'POST',
      body: JSON.stringify({ code })
    });
    if (result.success) {
      STATE.setVip(true);
      UI.showToast(`🎉 ${result.message}`);
    }
    return result;
  },

  // ── Get user profile ───────────────────────────────
  async getMe() {
    try {
      const { user } = await this.fetch('/auth/me');
      if (user.is_vip) STATE.setVip(true);
      if (user.streak) STATE.streak = user.streak;
      return user;
    } catch { return null; }
  },

  // ── Subscribe FCM token ────────────────────────────
  async subscribeNotifications(token) {
    try {
      await this.fetch('/notifications/subscribe', {
        method: 'POST',
        body: JSON.stringify({ token, platform: 'web' })
      });
    } catch (err) {
      console.warn('[API] Erreur subscription:', err.message);
    }
  }
};

API.loadFreeProno = async function () {
  try {
    const pronos = await this.fetch('/pronos/free');
    if (!pronos || pronos.length === 0) return DATA.pronos_gratuits;
    return pronos.map((p) => mapPronoForUi(p));
  } catch (err) {
    console.warn('[API] Fallback pronos gratuits:', err.message);
    return DATA.pronos_gratuits;
  }
};

API.loadVipProno = async function () {
  try {
    const pronos = await this.fetch('/pronos/vip');
    return (pronos || []).map((p) => mapPronoForUi(p, { locked: false }));
  } catch (err) {
    if (err.code === 'VIP_REQUIRED') return null;
    console.warn('[API] Fallback pronos VIP:', err.message);
    return DATA.pronos_vip;
  }
};

/* ============================================================
   STATE
   ============================================================ */
const STATE = {
  currentView: 'accueil',
  isVip: false,
  streak: 1,
  deferredInstallPrompt: null,
  lastDataRefresh: null,       // Timestamp of last successful API data load
  _countdownIntervals: [],     // Countdown timer interval IDs
  _gainPopupTimer: null,       // Social proof popup timer
  _flashTimerInterval: null,   // Flash offer countdown interval

  init() {
    // VIP status
    this.isVip = localStorage.getItem('goliat_vip') === 'true';

    // Streak logic
    const today = new Date().toDateString();
    const lastVisit = localStorage.getItem('goliat_last_visit');
    const storedStreak = parseInt(localStorage.getItem('goliat_streak') || '0', 10);

    if (!lastVisit) {
      this.streak = 1;
    } else {
      const lastDate = new Date(lastVisit);
      const nowDate = new Date();
      const diffDays = Math.floor((nowDate - lastDate) / (1000 * 60 * 60 * 24));
      if (diffDays === 0) this.streak = storedStreak || 1;
      else if (diffDays === 1) this.streak = storedStreak + 1;
      else this.streak = 1;
    }

    localStorage.setItem('goliat_last_visit', today);
    localStorage.setItem('goliat_streak', this.streak);
  },

  setVip(value) {
    this.isVip = value;
    localStorage.setItem('goliat_vip', value);
  }
};

/* ============================================================
   ROUTER
   ============================================================ */
const Router = {
  navigate(view) {
    STATE.currentView = view;
    App.render(view);
    App.updateNav(view);
    document.getElementById('app-content').scrollTo({ top: 0, behavior: 'smooth' });

    // Update hash for deep linking
    history.replaceState(null, '', `#${view}`);

    // Show go-vip button only on non-vip views
    const goVipBtn = document.getElementById('go-vip-btn');
    if (goVipBtn) {
      goVipBtn.style.display = (STATE.isVip && view !== 'accueil') ? 'none' : 'flex';
    }
  },

  init() {
    const hash = window.location.hash.replace('#', '');
    const validViews = ['accueil', 'pronos', 'journal', 'vip'];
    const startView = validViews.includes(hash) ? hash : 'accueil';
    this.navigate(startView);

    window.addEventListener('hashchange', () => {
      const h = window.location.hash.replace('#', '');
      if (validViews.includes(h)) App.render(h);
    });
  }
};

/* ============================================================
   COMPONENTS — Reusable HTML fragments
   ============================================================ */
const C = {
  // Glassmorphic paywall lock
  glassLock(label = 'Contenu VIP') {
    return `
      <div class="glass-veil" onclick="Modal.open()" role="button" tabindex="0" aria-label="Débloquer l'accès VIP">
        <div class="lock-icon-wrap">
          <span class="material-symbols-outlined icon-filled" style="color:#2a1700;font-size:1.4rem;">lock</span>
        </div>
        <span class="lock-label">${label}</span>
        <span class="lock-cta">Passer VIP →</span>
      </div>`;
  },

  // Match card (free)
  matchCard(prono) {
    const { home, away } = splitMatchLabel(prono.match);
    const countdownHtml = Enhancements.buildCountdownBadge(prono.kickoff || prono.heure);
    const liveStatus = Enhancements.getLiveStatus(prono);
    return `
      <div class="match-card mb-4">
        <div class="match-header">
          <span class="badge badge-primary">${prono.competition}</span>
          <div style="display:flex;align-items:center;gap:6px;">
            ${liveStatus ? `<span class="live-badge">${liveStatus}</span>` : ''}
            ${countdownHtml || `<span style="font-size:0.78rem;font-weight:600;color:var(--outline);">${prono.heure}</span>`}
          </div>
        </div>
        <div class="match-teams">
          <div class="team">
            <div class="team-logo">${getTeamVisual(prono.home_team_logo, prono.equipe1, home)}</div>
            <span>${home}</span>
          </div>
          <span class="match-vs">VS</span>
          <div class="team" style="flex-direction:row-reverse;text-align:right;">
            <div class="team-logo">${getTeamVisual(prono.away_team_logo, prono.equipe2, away)}</div>
            <span>${away}</span>
          </div>
        </div>
        <div class="prediction-row" style="margin-bottom:10px;">
          <div>
            <div class="prediction-label">Pronostic IA</div>
            <div class="prediction-value">${prono.prono}</div>
          </div>
          <div style="text-align:right;">
            <div class="prediction-label">Cote</div>
            <div class="match-odds">@${prono.cote}</div>
          </div>
        </div>
        <div class="progress-bar-track" style="margin-bottom:4px;">
          <div class="progress-bar-fill" style="width:${prono.fiabilite}%;"></div>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;font-size:0.65rem;font-weight:800;text-transform:uppercase;letter-spacing:0.08em;color:var(--outline);">
          <span>Fiabilité : ${prono.fiabilite}%</span>
          <button onclick="UI.shareTicket('${prono.match}','${prono.prono}',${prono.cote})" style="background:none;border:none;color:var(--primary);font-size:0.75rem;font-weight:700;display:flex;align-items:center;gap:3px;cursor:pointer;">
            <span class="material-symbols-outlined icon-sm">share</span> Partager
          </button>
        </div>
      </div>`;
  },

  // VIP locked match card
  matchCardLocked(prono) {
    const { home, away } = splitMatchLabel(prono.match);
    return `
      <div class="match-card mb-4" style="position:relative;min-height:130px;overflow:hidden;">
        <div style="filter:blur(4px);pointer-events:none;">
          <div class="match-header">
            <span class="badge badge-gold">${prono.competition}</span>
            <span style="font-size:0.78rem;font-weight:600;color:var(--outline);">${prono.heure}</span>
          </div>
          <div class="match-teams">
            <div class="team"><div class="team-logo">${getTeamVisual(prono.home_team_logo, prono.equipe1, home)}</div><span>${home}</span></div>
            <span class="match-vs">VS</span>
            <div class="team" style="flex-direction:row-reverse;"><div class="team-logo">${getTeamVisual(prono.away_team_logo, prono.equipe2, away)}</div><span>${away}</span></div>
          </div>
        </div>
        ${C.glassLock(prono.categorie + ' VIP')}
      </div>`;
  },

  // History item
  historyItem(item) {
    return `
      <div class="history-item">
        <div class="history-info">
          <div class="history-match">${item.match}</div>
          <div class="history-meta">${item.ligue} · ${item.date} · ${item.marche}</div>
        </div>
        <div class="history-right">
          <div class="odds-display" style="color:${item.gagne ? 'var(--on-surface)' : 'var(--outline)'};">@${item.cote}</div>
          <span class="badge ${item.gagne ? 'badge-won' : 'badge-lost'}">${item.gagne ? '✓ GAGNÉ' : '✗ PERDU'}</span>
        </div>
      </div>`;
  },

  // Testimonial (used in carousel)
  testimonial(t) {
    return `
      <div class="testimonial-card">
        <div class="testimonial-stars">${'★'.repeat(t.etoiles)}</div>
        <div class="testimonial-body">"${t.texte}"</div>
        <div class="testimonial-author">— ${t.auteur}, ${t.ville} ${t.pays}</div>
      </div>`;
  },

  // Testimonial carousel with dots
  testimonialCarousel(testimonials) {
    return `
      <div class="testimonial-carousel" id="testimonial-carousel">
        ${testimonials.map(t => this.testimonial(t)).join('')}
      </div>
      <div class="carousel-dots" id="carousel-dots">
        ${testimonials.map((_, i) => `<div class="carousel-dot ${i === 0 ? 'active' : ''}" data-idx="${i}"></div>`).join('')}
      </div>`;
  },

  // Last updated timestamp
  lastUpdated() {
    if (!STATE.lastDataRefresh) return '';
    const ago = Enhancements.timeAgo(STATE.lastDataRefresh);
    return `
      <div class="last-updated">
        <span class="material-symbols-outlined">update</span>
        Mis à jour ${ago}
      </div>`;
  },

  // Flash offer timer
  flashOfferTimer() {
    return `
      <div class="flash-timer" id="flash-offer-timer">
        <span>⏱️ Expire dans</span>
        <span class="timer-digit" id="flash-hours">03</span>
        <span class="timer-sep">:</span>
        <span class="timer-digit" id="flash-minutes">45</span>
        <span class="timer-sep">:</span>
        <span class="timer-digit" id="flash-seconds">00</span>
      </div>`;
  }
};

/* ============================================================
   VIEWS — Each returns an HTML string
   ============================================================ */
const Views = {

  /* ---- ACCUEIL ---- */
  accueil() {
    const streakHTML = STATE.streak >= 2
      ? `<div class="streak-badge"><span class="material-symbols-outlined icon-sm icon-filled">local_fire_department</span> ${STATE.streak} jours de suite</div>`
      : '';
    const todayLabel = getCurrentDateLabel();

    return `
      <div class="view px-4 py-4">

        <!-- Live Social Ticker -->
        <div id="social-ticker" style="border-radius:var(--radius-lg);margin-bottom:20px;overflow:hidden;" aria-label="Gains récents de la communauté">
          <div class="ticker-content" id="ticker-content">
            ${DATA.live_feed.map(f =>
      `<div class="ticker-item">🎉 <span class="ticker-gain">${f.nom} (${f.ville})</span> a ${f.action} — <span class="ticker-gain">${f.gain}</span></div>`
    ).join('')}
            ${DATA.live_feed.map(f =>
      `<div class="ticker-item">🎉 <span class="ticker-gain">${f.nom} (${f.ville})</span> a ${f.action} — <span class="ticker-gain">${f.gain}</span></div>`
    ).join('')}
          </div>
        </div>

        <!-- Hero -->
        <div class="hero-section mb-6">
          <div class="hero-bg-orb" style="width:200px;height:200px;right:-60px;top:-60px;"></div>
          <div style="position:relative;z-index:1;">
            ${streakHTML ? `<div style="margin-bottom:12px;">${streakHTML}</div>` : ''}
            <h1 class="hero-title">
              ARRÊTEZ DE PARIER AU HASARD.<br>
              <span class="accent">REJOIGNEZ CEUX QUI GAGNENT.</span>
            </h1>
            <div class="hero-quote">
              "Un membre VIP a transformé <strong>30 000 FCFA</strong> en <strong>1 500 000 FCFA</strong> cette semaine. Pourquoi pas vous ?"
            </div>
            <button class="btn-secondary w-full" onclick="Modal.open()" style="width:100%;justify-content:center;">
              DÉBLOQUER LES GAINS VIP ⚡
            </button>
          </div>
        </div>

        <!-- Journal du Jour teaser -->
        <div style="background:linear-gradient(135deg,rgba(0,108,73,0.06),rgba(16,185,129,0.04));border-radius:var(--radius-xl);padding:16px;margin-bottom:24px;display:flex;align-items:center;gap:12px;cursor:pointer;" onclick="Router.navigate('journal')">
          <div style="width:48px;height:48px;background:var(--gradient-primary);border-radius:var(--radius-md);display:flex;align-items:center;justify-content:center;flex-shrink:0;">
            <span class="material-symbols-outlined icon-filled" style="color:white;font-size:1.4rem;">calendar_today</span>
          </div>
          <div style="flex:1;">
            <div style="font-size:0.65rem;font-weight:800;text-transform:uppercase;letter-spacing:0.1em;color:var(--primary);margin-bottom:2px;">📰 Édition du jour</div>
            <div style="font-weight:900;font-size:0.95rem;letter-spacing:-0.02em;">L'État du Marché — ${todayLabel}</div>
            <div style="font-size:0.75rem;color:var(--on-surface-variant);margin-top:2px;">Champions League piégeux ce soir · 3 alertes</div>
          </div>
          <span class="material-symbols-outlined" style="color:var(--primary);">chevron_right</span>
        </div>

        <!-- Pronos Gratuits -->
        <div class="section-header mb-4">
          <h2 class="section-title">Pronos Gratuits</h2>
          <span class="section-link" onclick="Router.navigate('pronos')" style="cursor:pointer;">Voir tout →</span>
        </div>
        ${C.lastUpdated()}

        <div id="accueil-free-pronos">${DATA.pronos_gratuits.length > 0
          ? DATA.pronos_gratuits.map(p => C.matchCard(p)).join('')
          : `<div style="background:var(--surface-container-lowest);border-radius:var(--radius-xl);padding:28px;text-align:center;">
              <span class="material-symbols-outlined" style="font-size:2.5rem;color:var(--primary);margin-bottom:8px;display:block;">sports_soccer</span>
              <div style="font-weight:800;font-size:1rem;margin-bottom:6px;">Pronos en préparation</div>
              <div style="font-size:0.82rem;color:var(--on-surface-variant);line-height:1.6;">Notre IA analyse les matchs du jour. Les pronostics seront disponibles très bientôt.</div>
              <div style="margin-top:16px;display:flex;flex-direction:column;gap:10px;">
                <div style="height:14px;background:var(--surface-container-high);border-radius:8px;width:80%;margin:0 auto;animation:pulse-badge 1.5s infinite;"></div>
                <div style="height:14px;background:var(--surface-container);border-radius:8px;width:60%;margin:0 auto;animation:pulse-badge 1.5s infinite;"></div>
              </div>
            </div>`
        }</div>

        <!-- EXCLUSIVITÉS RÉSERVÉES -->
        <div class="section-header mb-4" style="margin-top:12px;">
          <h2 class="section-title">Exclusivités Réservées</h2>
          <span style="font-size:1.1rem;">👑</span>
        </div>

        <!-- Locked grid -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:24px;">
          <div style="position:relative;height:130px;background:var(--surface-container-highest);border-radius:var(--radius-xl);overflow:hidden;">
            <div style="position:absolute;inset:0;padding:14px;display:flex;flex-direction:column;justify-content:space-between;filter:blur(3px);pointer-events:none;">
              <div style="background:rgba(255,255,255,0.2);width:60%;height:10px;border-radius:6px;"></div>
              <div style="background:rgba(255,255,255,0.15);width:40%;height:8px;border-radius:6px;"></div>
            </div>
            ${C.glassLock('Scores Exacts VIP')}
          </div>
          <div style="position:relative;height:130px;background:var(--surface-container-highest);border-radius:var(--radius-xl);overflow:hidden;">
            <div style="position:absolute;inset:0;padding:14px;display:flex;flex-direction:column;justify-content:space-between;filter:blur(3px);pointer-events:none;">
              <div style="background:rgba(255,255,255,0.2);width:70%;height:10px;border-radius:6px;"></div>
              <div style="background:rgba(255,255,255,0.15);width:50%;height:8px;border-radius:6px;"></div>
            </div>
            ${C.glassLock('La Montante VIP')}
          </div>
          <div style="position:relative;height:130px;background:var(--surface-container-highest);border-radius:var(--radius-xl);overflow:hidden;">
            <div style="position:absolute;inset:0;flex:1;filter:blur(3px);pointer-events:none;background:linear-gradient(135deg,rgba(0,108,73,0.1),rgba(16,185,129,0.05));"></div>
            ${C.glassLock('Grosses Cotes')}
          </div>
          <div style="position:relative;height:130px;background:var(--surface-container-highest);border-radius:var(--radius-xl);overflow:hidden;">
            ${C.glassLock('Analyse Pro')}
          </div>
        </div>


      </div>`;
  },

  /* ---- PRONOS ---- */
  pronos() {
    const todayLabel = getCurrentDateLabel();
    const featuredProno = getFeaturedProno();
    const featuredMatch = splitMatchLabel(featuredProno?.match);
    const featuredCompetition = featuredProno?.competition || 'Pronostic du jour';
    const featuredKickoff = featuredProno?.heure || '--:--';
    const featuredPick = featuredProno?.prono || 'Analyse en cours';
    const featuredOdds = featuredProno?.cote || '--';
    const featuredAnalysis = featuredProno?.analyse_vip || featuredProno?.description || 'Les analyses automatiques seront affichées ici des que le pipeline serveur termine son cycle.';
    const featuredHomeLogo = getTeamVisual(featuredProno?.home_team_logo, featuredProno?.equipe1 || '⚽', featuredMatch.home);
    const featuredAwayLogo = getTeamVisual(featuredProno?.away_team_logo, featuredProno?.equipe2 || '🏆', featuredMatch.away);
    return `
      <div class="view px-4 py-4">
        <div style="margin-bottom:20px;">
          <h1 style="font-size:1.8rem;font-weight:900;letter-spacing:-0.05em;margin-bottom:4px;">Pronostics</h1>
          <p style="font-size:0.85rem;color:var(--on-surface-variant);font-weight:500;">Les pépites IA pour aujourd'hui — 21 Avril</p>
        </div>

        <!-- Filter Chips -->
        <div class="chips-row mb-6" role="tablist" aria-label="Filtrer les pronostics">
          <div class="chip active" data-filter="tous" onclick="UI.filterPronos(this)" role="tab" tabindex="0">Tous</div>
          <div class="chip" data-filter="safe" onclick="UI.filterPronos(this)" role="tab" tabindex="0">Safe</div>
          <div class="chip" data-filter="value" onclick="UI.filterPronos(this)" role="tab" tabindex="0">Value</div>
          <div class="chip" data-filter="score" onclick="UI.filterPronos(this)" role="tab" tabindex="0">Score Exact</div>
          <div class="chip" data-filter="btts" onclick="UI.filterPronos(this)" role="tab" tabindex="0">BTTS</div>
        </div>

        <!-- Match Principal (full card) — rendered dynamically from live data -->
        ${buildFeaturedPronoCard()}

        <!-- Bonus Prono Flash -->
        <div style="background:linear-gradient(135deg,rgba(254,166,25,0.12),rgba(254,166,25,0.04));border:2px solid rgba(254,166,25,0.35);border-radius:var(--radius-xl);padding:20px;display:flex;flex-direction:column;align-items:center;text-align:center;gap:14px;margin-bottom:24px;position:relative;overflow:hidden;">
          <div style="position:absolute;top:-20px;right:-20px;width:100px;height:100px;background:rgba(254,166,25,0.08);border-radius:50%;filter:blur(30px);"></div>
          <div style="width:52px;height:52px;background:var(--gradient-secondary);border-radius:var(--radius-md);display:flex;align-items:center;justify-content:center;box-shadow:0 4px 16px rgba(254,166,25,0.3);">
            <span class="material-symbols-outlined icon-filled" style="color:#2a1700;font-size:1.5rem;">bolt</span>
          </div>
          <div>
            <div style="font-size:0.6rem;font-weight:800;text-transform:uppercase;letter-spacing:0.15em;color:var(--secondary);margin-bottom:6px;">⚡ Offre Flash</div>
            <h4 style="font-weight:900;font-size:1.05rem;margin-bottom:6px;letter-spacing:-0.02em;">Prono Caché Bonus</h4>
            <p style="font-size:0.8rem;color:var(--on-surface-variant);line-height:1.5;">Un pronostic exclusif analysé par notre IA — cote @2.10 — non accessible aux membres gratuits.</p>
            ${C.flashOfferTimer()}
          </div>
          <div style="width:100%;background:rgba(0,0,0,0.06);border-radius:var(--radius-lg);padding:12px;">
            <div style="font-size:0.65rem;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:var(--outline);margin-bottom:4px;">Accès unique</div>
            <div style="font-size:1.6rem;font-weight:900;color:var(--on-surface);letter-spacing:-0.04em;">1 000 <span style="font-size:1rem;font-weight:700;">FCFA</span></div>
          </div>
          <button class="btn-secondary" style="width:100%;justify-content:center;" onclick="window.open('${buildWaLink('bonus')}','_blank')">
            <span class="material-symbols-outlined icon-sm icon-filled">lock_open</span>
            DÉBLOQUER CE PRONO — 1 000 FCFA
          </button>
          <div style="font-size:0.65rem;color:var(--outline);font-weight:600;">Paiement sécurisé · Mobile Money · Résultat immédiat</div>
        </div>

        <!-- Pronos gratuits section -->
        <div class="section-header mb-4">
          <h2 class="section-title">Autres Pronos Gratuits</h2>
        </div>
        ${DATA.pronos_gratuits.length > 0
          ? DATA.pronos_gratuits.map(p => C.matchCard(p)).join('')
          : `<div style="padding:20px;text-align:center;color:var(--on-surface-variant);font-size:0.85rem;">Aucun prono gratuit pour le moment.</div>`
        }

        <!-- VIP locked pronos -->
        <div class="section-header mb-4" style="margin-top:8px;">
          <h2 class="section-title">Exclusivités VIP</h2>
          <span class="badge badge-gold">👑 VIP</span>
        </div>
        <div id="vip-pronos-list">
          ${DATA.pronos_vip.length > 0
            ? DATA.pronos_vip.map(p => C.matchCardLocked(p)).join('')
            : `<div style="position:relative;min-height:130px;background:var(--surface-container-highest);border-radius:var(--radius-xl);overflow:hidden;">
                <div style="position:absolute;inset:0;padding:14px;display:flex;flex-direction:column;justify-content:center;align-items:center;filter:blur(3px);pointer-events:none;">
                  <div style="background:rgba(255,255,255,0.2);width:70%;height:14px;border-radius:8px;margin-bottom:10px;"></div>
                  <div style="background:rgba(255,255,255,0.15);width:50%;height:10px;border-radius:6px;"></div>
                </div>
                ${C.glassLock('Pronos VIP')}
              </div>`
          }
        </div>

        <!-- Gain potentiel sticky card -->
        <div style="background:var(--on-surface);color:var(--surface);border-radius:var(--radius-xl);padding:18px;display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <div>
            <div style="font-size:0.62rem;font-weight:800;text-transform:uppercase;letter-spacing:0.1em;opacity:0.6;margin-bottom:4px;">Gain Potentiel aujourd'hui</div>
            <div style="font-size:1.8rem;font-weight:900;color:var(--primary-fixed);letter-spacing:-0.04em;">+ 425 000 FCFA</div>
          </div>
          <button class="btn-primary" onclick="Modal.open()">VIP</button>
        </div>

        <!-- Full historique -->
        <div class="section-header mb-4" style="margin-top:28px;">
          <h2 class="section-title">Historique Complet</h2>
          <div class="badge badge-primary">82% de réussite</div>
        </div>

        <!-- Stats -->
        <div class="stat-grid mb-6">
          <div class="stat-card">
            <div class="stat-label">Taux réussite</div>
            <div class="stat-value primary">${DATA.stats.taux}%</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">ROI 30j</div>
            <div class="stat-value primary">${DATA.stats.roi}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Cote moy. VIP</div>
            <div class="stat-value gold">@${DATA.stats.cote_vip}</div>
          </div>
        </div>

        <div class="space-y-4 mb-6">
          ${DATA.historique.map(h => C.historyItem(h)).join('')}
        </div>

        <!-- VIP CTA at bottom of history -->
        <div style="position:relative;overflow:hidden;border-radius:var(--radius-2xl);background:#0f3323;padding:28px;text-align:center;">
          <div style="position:absolute;top:0;right:0;width:120px;height:120px;background:rgba(16,185,129,0.12);border-radius:50%;filter:blur(40px);"></div>
          <div style="position:relative;z-index:1;">
            <div style="font-size:0.62rem;font-weight:800;text-transform:uppercase;letter-spacing:0.15em;color:var(--primary-fixed);margin-bottom:8px;">Match VIP — Hier</div>
            <h3 style="font-size:1.4rem;font-weight:900;color:white;letter-spacing:-0.04em;margin-bottom:16px;">SCORE EXACT VALIDÉ</h3>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px;">
              <div>
                <div style="font-size:0.6rem;font-weight:800;text-transform:uppercase;letter-spacing:0.08em;color:rgba(255,255,255,0.5);margin-bottom:4px;">Résultat</div>
                <div style="font-size:2rem;font-weight:900;color:var(--primary-container);filter:blur(6px);user-select:none;">3 - 1</div>
              </div>
              <div>
                <div style="font-size:0.6rem;font-weight:800;text-transform:uppercase;letter-spacing:0.08em;color:rgba(255,255,255,0.5);margin-bottom:4px;">Cote Totale</div>
                <div style="font-size:2rem;font-weight:900;color:white;">@12.00</div>
              </div>
            </div>
            <button class="btn-secondary" style="width:100%;justify-content:center;" onclick="Modal.open()">
              ACCÉDER AUX PRONOS VIP
            </button>
            <div style="font-size:0.65rem;font-weight:600;color:rgba(255,255,255,0.4);margin-top:10px;text-transform:uppercase;letter-spacing:0.1em;">Confidentialité garantie pour nos membres</div>
          </div>
        </div>

      </div>`;
  },

  /* ---- JOURNAL ---- */
  journal() {
    const daily = getDailyAnalyses();
    const freeArticle = daily.free;
    const vipArticles = daily.vip;

    return `
      <div class="view px-4 py-4">
        <!-- Header -->
        <div style="display:flex;flex-direction:column;gap:12px;margin-bottom:24px;">
          <div>
            <div style="font-size:0.62rem;font-weight:800;text-transform:uppercase;letter-spacing:0.15em;color:var(--primary);margin-bottom:4px;">Édition Quotidienne</div>
            <h1 style="font-size:2rem;font-weight:900;letter-spacing:-0.06em;line-height:1.1;">L'État du Marché.</h1>
          </div>
          <div style="display:inline-flex;align-items:center;gap:6px;background:var(--surface-container-low);padding:6px 12px;border-radius:var(--radius-lg);align-self:flex-start;">
            <span class="material-symbols-outlined icon-sm">calendar_today</span>
            <span style="font-weight:600;font-size:0.8rem;">21 Avril 2026</span>
          </div>
        </div>

        <!-- Main Feature Article (Free) -->
        <div class="article-card mb-6">
          <div style="height:200px;background:${freeArticle.bgGradient || 'linear-gradient(135deg,#0f3323,#006c49)'};display:flex;align-items:flex-end;padding:20px;position:relative;overflow:hidden;">
            <div style="position:absolute;top:0;right:0;width:160px;height:160px;background:rgba(255,255,255,0.1);border-radius:50%;filter:blur(40px);"></div>
            <div style="position:relative;z-index:1;">
              <span class="badge" style="background:rgba(0,0,0,0.3);color:white;margin-bottom:8px;backdrop-filter:blur(5px);border:1px solid rgba(255,255,255,0.1);">${freeArticle.emoji} ${freeArticle.kicker}</span>
              <h2 style="font-size:1.2rem;font-weight:900;color:white;letter-spacing:-0.04em;line-height:1.3;">${freeArticle.titre}</h2>
            </div>
          </div>
          <div class="article-body">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
              <div style="width:28px;heig            ${DATA.tendances.map(t => `
              <div style="display:flex;align-items:flex-start;gap:12px;">
                <span style="font-size:1.2rem;font-weight:900;color:var(--primary);opacity:0.2;min-width:24px;">${t.rang}</span>
                <div>
                  <div style="font-weight:800;font-size:0.88rem;color:var(--on-surface);margin-bottom:2px;">${t.titre}</div>
                  <div style="font-size:0.75rem;color:var(--on-surface-variant);">${t.detail}</div>
                </div>
              </div>
            `).join('')}
          </div>
        </div>

        <!-- Expert Articles Feed (VIP) -->
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px;">
          <h2 style="font-size:1.2rem;font-weight:900;letter-spacing:-0.03em;">Flux de l'Expert</h2>
          <span class="badge badge-gold">VIP</span>
          <div style="flex:1;height:2px;background:var(--surface-container-high);"></div>
        </div>

        ${vipArticles.map(a => {
          if (STATE.isVip) {
            return `
              <div class="card-elevated mb-6" style="padding:20px;">
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
                  <span style="font-size:0.65rem;font-weight:800;text-transform:uppercase;letter-spacing:0.1em;color:var(--primary);">${a.kicker}</span>
                  <span style="width:3px;height:3px;border-radius:50%;background:var(--outline-variant);display:inline-block;"></span>
                  <span style="font-size:0.72rem;color:var(--on-surface-variant);">${a.temps}</span>
                </div>
                <h3 style="font-size:1.05rem;font-weight:900;letter-spacing:-0.03em;line-height:1.35;margin-bottom:8px;">${a.emoji} ${a.titre}</h3>
                <p style="font-size:0.8rem;color:var(--on-surface-variant);font-weight:500;line-height:1.6;margin-bottom:14px;">${a.extrait}</p>
                <button class="btn-ghost" onclick="UI.showToast('Rapport complet VIP bientôt disponible')">Voir le rapport complet →</button>
              </div>`;
          } else {
            return `
              <div class="card-elevated mb-6" style="overflow:hidden;">
                <div style="padding:20px;">
                  <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
                    <span style="font-size:0.65rem;font-weight:800;text-transform:uppercase;letter-spacing:0.1em;color:var(--primary);">${a.kicker}</span>
                    <span style="width:3px;height:3px;border-radius:50%;background:var(--outline-variant);display:inline-block;"></span>
                    <span style="font-size:0.72rem;color:var(--on-surface-variant);">${a.temps}</span>
                  </div>
                  <h3 style="font-size:1.05rem;font-weight:900;letter-spacing:-0.03em;line-height:1.35;margin-bottom:8px;">${a.emoji} ${a.titre}</h3>
                  <p style="font-size:0.8rem;color:var(--on-surface-variant);font-weight:500;line-height:1.6;">${a.extrait.substring(0, 80)}...</p>
                </div>
                <div style="position:relative;height:80px;">
                  <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;gap:10px;backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);background:rgba(225,227,228,0.7);">
                    <span class="material-symbols-outlined icon-filled" style="color:var(--secondary);font-size:1.6rem;">workspace_premium</span>
                    <span style="font-size:0.8rem;font-weight:800;color:var(--on-surface);">Réservé aux membres VIP</span>
                    <button class="btn-primary" style="padding:8px 16px;font-size:0.72rem;" onclick="Modal.open()">Débloquer</button>
                  </div>
                </div>
              </div>`;
      }
    }).join('')}

        <!-- Masterclass Teaser -->
        <div style="position:relative;border-radius:var(--radius-xl);overflow:hidden;height:160px;display:flex;align-items:center;justify-content:center;margin-bottom:8px;background:linear-gradient(135deg,#006c49,#10b981);">
          <div style="position:absolute;inset:0;background:rgba(0,0,0,0.2);"></div>
          <div style="position:relative;z-index:1;text-align:center;padding:20px;">
            <span class="material-symbols-outlined icon-xl" style="color:white;margin-bottom:8px;">school</span>
            <h4 style="color:white;font-weight:900;font-size:1.1rem;margin-bottom:4px;">Masterclass : Gérer la Variance</h4>
            <p style="color:rgba(255,255,255,0.8);font-size:0.72rem;font-weight:600;text-transform:uppercase;letter-spacing:0.1em;cursor:pointer;" onclick="UI.showToast('📚 Masterclass bientôt disponible !')">Rejoindre le live →</p>
          </div>
        </div>

      </div>`;
  },

  /* ---- VIP ---- */
  vip() {
    return `
      <div class="view px-4 py-4">

        <!-- Hero VIP -->
        <section style="text-align:center;margin-bottom:28px;">
          <div style="display:inline-block;padding:4px 14px;background:rgba(254,166,25,0.1);border:1px solid rgba(254,166,25,0.2);border-radius:var(--radius-full);margin-bottom:12px;">
            <span style="font-size:0.65rem;font-weight:800;text-transform:uppercase;letter-spacing:0.2em;color:var(--secondary);">Club Privé</span>
          </div>
          <h1 style="font-size:2.2rem;font-weight:900;letter-spacing:-0.06em;line-height:1.1;margin-bottom:10px;">LE CLUB DES<br>GAGNANTS</h1>
          <p style="font-size:0.9rem;color:var(--on-surface-variant);font-weight:500;line-height:1.6;max-width:300px;margin:0 auto;">Ne laissez plus l'argent sur la table des bookmakers. Accédez à l'excellence.</p>
        </section>

        <!-- Stats proof -->
        <div class="stat-grid mb-6">
          <div class="stat-card" style="background:rgba(0,108,73,0.06);border:1px solid rgba(0,108,73,0.1);">
            <div class="stat-label">Taux réussite</div>
            <div class="stat-value primary">84%</div>
          </div>
          <div class="stat-card" style="background:rgba(0,108,73,0.06);border:1px solid rgba(0,108,73,0.1);">
            <div class="stat-label">Membres actifs</div>
            <div class="stat-value primary">2 847</div>
          </div>
          <div class="stat-card" style="background:rgba(254,166,25,0.08);border:1px solid rgba(254,166,25,0.2);">
            <div class="stat-label">Cote moy.</div>
            <div class="stat-value gold">@4.50</div>
          </div>
        </div>

        <!-- Social Proof quote -->
        <div style="background:rgba(0,108,73,0.04);border-radius:var(--radius-xl);border:1px solid rgba(0,108,73,0.1);padding:20px;margin-bottom:24px;">
          <div style="display:flex;gap:3px;margin-bottom:10px;color:var(--secondary-container);">★★★★★</div>
          <blockquote style="font-size:1rem;font-weight:700;font-style:italic;color:var(--on-surface);line-height:1.6;margin-bottom:10px;">
            "30 000 FCFA → 1 500 000 FCFA en 7 jours. C'est le pouvoir du VIP."
          </blockquote>
          <div style="font-size:0.78rem;font-weight:700;color:var(--primary);">— Mamadou K., Membre Elite 🇸🇳</div>
        </div>

        <!-- Features VIP -->
        <div class="mb-6">
          <h2 style="font-size:1.2rem;font-weight:900;letter-spacing:-0.03em;margin-bottom:16px;">Ce qu'inclut le VIP</h2>
          <div style="background:var(--surface-container-lowest);border-radius:var(--radius-xl);padding:4px 16px;box-shadow:var(--shadow-sm);">
            ${[
        { icon: 'trending_up', titre: 'Cotes > 1.80 garanties', desc: 'Rentabilité maximale sur chaque ticket sélectionné par notre IA.' },
        { icon: 'sports_soccer', titre: 'Scores Exacts VIP', desc: 'Analyses exclusives sur les scores à haute probabilité. ROI exceptionnel.' },
        { icon: 'bolt', titre: 'Accès prioritaire +2h', desc: 'Recevez les pronos 2h avant le public. Securisez les meilleures cotes.' },
        { icon: 'show_chart', titre: 'La Montante 10K→100K', desc: 'Notre méthode exclusive pour multiplier votre mise par 10 en 7 jours.' },
        { icon: 'insights', titre: 'Analyses Pro Tactiques', desc: 'Décryptage tactique avant chaque rencontre. Blessés, forme, météo.' },
        { icon: 'support_agent', titre: 'Support WhatsApp 24/7', desc: 'Ligne directe avec nos analystes. Réponse garantie en moins d\'1h.' }
      ].map(f => `
              <div class="vip-feature-row">
                <div class="vip-feature-icon">
                  <span class="material-symbols-outlined icon-filled">${f.icon}</span>
                </div>
                <div>
                  <div class="vip-feature-title">${f.titre}</div>
                  <div class="vip-feature-desc">${f.desc}</div>
                </div>
              </div>
            `).join('')}
          </div>
        </div>

        <!-- Pricing CTA -->
        <div style="text-align:center;margin-bottom:20px;">
          <button class="btn-secondary" style="width:100%;justify-content:center;font-size:1rem;padding:18px;" onclick="Modal.open()">
            👑 CHOISIR MON PLAN VIP
          </button>
          <p style="font-size:0.72rem;color:var(--outline);margin-top:8px;">Résiliation possible à tout moment · Paiement sécurisé</p>
        </div>

        <!-- Testimonials Carousel -->
        <div class="section-header mb-4">
          <h2 class="section-title">Ils ont rejoint l'Élite</h2>
        </div>
        <div class="mb-6">
          ${C.testimonialCarousel(DATA.temoignages)}
        </div>

        <!-- FAQ -->
        <div class="mb-6">
          <h2 style="font-size:1.1rem;font-weight:900;margin-bottom:16px;">Questions fréquentes</h2>
          ${[
        { q: 'Comment fonctionne le paiement ?', r: 'Nous acceptons Orange Money, MTN Mobile Money, Wave, et Moov. Après paiement, vous recevez un accès immédiat par WhatsApp sous 5 minutes.' },
        { q: 'Puis-je annuler ?', r: 'Oui, à tout moment. L\'abonnement ne se renouvelle pas automatiquement. Vous gérez votre renouvellement vous-même.' },
        { q: 'Les pronos sont-ils vraiment rentables ?', r: 'Notre taux de réussite est de 84% sur les 30 derniers jours (audité). Le ROI est de +14.2 unités. Les résultats passés ne garantissent pas les résultats futurs.' },
        { q: 'Comment accéder aux pronos VIP ?', r: 'Après paiement, vous rejoignez notre groupe Telegram Privé où les pronos sont publiés. Vous recevez aussi des notifications push sur l\'application.' }
      ].map(f => `
            <div style="border-bottom:1px solid var(--surface-container);padding:14px 0;">
              <div style="font-weight:800;font-size:0.88rem;margin-bottom:6px;color:var(--on-surface);">${f.q}</div>
              <div style="font-size:0.78rem;color:var(--on-surface-variant);line-height:1.6;">${f.r}</div>
            </div>
          `).join('')}
        </div>

        <!-- Final CTA -->
        <div style="background:#0f3323;border-radius:var(--radius-2xl);padding:28px;text-align:center;position:relative;overflow:hidden;">
          <div style="position:absolute;top:-30px;right:-30px;width:120px;height:120px;background:rgba(16,185,129,0.15);border-radius:50%;filter:blur(30px);"></div>
          <div style="position:relative;z-index:1;">
            <h2 style="color:white;font-size:1.5rem;font-weight:900;letter-spacing:-0.04em;font-style:italic;margin-bottom:8px;">PRÊT À CHANGER DE DIMENSION ?</h2>
            <p style="color:rgba(255,255,255,0.7);font-size:0.82rem;margin-bottom:20px;">Rejoignez 2 847 membres qui gagnent chaque jour.</p>
            <button class="btn-secondary" style="width:100%;justify-content:center;" onclick="Modal.open()">
              REJOINDRE L'ÉLITE MAINTENANT
            </button>
          </div>
        </div>

      </div>`;
  }
};

/* ============================================================
   APP — Render, Nav
   ============================================================ */
const App = {
  render(view) {
    const container = document.getElementById('app');
    if (!container) return;
    const viewFn = Views[view];
    if (!viewFn) return;
    container.innerHTML = viewFn();
    hydrateRenderedView(container, view);
    STATE.currentView = view;
  },

  updateNav(view) {
    document.querySelectorAll('.nav-item').forEach(item => {
      const isActive = item.dataset.view === view;
      item.classList.toggle('active', isActive);
      item.setAttribute('aria-selected', isActive);
      const icon = item.querySelector('.nav-icon');
      if (icon) {
        icon.style.fontVariationSettings = isActive
          ? "'FILL' 1, 'wght' 500, 'GRAD' 0, 'opsz' 24"
          : "'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24";
      }
    });
  }
};

/* ============================================================
   MODAL — VIP Bottom Sheet
   ============================================================ */
const Modal = {
  open() {
    const modal = document.getElementById('vip-modal');
    if (!modal) return;
    const grid = document.getElementById('pricing-grid');
    if (grid && grid.children.length === 0) this.renderPricing(grid);
    modal.classList.add('open');
    document.body.style.overflow = 'hidden';
  },

  close() {
    const modal = document.getElementById('vip-modal');
    if (modal) modal.classList.remove('open');
    document.body.style.overflow = '';
    clearInterval(Modal._pollTimer);
  },

  renderPricing(grid) {
    const plans = Object.values(CONFIG.payment);
    const clientCode = getVipCode();

    grid.innerHTML = `
      <!-- Code client affiché pour le suivi -->
      <div style="background:rgba(0,0,0,0.06);border-radius:12px;padding:12px 16px;text-align:center;margin-bottom:4px;">
        <div style="font-size:0.6rem;font-weight:800;text-transform:uppercase;letter-spacing:0.12em;color:var(--outline);margin-bottom:4px;">Votre code de commande</div>
        <div style="font-size:1.2rem;font-weight:900;letter-spacing:0.15em;color:var(--on-surface);font-family:monospace;">${clientCode}</div>
        <div style="font-size:0.7rem;color:var(--outline);margin-top:4px;">Envoyez ce code sur WhatsApp pour activer votre accès</div>
      </div>

      ${plans.map(plan => `
        <div class="pricing-card ${plan.highlight ? 'featured' : ''}">
          ${plan.badge ? `<div class="popular-badge">${plan.badge}</div>` : ''}
          <div>
            <div class="plan-label" style="color:${plan.highlight ? 'rgba(42,23,0,0.7)' : 'var(--on-surface-variant)'};">${plan.name}</div>
            <div style="display:flex;align-items:baseline;gap:4px;">
              <span class="plan-price" style="color:${plan.highlight ? 'var(--on-secondary-fixed)' : 'var(--on-surface)'};">${plan.price}</span>
              <span class="plan-currency" style="color:${plan.highlight ? 'rgba(42,23,0,0.6)' : 'var(--outline)'};">${plan.currency}</span>
            </div>
            <div class="plan-period" style="color:${plan.highlight ? 'rgba(42,23,0,0.5)' : 'var(--outline)'};">Accès ${plan.duration}</div>
          </div>
          <div class="plan-features">
            ${plan.features.map(f => `
              <div class="plan-feature" style="color:${plan.highlight ? 'var(--on-secondary-fixed)' : 'var(--on-surface-variant)'};">
                <span class="material-symbols-outlined icon-sm icon-filled" style="color:${plan.highlight ? 'var(--on-secondary-fixed)' : 'var(--primary)'};">check_circle</span>
                ${f}
              </div>
            `).join('')}
          </div>
          <a href="${buildWaLink(plan.id)}" target="_blank" rel="noopener noreferrer"
             class="plan-cta" onclick="Modal.onPlanClick('${plan.id}')">
            <span style="margin-right:6px;">💬</span>
            ${plan.highlight ? 'PAYER VIA WHATSAPP' : 'PAYER MAINTENANT'}
          </a>
        </div>
      `).join('')}

      <!-- Bouton activation après paiement -->
      <div id="activation-zone" style="display:none;margin-top:8px;background:rgba(16,185,129,0.06);border:1.5px solid rgba(16,185,129,0.3);border-radius:16px;padding:16px;text-align:center;">
        <div style="font-size:0.75rem;font-weight:700;margin-bottom:10px;color:var(--on-surface);">
          ✅ Vous avez payé ? Activez votre accès maintenant.
        </div>
        <button id="activate-btn" class="btn-primary" style="width:100%;justify-content:center;" onclick="Modal.checkActivation()">
          <span class="material-symbols-outlined icon-sm">lock_open</span>
          J'AI PAYÉ — ACTIVER MON VIP
        </button>
        <div id="activation-status" style="font-size:0.72rem;color:var(--outline);margin-top:8px;"></div>
      </div>
    `;
  },

  // Appelé quand l'user clique sur un plan WhatsApp
  onPlanClick(planId) {
    Modal.trackClick(planId);
    // Affiche la zone d'activation après 3s (temps d'ouvrir WhatsApp)
    setTimeout(() => {
      const zone = document.getElementById('activation-zone');
      if (zone) zone.style.display = 'block';
    }, 3000);
  },

  // Poll le backend toutes les 5s pour vérifier si le code est activé
  startPolling() {
    clearInterval(Modal._pollTimer);
    Modal._pollTimer = setInterval(Modal.checkActivation, 5000);
  },

  async checkActivation() {
    const code = getVipCode();
    const statusEl = document.getElementById('activation-status');
    const btn = document.getElementById('activate-btn');

    if (statusEl) statusEl.textContent = '⏳ Vérification en cours...';
    if (btn) btn.disabled = true;

    try {
      const res = await fetch(`${API_BASE}/admin/check/${code}`);
      const data = await res.json();

      if (data.active) {
        clearInterval(Modal._pollTimer);
        // ✅ Accès VIP accordé !
        STATE.setVip(true);
        localStorage.setItem('goliat_vip_plan', data.plan);
        localStorage.setItem('goliat_vip_expires', data.expires_at);

        Modal.close();
        UI.showToast('🎉 Accès VIP activé ! Bienvenue dans l\'élite.', 5000);
        App.render(STATE.currentView); // Refresh view
      } else {
        if (statusEl) {
          statusEl.textContent = data.status === 'pending'
            ? '⏳ Paiement non encore confirmé. Réessayez dans quelques minutes.'
            : `❌ ${data.message}`;
        }
        if (btn) btn.disabled = false;
      }
    } catch (err) {
      if (statusEl) statusEl.textContent = '❌ Erreur réseau. Vérifiez votre connexion.';
      if (btn) btn.disabled = false;
    }
  },

  trackClick(planId) {
    console.log(`[GOLIAT] Plan clicked: ${planId} — Code: ${getVipCode()}`);
    Modal.startPolling();
  }
};


/* ============================================================
   UI Helpers
   ============================================================ */
const UI = {
  showToast(message, duration = 3000) {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), duration);
  },

  filterPronos(chip) {
    document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    const filter = chip.dataset.filter;
    UI.showToast(`Filtre : ${chip.textContent}`);
    // Animation feedback
    const card = document.getElementById('main-match-card');
    if (card) {
      card.style.opacity = '0.7';
      setTimeout(() => { card.style.opacity = '1'; }, 200);
    }
  },

  shareTicket(match, prono, cote) {
    const text = `🏆 *GOLIAT – Ticket du Jour*\n\n⚽ ${match}\n📊 Pronostic : *${prono}*\n📈 Cote : *@${cote}*\n\n💡 Rejoin GOLIAT pour les pronos VIP !\n👉 goliat.app`;
    if (navigator.share) {
      navigator.share({
        title: 'GOLIAT – Mon ticket du jour',
        text: text
      }).catch(() => { });
    } else {
      // Fallback: copy to clipboard
      if (navigator.clipboard) {
        navigator.clipboard.writeText(text).then(() => {
          UI.showToast('✅ Ticket copié ! Colle sur WhatsApp.');
        });
      } else {
        UI.showToast('📋 Partagez ce ticket sur WhatsApp !');
      }
    }
  }
};

/* ============================================================
   ENHANCEMENTS — Wow Factor Engine
   ============================================================ */
const Enhancements = {

  /* ---- A. Last Updated Timestamp ---- */
  timeAgo(date) {
    if (!date) return '';
    const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
    if (seconds < 60) return 'à l\'instant';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `il y a ${minutes}min`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `il y a ${hours}h`;
    return `il y a ${Math.floor(hours / 24)}j`;
  },

  /* ---- A. Countdown Badge for Match Cards ---- */
  buildCountdownBadge(kickoff) {
    if (!kickoff) return '';
    // Parse kickoff time (could be 'HH:MM' or ISO string)
    let kickoffDate;
    if (typeof kickoff === 'string' && kickoff.match(/^\d{2}:\d{2}$/)) {
      const [h, m] = kickoff.split(':').map(Number);
      kickoffDate = new Date();
      kickoffDate.setHours(h, m, 0, 0);
    } else {
      kickoffDate = new Date(kickoff);
    }
    if (isNaN(kickoffDate.getTime())) return '';
    const diffMs = kickoffDate.getTime() - Date.now();
    if (diffMs <= 0) return ''; // Match already started
    const diffMin = Math.floor(diffMs / 60000);
    const hours = Math.floor(diffMin / 60);
    const mins = diffMin % 60;
    const urgent = diffMin <= 30;
    const label = hours > 0 ? `${hours}h ${mins}min` : `${mins}min`;
    return `<span class="countdown-badge ${urgent ? 'urgent' : ''}">
      <span class="material-symbols-outlined">timer</span> Dans ${label}
    </span>`;
  },

  /* ---- A. Live Status Badge ---- */
  getLiveStatus(prono) {
    if (prono.status === 'LIVE' || prono.status === 'IN_PLAY') return 'EN DIRECT';
    if (prono.status === 'HT') return 'MI-TEMPS';
    return null;
  },

  /* ---- B. Confetti Celebration ---- */
  fireConfetti() {
    const container = document.getElementById('confetti-container');
    if (!container) return;
    container.innerHTML = '';
    const colors = ['#006c49', '#10b981', '#fea619', '#ff7a73', '#4edea3', '#ffddb8'];
    for (let i = 0; i < 80; i++) {
      const piece = document.createElement('div');
      piece.className = 'confetti-piece';
      piece.style.left = `${Math.random() * 100}%`;
      piece.style.background = colors[Math.floor(Math.random() * colors.length)];
      piece.style.width = `${6 + Math.random() * 8}px`;
      piece.style.height = `${6 + Math.random() * 8}px`;
      piece.style.animationDelay = `${Math.random() * 0.8}s`;
      piece.style.animationDuration = `${1.8 + Math.random() * 1.5}s`;
      container.appendChild(piece);
    }
    setTimeout(() => { container.innerHTML = ''; }, 4000);
  },

  /* ---- B. Swipe-to-Dismiss ---- */
  initSwipeDismiss() {
    document.querySelectorAll('.swipe-dismiss').forEach(el => {
      let startX = 0, currentX = 0, isDragging = false;

      el.addEventListener('touchstart', (e) => {
        startX = e.touches[0].clientX;
        isDragging = true;
        el.classList.add('swiping');
      }, { passive: true });

      el.addEventListener('touchmove', (e) => {
        if (!isDragging) return;
        currentX = e.touches[0].clientX - startX;
        if (currentX > 0) { // Only swipe right
          el.style.transform = `translateX(${currentX}px)`;
          el.style.opacity = `${Math.max(0.2, 1 - currentX / 300)}`;
        }
      }, { passive: true });

      el.addEventListener('touchend', () => {
        isDragging = false;
        el.classList.remove('swiping');
        if (currentX > 120) {
          el.classList.add('dismissed');
          setTimeout(() => { el.style.display = 'none'; }, 400);
        } else {
          el.style.transform = '';
          el.style.opacity = '';
        }
        currentX = 0;
      }, { passive: true });
    });
  },

  /* ---- C. Social Proof Gain Popup ---- */
  startGainPopups() {
    const feedData = DATA.live_feed;
    if (!feedData || feedData.length === 0) return;
    let index = 0;

    const showNext = () => {
      const item = feedData[index % feedData.length];
      const popup = document.getElementById('gain-popup');
      if (!popup) return;

      const avatarEl = document.getElementById('gain-avatar');
      const nameEl = document.getElementById('gain-name');
      const amountEl = document.getElementById('gain-amount');
      const actionEl = document.getElementById('gain-action');

      if (avatarEl) avatarEl.textContent = item.nom.charAt(0);
      if (nameEl) nameEl.textContent = `${item.nom} · ${item.ville}`;
      if (amountEl) amountEl.textContent = item.gain;
      if (actionEl) actionEl.textContent = item.action;

      popup.classList.add('show');
      setTimeout(() => popup.classList.remove('show'), 4500);
      index++;
    };

    // First popup after 15s, then every 7 minutes
    setTimeout(() => {
      showNext();
      STATE._gainPopupTimer = setInterval(showNext, 420000);
    }, 15000);
  },

  /* ---- C. Flash Offer Timer ---- */
  startFlashTimer() {
    // Set flash expiry: 3h45m from page load (or midnight, whichever comes first)
    const now = new Date();
    let expiry = new Date(now.getTime() + 3 * 3600000 + 45 * 60000);
    const midnight = new Date(now);
    midnight.setHours(23, 59, 59, 999);
    if (expiry > midnight) expiry = midnight;

    const update = () => {
      const diff = Math.max(0, expiry.getTime() - Date.now());
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);

      const hEl = document.getElementById('flash-hours');
      const mEl = document.getElementById('flash-minutes');
      const sEl = document.getElementById('flash-seconds');
      if (hEl) hEl.textContent = String(h).padStart(2, '0');
      if (mEl) mEl.textContent = String(m).padStart(2, '0');
      if (sEl) sEl.textContent = String(s).padStart(2, '0');

      if (diff <= 0) clearInterval(STATE._flashTimerInterval);
    };

    update();
    STATE._flashTimerInterval = setInterval(update, 1000);
  },

  /* ---- C. Testimonial Carousel Dots ---- */
  initCarouselDots() {
    const carousel = document.getElementById('testimonial-carousel');
    const dotsContainer = document.getElementById('carousel-dots');
    if (!carousel || !dotsContainer) return;

    const dots = dotsContainer.querySelectorAll('.carousel-dot');
    carousel.addEventListener('scroll', () => {
      const scrollLeft = carousel.scrollLeft;
      const cardWidth = carousel.querySelector('.testimonial-card')?.offsetWidth || 300;
      const activeIdx = Math.round(scrollLeft / (cardWidth + 14)); // 14 = gap
      dots.forEach((dot, i) => dot.classList.toggle('active', i === activeIdx));
    }, { passive: true });
  },

  /* ---- B. History Confetti trigger ---- */
  checkHistoryConfetti() {
    // Trigger confetti once if the latest history item was won
    const latest = DATA.historique[0];
    if (!latest || !latest.gagne) return;
    const key = `goliat_confetti_${latest.match}_${latest.date}`;
    if (localStorage.getItem(key)) return; // Already celebrated
    localStorage.setItem(key, '1');
    setTimeout(() => this.fireConfetti(), 1500);
  },

  /* ---- Boot all enhancements ---- */
  init() {
    this.initSwipeDismiss();
    this.startGainPopups();
    this.initCarouselDots();
    this.startFlashTimer();
    this.checkHistoryConfetti();
  }
};

/* ============================================================
   PWA — Install prompt + Push notifications
   ============================================================ */
const PWA = {
  deferredPrompt: null,

  init() {
    // Intercept browser install prompt
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      PWA.deferredPrompt = e;
      // Show custom banner after 10 seconds
      setTimeout(() => PWA.showInstallBanner(), 10000);
    });

    window.addEventListener('appinstalled', () => {
      console.log('[GOLIAT] PWA installed');
      PWA.hideInstallBanner();
      UI.showToast('🎉 GOLIAT installé sur votre écran d\'accueil !');
    });

    // Install btn
    const installBtn = document.getElementById('install-btn');
    if (installBtn) {
      installBtn.addEventListener('click', PWA.triggerInstall);
    }

    const closeBtn = document.getElementById('install-close-btn');
    if (closeBtn) {
      closeBtn.addEventListener('click', PWA.hideInstallBanner);
    }

    // Register Service Worker
    if ('serviceWorker' in navigator) {
      let hasReloadedForSw = false;

      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (hasReloadedForSw) return;
        hasReloadedForSw = true;
        window.location.reload();
      });

      navigator.serviceWorker.register('./sw.js').then(reg => {
        console.log('[GOLIAT] SW registered:', reg.scope);
        reg.update().catch(() => { });
      }).catch(err => {
        console.warn('[GOLIAT] SW failed:', err);
      });
    }
  },

  showInstallBanner() {
    if (sessionStorage.getItem('goliat_install_dismissed') === 'true') return;
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
    if (isStandalone) return;

    const banner = document.getElementById('install-banner');
    if (banner && (PWA.deferredPrompt || PWA.isIOS())) {
      banner.style.display = 'flex';
      setTimeout(() => banner.classList.add('show'), 10);
    }
  },

  hideInstallBanner() {
    const banner = document.getElementById('install-banner');
    if (banner) {
      banner.classList.remove('show');
      setTimeout(() => banner.style.display = 'none', 400);
    }
    sessionStorage.setItem('goliat_install_dismissed', 'true');
    // iOS: show manual instructions
    if (PWA.isIOS()) {
      UI.showToast('📱 iOS : Appuyez sur Partager → "Sur l\'écran d\'accueil"', 5000);
    }
  },

  triggerInstall() {
    PWA.hideInstallBanner();
    if (PWA.deferredPrompt) {
      PWA.deferredPrompt.prompt();
      PWA.deferredPrompt.userChoice.then((choice) => {
        if (choice.outcome === 'accepted') {
          UI.showToast('✅ Installation en cours...');
        }
        PWA.deferredPrompt = null;
      });
    } else if (PWA.isIOS()) {
      UI.showToast('📱 Appuyez sur "Partager" → "Sur l\'écran d\'accueil"', 5000);
    }
  },

  isIOS() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  },

  async requestNotifications() {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'granted') return;
    const perm = await Notification.requestPermission();
    if (perm === 'granted') {
      UI.showToast('🔔 Alertes activées ! Vous recevrez les cotes VIP.');
    }
  },

  // Simulate a "Late Value" local notification using real prono data when available
  scheduleLocalAlert() {
    // Alert functionality removed by user request
  }
};

/* ============================================================
   EVENTS — Delegation and bindings
   ============================================================ */
function bindEvents() {
  // Bottom navigation
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
      const view = item.dataset.view;
      if (view) Router.navigate(view);
    });
    item.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        const view = item.dataset.view;
        if (view) Router.navigate(view);
      }
    });
  });

  // GO VIP button
  const goVipBtn = document.getElementById('go-vip-btn');
  if (goVipBtn) goVipBtn.addEventListener('click', () => Router.navigate('vip'));

  // Modal backdrop close
  const backdrop = document.getElementById('modal-backdrop');
  if (backdrop) backdrop.addEventListener('click', Modal.close);

  // Modal close button
  const modalClose = document.getElementById('modal-close-btn');
  if (modalClose) modalClose.addEventListener('click', Modal.close);


  // Keyboard: close modal on Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') Modal.close();
  });
}

/* ============================================================
   STREAK DISPLAY
   ============================================================ */
function updateStreakDisplay() {
  const display = document.getElementById('streak-display');
  if (!display || STATE.streak < 2) return;
  display.style.display = 'flex';
  display.innerHTML = `
    <div class="streak-badge">
      <span class="material-symbols-outlined icon-sm icon-filled">local_fire_department</span>
      ${STATE.streak}j
    </div>`;
}

/* ============================================================
   SPLASH SCREEN
   ============================================================ */
function hideSplash() {
  const splash = document.getElementById('splash');
  if (!splash) return;
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true;

  if (!isStandalone) {
    // Not in standalone mode — hide splash immediately
    splash.style.animation = 'none';
    splash.style.opacity = '0';
    splash.style.pointerEvents = 'none';
    return;
  }
  // In standalone mode, let the CSS animation play (1.8s + 0.5s = 2.3s total)
  setTimeout(() => {
    splash.style.opacity = '0';
    splash.style.pointerEvents = 'none';
    setTimeout(() => splash.remove(), 500);
  }, 2000);
}

/* ============================================================
   INIT — Boot the application
   ============================================================ */
function init() {
  // 1. Init state (streak, VIP)
  STATE.init();

  // 2. Render initial view with static data
  Router.init();

  // 3. Bind all events
  bindEvents();

  // 4. Show streak badge
  updateStreakDisplay();

  // 5. Hide splash
  hideSplash();

  // 6. PWA setup
  PWA.init();

  // 7. Schedule Late Value alert
  PWA.scheduleLocalAlert();

  // 8. Init Enhancements (swipe, social proof, carousel, flash timer)
  setTimeout(() => Enhancements.init(), 2000);

  // 9. Firebase + API init (async, non-blocking)
  // Runs after initial render so UI is responsive immediately
  setTimeout(async () => {
    try {
      await FirebaseClient.init();
      if (_fbUser) await API.getMe();
    } catch (err) {
      console.warn('[Init] Firebase non disponible:', err.message);
    }

    // Load live data from server cache and update views
    try {
      const todayData = await API.loadTodayPronos();

      if (todayData?.free?.length > 0) {
        DATA.pronos_gratuits = todayData.free.map(p => mapPronoForUi(p));
      }

      if (todayData?.vip_preview?.length > 0) {
        DATA.pronos_vip = todayData.vip_preview.map(p =>
          mapPronoForUi(p, {
            locked: p.locked !== false,
            hideDetails: p.locked !== false
          })
        );
      }

      // Track last data refresh
      STATE.lastDataRefresh = new Date();

      if (todayData?.meta?.total > 0) {
        console.info(`[GOLIAT] ${todayData.meta.total} pronos chargés depuis le serveur ✅`);
      }

      // Refresh current view if it displays pronos
      const currentView = STATE.currentView;
      if (['accueil', 'pronos', 'vip'].includes(currentView)) {
        App.render(currentView);
        // Re-init carousel dots after re-render
        setTimeout(() => Enhancements.initCarouselDots(), 100);
      }

    } catch (err) {
      console.warn('[Init] API non disponible — aucune donnée fictive ne sera affichée:', err.message);
    }
  }, 800);

  setTimeout(() => {
    refreshLiveData();
  }, 1400);

  // 10. Ask for notification permission after 30s (non-intrusive)
  setTimeout(() => {
    if (STATE.streak >= 3) {
      PWA.requestNotifications();
    }
  }, 30000);

  console.log(`[GOLIAT] App v${CONFIG.version} initialized. Streak: ${STATE.streak}. VIP: ${STATE.isVip}`);
}

// VIP Code activation handler (called from the VIP modal)
window.activateVipCode = async function (code) {
  if (!code?.trim()) {
    UI.showToast('⚠️ Entrez votre code VIP');
    return;
  }
  try {
    UI.showToast('⏳ Vérification...');
    await API.activateVip(code.trim().toUpperCase());
    Modal.close();
    Router.navigate('pronos');
  } catch (err) {
    UI.showToast(`❌ ${err.message || 'Code invalide'}`);
  }
};

// Boot when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

/* (shareTicket already defined in UI object above — no duplicate needed) */
