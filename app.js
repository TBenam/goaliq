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
    weekly:    `Bonjour GOLIAT 👋\n\nJe souhaite souscrire au plan *VIP 7 jours* (3 500 FCFA).\n\nMon code d'activation : *${code}*\n\nMerci !`,
    monthly:   `Bonjour GOLIAT 👋\n\nJe souhaite souscrire au plan *VIP Mensuel* (10 000 FCFA).\n\nMon code d'activation : *${code}*\n\nMerci !`,
    quarterly: `Bonjour GOLIAT 👋\n\nJe souhaite souscrire au plan *VIP Trimestriel* (25 000 FCFA).\n\nMon code d'activation : *${code}*\n\nMerci !`,
    bonus:     `Bonjour GOLIAT 👋\n\nJe veux débloquer le *Prono Caché Bonus* (1 000 FCFA).\n\nMon code d'activation : *${code}*\n\nMerci !`
  };
  const msg = encodeURIComponent(messages[plan] || messages.monthly);
  return `https://wa.me/${WA_NUMBER}?text=${msg}`;
}

const CONFIG = {
  version: '1.0.0',
  appName: 'GOLIAT',
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


/* ============================================================
   DATA — Pronostics, articles, témoignages
   ============================================================ */
const DATA = {
  stats: { taux: 84, roi: '+14.2u', cote_vip: '4.50', membres: '2 847' },

  pronos_gratuits: [
    {
      id: 1,
      competition: 'Champions League',
      match: 'Real Madrid vs Bayern',
      equipe1: '⚪', equipe2: '🔴',
      prono: 'Victoire Real Madrid',
      cote: 1.85,
      heure: '21:00',
      fiabilite: 88,
      categorie: 'Safe',
      description: 'Le champion en titre à domicile domine clairement les stats de possession.'
    },
    {
      id: 2,
      competition: 'Ligue 1',
      match: 'PSG vs Lens',
      equipe1: '🔵', equipe2: '🟡',
      prono: 'Plus de 2.5 buts',
      cote: 1.65,
      heure: '19:00',
      fiabilite: 76,
      categorie: 'Value',
      description: 'Deux attaques prolifiques se rencontrent dans un match à fort enjeu.'
    }
  ],

  pronos_vip: [
    {
      id: 10,
      competition: 'Premier League',
      match: 'Arsenal vs Chelsea',
      equipe1: '🔴', equipe2: '🔵',
      prono: 'Score exact 2-1',
      cote: 8.50,
      heure: '17:30',
      categorie: 'Score Exact',
      locked: true
    },
    {
      id: 11,
      competition: 'Bundesliga',
      match: 'Dortmund vs Bayern',
      equipe1: '🟡', equipe2: '🔴',
      prono: 'Les deux marquent',
      cote: 1.72,
      heure: '18:30',
      categorie: 'BTTS',
      locked: true
    },
    {
      id: 12,
      competition: 'Serie A',
      match: 'Inter vs Juventus',
      equipe1: '🔵', equipe2: '⚫',
      prono: 'Moins de 2.5 buts',
      cote: 2.10,
      heure: '20:45',
      categorie: 'Safe',
      locked: true
    }
  ],

  historique: [
    { match: 'PSG vs Marseille', marche: 'Victoire Domicile + +2.5 Buts', cote: 1.85, ligue: 'Ligue 1', date: 'Hier, 21:00', gagne: true },
    { match: 'Dortmund vs RB Leipzig', marche: 'Les deux équipes marquent', cote: 1.62, ligue: 'Bundesliga', date: '25 Avr, 20:45', gagne: true },
    { match: 'Arsenal vs Liverpool', marche: 'Score Exact 1-1', cote: 6.50, ligue: 'Premier League', date: '24 Avr, 18:30', gagne: false },
    { match: 'Real Madrid vs Betis', marche: 'Victoire Real Madrid', cote: 1.45, ligue: 'LaLiga', date: '23 Avr, 21:00', gagne: true },
    { match: 'Man City vs Arsenal', marche: 'Plus 3.5 buts', cote: 2.20, ligue: 'Premier League', date: '22 Avr, 20:00', gagne: true },
    { match: 'Napoli vs Roma', marche: 'Score Exact 2-0', cote: 9.00, ligue: 'Serie A', date: '21 Avr, 20:45', gagne: true }
  ],

  journal_articles: [
    {
      id: 1,
      kicker: 'Analyse Profonde',
      titre: 'Pourquoi la Premier League est piégeuse ce soir',
      extrait: "Les data-modèles signalent une instabilité inhabituelle sur les marchés de l'Over 2.5 en Angleterre. Décryptage des facteurs de variance qui peuvent faire exploser votre bankroll.",
      emoji: '📊',
      temps: 'Il y a 2h',
      locked: false
    },
    {
      id: 2,
      kicker: 'Marché des Buteurs',
      titre: 'Mbappé vs Haaland : Le duel des probabilités',
      extrait: "L'analyse croisée des expected goals révèle une anomalie de cote sur ce week-end. Le marché sous-estime la fatigue structurelle des deux équipes défensives.",
      emoji: '⚡',
      temps: 'Il y a 4h',
      locked: true
    },
    {
      id: 3,
      kicker: 'Stratégie Long Terme',
      titre: "L'influence tactique de la météo en Bundesliga",
      extrait: "Trop souvent ignoré, le facteur climatique est une composante clé de nos algorithmes. Certains stades ouverts subissent des courants d'air qui impactent les ballons longs de +12%.",
      emoji: '🌬️',
      temps: 'Hier',
      locked: true
    }
  ],

  tendances: [
    { rang: '01', titre: 'Chute des cotes sur le Real Madrid', detail: 'Volume de mises anormal sur le nul.' },
    { rang: '02', titre: 'Série A : Faille détectée à Naples', detail: 'Concentration de data sur les corners.' },
    { rang: '03', titre: 'PSG : Form disparate sur les déplacements', detail: 'Moins de 2.5 buts à 78% sur 10 matchs.' }
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
    { nom: 'Kofi', ville: 'Accra', gain: '+18 200 FCFA', action: 'validé Real Madrid @1.85' },
    { nom: 'Aminata', ville: 'Bamako', gain: '+215 000 FCFA', action: 'touché le score exact @9.00' },
    { nom: 'Franck', ville: 'Douala', gain: '+55 000 FCFA', action: 'validé Inter vs Juventus' },
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
      { jour: 1, match: 'Man. City vs Chelsea', prono: 'City over 1.5 buts', cote: 1.30, gain: '+3 000', gagne: true },
      { jour: 2, match: 'Real Madrid vs Valence', prono: 'Victoire Real Madrid', cote: 1.45, gain: '+4 500', gagne: true },
      { jour: 3, match: 'Marseille vs Lyon', prono: 'Victoire Marseille', cote: 1.85, gain: null, gagne: null }
    ]
  }
};

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
  const { home, away } = splitMatchLabel(featuredProno?.match);
  const competition = featuredProno?.competition || 'Pronostic du jour';
  const kickoff = featuredProno?.heure || '--:--';
  const prono = featuredProno?.prono || 'Analyse en cours';
  const cote = featuredProno?.cote || '--';
  const analysis = featuredProno?.analyse_vip || featuredProno?.description || 'Les analyses automatiques seront affichées ici dès que le pipeline serveur termine son cycle.';
  const shareMatch = jsStringLiteral(featuredProno?.match || 'GOLIAT');
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

    const featuredCard = container.querySelector('#main-match-card');
    if (featuredCard) {
      featuredCard.outerHTML = buildFeaturedPronoCard();
    }
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

/* ============================================================
   STATE
   ============================================================ */
const STATE = {
  currentView: 'accueil',
  isVip: false,
  streak: 1,
  deferredInstallPrompt: null,

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
    return `
      <div class="match-card mb-4">
        <div class="match-header">
          <span class="badge badge-primary">${prono.competition}</span>
          <span style="font-size:0.78rem;font-weight:600;color:var(--outline);">${prono.heure}</span>
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

  // Testimonial
  testimonial(t) {
    return `
      <div class="testimonial-card">
        <div class="testimonial-stars">${'★'.repeat(t.etoiles)}</div>
        <div class="testimonial-body">"${t.texte}"</div>
        <div class="testimonial-author">— ${t.auteur}, ${t.ville} ${t.pays}</div>
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

        ${DATA.pronos_gratuits.map(p => C.matchCard(p)).join('')}

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

        <!-- Match Principal (full card) -->
        <div class="card-elevated mb-6" id="main-match-card">
          <div style="padding:20px;padding-bottom:0;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
              <span class="badge badge-primary">Champions League</span>
              <span style="display:flex;align-items:center;gap:5px;font-size:0.78rem;font-weight:600;color:var(--outline);">
                <span class="material-symbols-outlined icon-sm">schedule</span> 21:00
              </span>
            </div>
            <!-- Teams -->
            <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:0 12px;margin-bottom:14px;">
              <div style="display:flex;flex-direction:column;align-items:center;gap:8px;flex:1;">
                <div style="width:60px;height:60px;background:var(--surface-container);border-radius:14px;display:flex;align-items:center;justify-content:center;font-size:2rem;">⚪</div>
                <span style="font-weight:700;font-size:0.82rem;text-align:center;">Real Madrid</span>
              </div>
              <span style="font-weight:900;font-size:1rem;color:var(--outline-variant);opacity:0.3;">VS</span>
              <div style="display:flex;flex-direction:column;align-items:center;gap:8px;flex:1;">
                <div style="width:60px;height:60px;background:var(--surface-container);border-radius:14px;display:flex;align-items:center;justify-content:center;font-size:2rem;">🔴</div>
                <span style="font-weight:700;font-size:0.82rem;text-align:center;">Bayern Munich</span>
              </div>
            </div>
            <!-- Prediction -->
            <div style="background:var(--surface-container-low);border-radius:var(--radius-lg);padding:14px;display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
              <div>
                <div style="font-size:0.62rem;font-weight:800;text-transform:uppercase;letter-spacing:0.1em;color:var(--outline);">Pronostic IA</div>
                <div style="font-size:1rem;font-weight:900;color:var(--primary);margin-top:2px;">Victoire Real Madrid</div>
              </div>
              <div style="text-align:right;">
                <div style="font-size:0.62rem;font-weight:800;text-transform:uppercase;letter-spacing:0.1em;color:var(--outline);">Cote</div>
                <div style="font-size:1.5rem;font-weight:900;">@1.85</div>
              </div>
            </div>
          </div>

          <!-- Locked Analysis -->
          <div style="position:relative;overflow:hidden;">
            <div style="padding:16px 20px;background:rgba(231,232,233,0.4);filter:blur(5px);pointer-events:none;">
              <div style="font-weight:700;font-size:0.9rem;margin-bottom:8px;">Analyse Tactique</div>
              <div style="font-size:0.82rem;color:var(--on-surface-variant);line-height:1.6;">Le bloc défensif du Real s'est amélioré de 23% en xGA depuis le retour de Militão. L'attaque bavaroise perd en verticalité sans Neuer dans les relances...</div>
              <div style="height:10px;background:rgba(187,202,191,0.3);border-radius:6px;width:80%;margin-top:8px;"></div>
            </div>
            <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);background:rgba(225,227,228,0.55);">
              <span style="font-size:1.6rem;">🔒</span>
              <span style="font-size:0.75rem;font-weight:800;text-transform:uppercase;letter-spacing:0.1em;color:var(--on-surface);">Analyse Tactique VIP</span>
              <button class="btn-ghost" onclick="Modal.open()">Passer VIP</button>
            </div>
          </div>

          <!-- CTA row -->
          <div style="padding:16px 20px;display:flex;gap:10px;align-items:center;">
            <button class="btn-primary" style="flex:1;" onclick="UI.shareTicket('Real Madrid vs Bayern','Victoire Real Madrid',1.85)">
              <span class="material-symbols-outlined icon-sm">confirmation_number</span> VOIR LE TICKET
            </button>
            <button style="width:48px;height:48px;background:var(--surface-container);border-radius:50%;display:flex;align-items:center;justify-content:center;border:none;cursor:pointer;color:#25D366;font-size:1.2rem;" onclick="UI.shareTicket('Real Madrid vs Bayern','Victoire Real Madrid',1.85)">
              <span class="material-symbols-outlined">share</span>
            </button>
          </div>
        </div>

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
          </div>
          <div style="width:100%;background:rgba(0,0,0,0.06);border-radius:var(--radius-lg);padding:12px;">
            <div style="font-size:0.65rem;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:var(--outline);margin-bottom:4px;">Accès unique</div>
            <div style="font-size:1.6rem;font-weight:900;color:var(--on-surface);letter-spacing:-0.04em;">1 000 <span style="font-size:1rem;font-weight:700;">FCFA</span></div>
          </div>
          <button class="btn-secondary" style="width:100%;justify-content:center;" onclick="window.open('https://VOTRE-LIEN-BONUS-PRONO.com','_blank')">
            <span class="material-symbols-outlined icon-sm icon-filled">lock_open</span>
            DÉBLOQUER CE PRONO — 1 000 FCFA
          </button>
          <div style="font-size:0.65rem;color:var(--outline);font-weight:600;">Paiement sécurisé · Mobile Money · Résultat immédiat</div>
        </div>

        <!-- Pronos gratuits section -->
        <div class="section-header mb-4">
          <h2 class="section-title">Autres Pronos Gratuits</h2>
        </div>
        ${DATA.pronos_gratuits.map(p => C.matchCard(p)).join('')}

        <!-- VIP locked pronos -->
        <div class="section-header mb-4" style="margin-top:8px;">
          <h2 class="section-title">Exclusivités VIP</h2>
          <span class="badge badge-gold">👑 VIP</span>
        </div>
        <div id="vip-pronos-list">
          ${DATA.pronos_vip.map(p => C.matchCardLocked(p)).join('')}
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
          <div style="height:200px;background:linear-gradient(135deg,#0f3323,#006c49);display:flex;align-items:flex-end;padding:20px;position:relative;overflow:hidden;">
            <div style="position:absolute;top:0;right:0;width:160px;height:160px;background:rgba(16,185,129,0.1);border-radius:50%;filter:blur(40px);"></div>
            <div style="position:relative;z-index:1;">
              <span class="badge" style="background:var(--secondary-container);color:var(--on-secondary-container);margin-bottom:8px;">Analyse Profonde</span>
              <h2 style="font-size:1.2rem;font-weight:900;color:white;letter-spacing:-0.04em;line-height:1.3;">Pourquoi la Champions League est piégeuse ce soir</h2>
            </div>
          </div>
          <div class="article-body">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
              <div style="width:28px;height:28px;border-radius:50%;background:var(--gradient-primary);display:flex;align-items:center;justify-content:center;font-size:0.8rem;color:white;font-weight:800;">J</div>
              <span style="font-size:0.78rem;font-weight:600;color:var(--on-surface-variant);">Jean-Marc Expert · Il y a 2h</span>
            </div>
            <p class="article-excerpt">Les data-modèles signalent une instabilité inhabituelle sur les marchés de l'Over 2.5 en Champions League ce soir. Le volume de mises sur le Real Madrid est anormalement élevé — signe d'information privée ou de mouvement de foule ? Décryptage.</p>
            <button class="btn-ghost" style="margin-top:14px;">Lire l'analyse complète →</button>
          </div>
        </div>

        <!-- Tendances à Chaud -->
        <div style="background:var(--surface-container-low);border-radius:var(--radius-xl);padding:18px;margin-bottom:24px;">
          <h3 style="font-weight:900;font-size:1rem;margin-bottom:16px;letter-spacing:-0.02em;">🔥 Tendances à Chaud</h3>
          <div style="display:flex;flex-direction:column;gap:14px;">
            ${DATA.tendances.map(t => `
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

        <!-- Expert Articles Feed -->
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px;">
          <h2 style="font-size:1.2rem;font-weight:900;letter-spacing:-0.03em;">Flux de l'Expert</h2>
          <div style="flex:1;height:2px;background:var(--surface-container-high);"></div>
        </div>

        ${DATA.journal_articles.map(a => {
      if (!a.locked) {
        return `
              <div class="card-elevated mb-6" style="padding:20px;">
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
                  <span style="font-size:0.65rem;font-weight:800;text-transform:uppercase;letter-spacing:0.1em;color:var(--primary);">${a.kicker}</span>
                  <span style="width:3px;height:3px;border-radius:50%;background:var(--outline-variant);display:inline-block;"></span>
                  <span style="font-size:0.72rem;color:var(--on-surface-variant);">${a.temps}</span>
                </div>
                <h3 style="font-size:1.05rem;font-weight:900;letter-spacing:-0.03em;line-height:1.35;margin-bottom:8px;">${a.emoji} ${a.titre}</h3>
                <p style="font-size:0.8rem;color:var(--on-surface-variant);font-weight:500;line-height:1.6;margin-bottom:14px;">${a.extrait}</p>
                <button class="btn-ghost">Voir le rapport complet →</button>
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
                  <p style="font-size:0.8rem;color:var(--on-surface-variant);font-weight:500;line-height:1.6;">${a.extrait.substring(0, 100)}...</p>
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

        <!-- Testimonials -->
        <div class="section-header mb-4">
          <h2 class="section-title">Ils ont rejoint l'Élite</h2>
        </div>
        <div class="space-y-4 mb-6">
          ${DATA.temoignages.map(t => C.testimonial(t)).join('')}
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
    const banner = document.getElementById('install-banner');
    if (banner && PWA.deferredPrompt) {
      banner.classList.add('show');
    }
  },

  hideInstallBanner() {
    const banner = document.getElementById('install-banner');
    if (banner) banner.classList.remove('show');
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

  // Simulate a "Late Value" local notification
  scheduleLocalAlert() {
    const alerts = [
      { titre: 'Cote VIP en explosion — @5.80', sub: 'Inter vs Juventus · Score exact · 47min restantes' },
      { titre: 'Alerte Dernière Minute !', sub: 'Real Madrid @1.85 → cote qui chute dans 30min' },
      { titre: '🔥 La Montante VIP — Jour 3', sub: 'Mise recommandée : 24 500 FCFA sur Marseille' }
    ];
    const alert = alerts[Math.floor(Math.random() * alerts.length)];

    setTimeout(() => {
      const banner = document.getElementById('late-value-alert');
      if (banner) {
        banner.querySelector('.alert-title').textContent = alert.titre;
        banner.querySelector('.alert-sub').textContent = alert.sub;
        banner.classList.add('show');
        setTimeout(() => banner.classList.remove('show'), 8000);
      }
    }, 6000);
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
  if (goVipBtn) goVipBtn.addEventListener('click', Modal.open);

  // Modal backdrop close
  const backdrop = document.getElementById('modal-backdrop');
  if (backdrop) backdrop.addEventListener('click', Modal.close);

  // Modal close button
  const modalClose = document.getElementById('modal-close-btn');
  if (modalClose) modalClose.addEventListener('click', Modal.close);

  // Late value alert close
  const alertClose = document.getElementById('alert-close-btn');
  if (alertClose) alertClose.addEventListener('click', () => {
    document.getElementById('late-value-alert')?.classList.remove('show');
  });

  // Alert CTA
  const alertCta = document.getElementById('alert-cta-btn');
  if (alertCta) alertCta.addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById('late-value-alert')?.classList.remove('show');
    Modal.open();
  });

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

  // 8. Firebase + API init (async, non-blocking)
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
        // Update free pronos data
        DATA.pronos_gratuits = todayData.free.map(p => ({
          id: p.fixture_id || p.id,
          competition: p.competition,
          match: p.match,
          equipe1: '⚽', equipe2: '🏆',
          prono: p.prono,
          cote: p.cote,
          heure: p.heure,
          fiabilite: p.fiabilite,
          categorie: p.categorie,
          description: p.description
        }));
      }

      if (todayData?.vip_preview?.length > 0) {
        // Update VIP locked pronos
        DATA.pronos_vip = todayData.vip_preview.map(p => ({
          id: p.fixture_id || p.id,
          competition: p.competition,
          match: p.match,
          equipe1: '⚽', equipe2: '🏆',
          prono: p.prono || '???',
          cote: p.cote || '?.??',
          heure: p.heure,
          categorie: p.categorie || 'VIP',
          locked: p.locked !== false
        }));
      }

      // Show how many pronos are available
      if (todayData?.meta) {
        const count = todayData.meta.total;
        if (count > 0) {
          console.info(`[GOLIAT] ${count} pronos chargés depuis le serveur ✅`);
        }
      }

      // Refresh current view if it displays pronos
      const currentView = STATE.currentView;
      if (['accueil', 'pronos'].includes(currentView)) {
        App.render(currentView);
      }

    } catch (err) {
      console.warn('[Init] API non disponible — données statiques utilisées:', err.message);
    }
  }, 800);


  // 9. Ask for notification permission after 30s (non-intrusive)
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
