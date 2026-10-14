import { nettoyer, verifierCles, envoyer, expliquerCode } from './push.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    let response;

    if (url.pathname === '/api/signalement-collaborateur') {
      response = await handleCollaborateurSubmission(request, env, ctx);
    } else if (url.pathname === '/api/expression-besoin') {
      response = await handleBesoinSubmission(request, env, ctx);
    } else if (url.pathname === '/api/ajout-complement') {
      response = await handleComplementSubmission(request, env, ctx);
    } else if (url.pathname === '/api/cr-file-upload') {
      response = await handleCrFileUpload(request, env, ctx);
    } else if (url.pathname === '/api/cr-file') {
      response = await handleCrFileGet(request, env, ctx);
    } else if (url.pathname === '/api/cr-password-check') {
      response = await handleCrPasswordCheck(request, env, ctx);
    } else if (url.pathname === '/api/cr-liste-publique') {
      response = await handleCrListePublique(request, env, ctx);
    } else if (url.pathname === '/api/insp-file-upload') {
      response = await handleInspFileUpload(request, env, ctx);
    } else if (url.pathname === '/api/insp-file') {
      response = await handleInspFileGet(request, env, ctx);
    } else if (url.pathname === '/api/notif-cle') {
      response = await handleNotifCle(request, env);
    } else if (url.pathname === '/api/notif-test') {
      response = await handleNotifTest(request, env);
    } else {
      response = await env.ASSETS.fetch(request);
    }

    return withSecurityHeaders(response);
  }
};

// Content-Security-Policy établie en listant, page par page, toutes les ressources externes
// réellement chargées par le site (polices Google, SDK Firebase, unpkg pour docx/jsPDF/mammoth/
// pdf.js, api.qrserver.com pour les QR codes, et l'appel direct à firestore.googleapis.com fait
// par cr_reunion_collaborateurs.html pour lire le logo sans SDK Firebase). 'unsafe-inline' reste
// nécessaire sur script-src et style-src car toutes les pages du site écrivent leur CSS/JS
// directement dans la page plutôt que dans des fichiers séparés — la CSP ne bloque donc pas un
// script injecté par une faille XSS, mais elle empêche un tel script d'exfiltrer des données vers
// un domaine extérieur non listé, de charger un script externe non autorisé, d'afficher le site
// dans un cadre sur un autre site (frame-ancestors), ou de détourner un formulaire (form-action).
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://www.gstatic.com https://unpkg.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: https://api.qrserver.com",
  "connect-src 'self' https://firestore.googleapis.com https://identitytoolkit.googleapis.com https://securetoken.googleapis.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "object-src 'none'",
  "form-action 'self'"
].join('; ');

// En-têtes de sécurité HTTP ajoutés à toutes les réponses (pages ET API) : réduisent le risque
// de détournement de clickjacking (X-Frame-Options) et de mauvaise interprétation d'un fichier
// par le navigateur (X-Content-Type-Options), limitent les informations transmises à d'autres
// sites via l'en-tête Referer, et forcent HTTPS (HSTS).
//
// CSP activée en mode bloquant (passée depuis "Report-Only" le 08/09/2026, après vérification en
// production sur les pages principales du site sans aucune violation constatée). En cas de
// problème après coup (une ressource externe légitime non listée ci-dessus), le symptôme est
// ciblé — une fonctionnalité précise qui échoue silencieusement, jamais la page entière — et une
// ligne "Refused to load ... because it violates the following Content Security Policy directive"
// apparaît dans la console du navigateur (F12) pour identifier la ressource à ajouter à la liste.
// Revert rapide en cas de souci bloquant : remettre 'Content-Security-Policy-Report-Only' ci-dessous.
function withSecurityHeaders(response) {
  const headers = new Headers(response.headers);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  headers.set('Content-Security-Policy', CONTENT_SECURITY_POLICY);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers: headers });
}

// Sécurité : plus de "Access-Control-Allow-Origin: *". Toutes les pages du site appellent ces
// endpoints en chemin relatif ("/api/...") depuis leur propre page, donc en même origine que le
// Worker qui les sert — le navigateur n'a jamais besoin d'un en-tête CORS pour ça. Ne plus envoyer
// cet en-tête revient donc à fermer tout accès cross-origin (le vecteur d'abus identifié lors de
// l'audit) sans rien changer pour l'usage réel du site, ni dépendre d'un nom de domaine particulier.
const CORS_HEADERS = {
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};

// Limitation de débit anti-abus (formulaires publics + mot de passe CR), via la Rate Limiting API
// native de Cloudflare Workers (bindings "RATE_LIMITER_FORMS"/"RATE_LIMITER_CR_PASSWORD" à ajouter
// dans wrangler.jsonc, voir claude/mode-operatoire-multi-cssct.md — rien à créer manuellement dans
// le tableau de bord, contrairement à une KV). Tant que ces bindings n'existent pas encore (avant le
// prochain déploiement), la vérification est ignorée silencieusement : aucun risque de casser les
// formulaires en attendant, la protection s'active automatiquement une fois le binding en place.
async function checkRateLimit(env, bindingName, request) {
  const limiter = env[bindingName];
  if (!limiter) return true; // binding pas encore configuré : on laisse passer
  try {
    const ip = request.headers.get('CF-Connecting-IP') || 'inconnu';
    const { success } = await limiter.limit({ key: ip });
    return success;
  } catch (err) {
    console.error('Erreur limitation de débit (' + bindingName + ') : ' + err.message);
    return true; // en cas d'erreur du service de rate limiting, on ne bloque pas l'utilisateur légitime
  }
}
function tooManyRequestsResponse() {
  return new Response(JSON.stringify({ error: 'Trop de tentatives, réessaie dans quelques minutes.' }), { status: 429, headers: CORS_HEADERS });
}

// Doit correspondre au "projectId" du firebaseConfig utilisé dans les pages du site.
const FIREBASE_PROJECT_ID = 'cssct-cs2e-c655b';

const DEFAULT_CSSCT_EMAILS = ['choudayer@smag.tech'];

// Modèles par défaut, utilisés tant que config/email_templates (éditable depuis Administration
// > Dossiers de signalement / Expression de besoin > Modèles d'email) n'a pas été personnalisé
// pour le champ correspondant. Le client transmet le contenu de ce document dans `data.templates`.
const DEFAULT_TEMPLATES = {
  signalementConfirmation: {
    subject: 'Confirmation de votre signalement CSSCT - {{numero}}',
    body: 'Bonjour,\n\nVous venez de réaliser une demande de suivi auprès du CSSCT. Merci pour votre message. Nous allons étudier votre demande qui porte le numéro "{{numero}}" qu\'il faudra systématiquement intégrer dans nos échanges.\n\nVotre code de suivi est : {{codeSuivi}}\nConservez-le précieusement : il vous permettra de suivre l\'avancement de votre demande et d\'ajouter un complément si besoin, depuis la page "Suivre ma demande".\n\nSi des photos doivent être transmises, vous pouvez les envoyer en réponse à ce mail.\n\nNous vous souhaitons une bonne journée.'
  },
  signalementNotifCSSCT: {
    subject: 'Formulaire CSSCT - {{nature}} - {{numero}}',
    body: 'Bonjour,\n\nUn nouveau signalement a été réalisé par {{rapporteur}} sur le site de {{site}} et concerne un {{nature}} : {{objet}}\nLe suivi se fera sous le numéro {{numero}}\n\n\nCe message a été envoyé automatiquement de l\'application CSSCT.'
  },
  besoinConfirmation: {
    subject: 'Confirmation de votre demande CSSCT - {{codeSuivi}}',
    body: 'Bonjour,\n\nNous avons bien reçu votre expression de besoin auprès du CSSCT. Merci pour votre message.\n\nVotre code de suivi est : {{codeSuivi}}\nConservez-le précieusement : il vous permettra de suivre l\'avancement de votre demande et d\'ajouter un complément si besoin, depuis la page "Suivre ma demande".\n\nNous vous souhaitons une bonne journée.'
  },
  besoinNotifCSSCT: {
    subject: 'Formulaire CSSCT - Expression de besoin - {{theme}}',
    body: 'Bonjour,\n\nUne nouvelle expression de besoin a été déposée ({{auteurLabel}}{{entrepriseLabel}}).\nThème : {{theme}}\nDescription : {{description}}\n\nLe suivi se fera sous le code {{codeSuivi}}\n\nCe message a été envoyé automatiquement de l\'application CSSCT.'
  }
};

function fillTemplate(str, vars) {
  return String(str || '').replace(/\{\{(\w+)\}\}/g, function (_, key) {
    return (vars[key] !== undefined && vars[key] !== null) ? String(vars[key]) : '';
  });
}

function pickTemplate(templates, key) {
  const t = (templates && templates[key]) || {};
  const d = DEFAULT_TEMPLATES[key];
  return {
    subject: t.subject || d.subject,
    body: t.body || d.body
  };
}

function resolveDestinataires(list) {
  if (Array.isArray(list)) {
    const cleaned = list.map(function (e) { return String(e || '').trim(); }).filter(Boolean);
    if (cleaned.length) return cleaned;
  }
  return DEFAULT_CSSCT_EMAILS.slice();
}

// Sécurité : les destinataires et les modèles d'email ne sont plus jamais pris depuis le corps
// de la requête (n'importe qui pouvait sinon faire envoyer un email à n'importe qui, avec
// n'importe quel contenu, via Mailjet — cf. audit cybersécurité). On les relit nous-mêmes dans
// Firestore avec l'accès privilégié du compte de service, déjà utilisé pour les CR. Si ce
// compte de service n'est pas configuré, on retombe silencieusement sur les valeurs par défaut
// (l'envoi continue de fonctionner, juste sans personnalisation tant que ce n'est pas en place).
async function fetchDestinatairesConfig(env, configId) {
  try {
    const doc = await firestoreGetDoc(env, 'config/' + configId);
    return (doc && Array.isArray(doc.list)) ? doc.list : null;
  } catch (err) {
    console.error('Lecture config/' + configId + ' impossible (compte de service non configuré ?) : ' + err.message);
    return null;
  }
}
async function fetchEmailTemplatesConfig(env) {
  try {
    const doc = await firestoreGetDoc(env, 'config/email_templates');
    return doc || {};
  } catch (err) {
    console.error('Lecture config/email_templates impossible (compte de service non configuré ?) : ' + err.message);
    return {};
  }
}

async function sendMailjet(env, messages) {
  const mjAuth = btoa(env.MAILJET_API_KEY + ':' + env.MAILJET_API_SECRET);
  const mjResp = await fetch('https://api.mailjet.com/v3.1/send', {
    method: 'POST',
    headers: { 'Authorization': 'Basic ' + mjAuth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ Messages: messages })
  });
  return mjResp;
}

async function sendNtfy(env, title, body) {
  if (!env.NTFY_TOPIC) {
    console.error('NTFY_TOPIC absent du Worker');
    return;
  }
  const ntfyUrl = 'https://ntfy.sh/' + env.NTFY_TOPIC;
  try {
    const ntfyResponse = await fetch(ntfyUrl, {
      method: 'POST',
      headers: {
        'Title': title,
        'Priority': 'default',
        'Tags': 'bell'
      },
      body: body
    });
    const ntfyResponseText = await ntfyResponse.text();
    console.log('NTFY HTTP status:', ntfyResponse.status);
    console.log('NTFY réponse:', ntfyResponseText);
    if (!ntfyResponse.ok) {
      console.error('Erreur NTFY');
    }
  } catch (error) {
    console.error('Erreur appel NTFY:', error.message);
  }
}

async function handleCollaborateurSubmission(request, env, ctx) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: CORS_HEADERS });
  }
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Methode non autorisee' }), { status: 405, headers: CORS_HEADERS });
  }
  if (!(await checkRateLimit(env, 'RATE_LIMITER_FORMS', request))) {
    return tooManyRequestsResponse();
  }

  try {
    const data = await request.json();
    const numero = data.numero;
    const codeSuivi = data.codeSuivi || '';
    const rapporteur = data.rapporteur || '';
    const rapporteurEmail = data.rapporteurEmail || '';
    const site = data.site || '';
    const nature = data.nature || '';
    const objet = data.objet || '';

    if (!numero || !rapporteurEmail || !objet) {
      return new Response(JSON.stringify({ error: 'Champs obligatoires manquants' }), { status: 400, headers: CORS_HEADERS });
    }

    const vars = { numero, codeSuivi, rapporteur, site, nature, objet };
    const templatesDoc = await fetchEmailTemplatesConfig(env);
    const tConfirm = pickTemplate(templatesDoc, 'signalementConfirmation');
    const tNotif = pickTemplate(templatesDoc, 'signalementNotifCSSCT');
    const collabSubject = fillTemplate(tConfirm.subject, vars);
    const collabBody = fillTemplate(tConfirm.body, vars);
    const cssctSubject = fillTemplate(tNotif.subject, vars);
    const cssctBody = fillTemplate(tNotif.body, vars);

    const fromEmail = env.MAILJET_FROM_EMAIL || 'cs2esolution@gmail.com';
    const fromName = env.MAILJET_FROM_NAME || 'CSSCT';
    const cssctEmails = resolveDestinataires(await fetchDestinatairesConfig(env, 'notifications_signalement'));

    const messages = [
      {
        From: { Email: fromEmail, Name: fromName },
        To: [{ Email: rapporteurEmail }],
        Subject: collabSubject,
        TextPart: collabBody
      }
    ];

    if (cssctEmails.length) {
      messages.push({
        From: { Email: fromEmail, Name: fromName },
        To: cssctEmails.map(function(e){ return { Email: e }; }),
        Subject: cssctSubject,
        TextPart: cssctBody,
        Headers: { 'X-Priority': '1', 'Importance': 'High' }
      });
    }

    const mjResp = await sendMailjet(env, messages);

    if (!mjResp.ok) {
      const errText = await mjResp.text();
      return new Response(JSON.stringify({ error: 'Erreur envoi email', detail: errText }), { status: 502, headers: CORS_HEADERS });
    }

    // Sécurité/confidentialité : le contenu envoyé à ntfy.sh (service tiers, sans contrôle
    // d'accès fiable sur le nom du topic) reste volontairement générique — jamais le nom du
    // rapporteur, le site, la nature ou l'objet du signalement, ni le code de suivi.
    await sendNtfy(env, 'Nouveau signalement CSSCT', 'Un nouveau signalement (n°' + numero + ') a été déposé. Consulte l\'application pour le détail.');

    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: CORS_HEADERS });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: CORS_HEADERS });
  }
}

async function handleBesoinSubmission(request, env, ctx) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: CORS_HEADERS });
  }
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Methode non autorisee' }), { status: 405, headers: CORS_HEADERS });
  }
  if (!(await checkRateLimit(env, 'RATE_LIMITER_FORMS', request))) {
    return tooManyRequestsResponse();
  }

  try {
    const data = await request.json();
    const codeSuivi = data.codeSuivi;
    const nomPrenom = data.nomPrenom || '';
    const entreprise = data.entreprise || '';
    const emailContact = data.emailContact || '';
    const theme = data.theme || '';
    const description = data.description || '';

    if (!codeSuivi || !theme) {
      return new Response(JSON.stringify({ error: 'Champs obligatoires manquants' }), { status: 400, headers: CORS_HEADERS });
    }

    const fromEmail = env.MAILJET_FROM_EMAIL || 'cs2esolution@gmail.com';
    const fromName = env.MAILJET_FROM_NAME || 'CSSCT';
    const cssctEmails = resolveDestinataires(await fetchDestinatairesConfig(env, 'notifications_besoin'));
    const templatesDoc = await fetchEmailTemplatesConfig(env);

    const auteurLabel = nomPrenom || 'anonyme';
    const entrepriseLabel = entreprise ? (', ' + entreprise) : '';
    const vars = { codeSuivi, theme, description, auteurLabel, entrepriseLabel };

    const messages = [];

    if (emailContact) {
      const tConfirm = pickTemplate(templatesDoc, 'besoinConfirmation');
      messages.push({
        From: { Email: fromEmail, Name: fromName },
        To: [{ Email: emailContact }],
        Subject: fillTemplate(tConfirm.subject, vars),
        TextPart: fillTemplate(tConfirm.body, vars)
      });
    }

    if (cssctEmails.length) {
      const tNotif = pickTemplate(templatesDoc, 'besoinNotifCSSCT');
      messages.push({
        From: { Email: fromEmail, Name: fromName },
        To: cssctEmails.map(function(e){ return { Email: e }; }),
        Subject: fillTemplate(tNotif.subject, vars),
        TextPart: fillTemplate(tNotif.body, vars),
        Headers: { 'X-Priority': '1', 'Importance': 'High' }
      });
    }

    if (messages.length) {
      const mjResp = await sendMailjet(env, messages);
      if (!mjResp.ok) {
        const errText = await mjResp.text();
        return new Response(JSON.stringify({ error: 'Erreur envoi email', detail: errText }), { status: 502, headers: CORS_HEADERS });
      }
    }

    // Sécurité/confidentialité : idem, contenu générique envoyé à ntfy.sh (jamais le nom,
    // le thème ou la description).
    await sendNtfy(env, 'Nouvelle expression de besoin CSSCT', 'Une nouvelle expression de besoin a été déposée. Consulte l\'application pour le détail.');

    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: CORS_HEADERS });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: CORS_HEADERS });
  }
}

async function handleComplementSubmission(request, env, ctx) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: CORS_HEADERS });
  }
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Methode non autorisee' }), { status: 405, headers: CORS_HEADERS });
  }
  if (!(await checkRateLimit(env, 'RATE_LIMITER_FORMS', request))) {
    return tooManyRequestsResponse();
  }

  try {
    const data = await request.json();
    const kind = data.kind === 'besoin' ? 'besoin' : 'signalement';
    const code = data.code || '';
    const numero = data.numero || null;
    const objet = data.objet || '';
    const text = data.text || '';

    if (!code || !text) {
      return new Response(JSON.stringify({ error: 'Champs obligatoires manquants' }), { status: 400, headers: CORS_HEADERS });
    }

    const fromEmail = env.MAILJET_FROM_EMAIL || 'cs2esolution@gmail.com';
    const fromName = env.MAILJET_FROM_NAME || 'CSSCT';
    const cssctEmails = resolveDestinataires(await fetchDestinatairesConfig(env, kind === 'signalement' ? 'notifications_signalement' : 'notifications_besoin'));

    const label = kind === 'signalement'
      ? ('dossier de signalement' + (numero ? ' n°' + numero : '') + ' (' + code + ')')
      : ('expression de besoin (' + code + ')');
    // Version sans le code de suivi, pour la notification ntfy.sh (canal tiers non fiable) :
    // le code est un jeton d'accès au dossier, il ne doit jamais transiter par ce canal.
    const labelSansCode = kind === 'signalement'
      ? ('un dossier de signalement' + (numero ? ' n°' + numero : ''))
      : ('une expression de besoin');

    const cssctBody =
`Bonjour,

Un complément a été ajouté sur un ${label}${objet ? ' — ' + objet : ''} :

"${text}"

Ce message a été envoyé automatiquement de l'application CSSCT.`;

    if (cssctEmails.length) {
      const mjResp = await sendMailjet(env, [{
        From: { Email: fromEmail, Name: fromName },
        To: cssctEmails.map(function(e){ return { Email: e }; }),
        Subject: `Formulaire CSSCT - Complément ajouté - ${code}`,
        TextPart: cssctBody,
        Headers: { 'X-Priority': '1', 'Importance': 'High' }
      }]);
      if (!mjResp.ok) {
        const errText = await mjResp.text();
        return new Response(JSON.stringify({ error: 'Erreur envoi email', detail: errText }), { status: 502, headers: CORS_HEADERS });
      }
    }

    // Sécurité/confidentialité : ni le code de suivi (jeton d'accès au dossier), ni le texte
    // du complément, ne partent vers ntfy.sh.
    await sendNtfy(env, 'Complément ajouté - CSSCT', 'Un complément a été ajouté sur ' + labelSansCode + '. Consulte l\'application pour le détail.');

    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: CORS_HEADERS });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: CORS_HEADERS });
  }
}

// ============================================================================
// Comptes-rendus de réunion — fichiers PDF/Word (stockage Workers KV,
// binding "CR_FILES" à créer manuellement, voir mode opératoire) + accès
// collaborateurs protégé par mot de passe (voir claude/mode-operatoire-multi-cssct.md,
// étape "Compte de service Firebase").
// ============================================================================

// --- Utilitaires base64url (JWT / jetons de session) ---

function base64urlFromBytes(bytes) {
  let str = '';
  for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function base64urlFromString(str) {
  return base64urlFromBytes(new TextEncoder().encode(str));
}
function base64urlDecodeToString(input) {
  input = String(input || '').replace(/-/g, '+').replace(/_/g, '/');
  while (input.length % 4) input += '=';
  return atob(input);
}
function base64urlToBytes(input) {
  const str = base64urlDecodeToString(input);
  const bytes = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) bytes[i] = str.charCodeAt(i);
  return bytes;
}
function pemToBytes(pem) {
  const b64 = String(pem || '')
    .replace(/-----BEGIN [^-]+-----/, '')
    .replace(/-----END [^-]+-----/, '')
    .replace(/\s+/g, '');
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
async function sha256Hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
}

// --- Vérification d'un ID token Firebase (côté admin, sans dépendance externe) ---

let _jwksCache = null;
async function getFirebaseJWKS() {
  if (_jwksCache && _jwksCache.exp > Date.now()) return _jwksCache.keys;
  const resp = await fetch('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com');
  const data = await resp.json();
  _jwksCache = { keys: data.keys, exp: Date.now() + 3600 * 1000 };
  return data.keys;
}

async function verifyFirebaseIdToken(idToken) {
  const parts = String(idToken || '').split('.');
  if (parts.length !== 3) throw new Error('Token malformé');
  const header = JSON.parse(base64urlDecodeToString(parts[0]));
  const payload = JSON.parse(base64urlDecodeToString(parts[1]));
  const now = Math.floor(Date.now() / 1000);
  if (!payload.exp || payload.exp < now) throw new Error('Token expiré');
  if (payload.aud !== FIREBASE_PROJECT_ID) throw new Error('Audience invalide');
  if (payload.iss !== 'https://securetoken.google.com/' + FIREBASE_PROJECT_ID) throw new Error('Émetteur invalide');
  if (!payload.email) throw new Error('Email manquant dans le token');

  const keys = await getFirebaseJWKS();
  const jwk = keys.find(function (k) { return k.kid === header.kid; });
  if (!jwk) throw new Error('Clé de signature Firebase inconnue');
  const cryptoKey = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const signInput = parts[0] + '.' + parts[1];
  const sigBytes = base64urlToBytes(parts[2]);
  const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', cryptoKey, sigBytes, new TextEncoder().encode(signInput));
  if (!valid) throw new Error('Signature invalide');

  return String(payload.email).toLowerCase();
}

// --- Accès Firestore privilégié via compte de service Google (contourne les
// règles de sécurité — réservé aux besoins serveur : lecture des CR accessibles
// aux collaborateurs et vérification de la liste des admins autorisés). ---

let _googleTokenCache = null;
async function getGoogleAccessToken(env) {
  const now = Math.floor(Date.now() / 1000);
  if (_googleTokenCache && _googleTokenCache.exp > now + 60) return _googleTokenCache.token;

  if (!env.GOOGLE_SERVICE_ACCOUNT_KEY) {
    throw new Error("Secret GOOGLE_SERVICE_ACCOUNT_KEY absent du Worker (compte de service Firebase non configuré).");
  }
  const key = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_KEY);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claimSet = {
    iss: key.client_email,
    scope: 'https://www.googleapis.com/auth/datastore',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now
  };
  const signInput = base64urlFromString(JSON.stringify(header)) + '.' + base64urlFromString(JSON.stringify(claimSet));
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8', pemToBytes(key.private_key).buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']
  );
  const sigBuf = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, new TextEncoder().encode(signInput));
  const jwt = signInput + '.' + base64urlFromBytes(new Uint8Array(sigBuf));

  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=' + encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer') + '&assertion=' + encodeURIComponent(jwt)
  });
  const data = await resp.json();
  if (!data.access_token) throw new Error('Erreur obtention token Google : ' + JSON.stringify(data));
  _googleTokenCache = { token: data.access_token, exp: now + (data.expires_in || 3600) };
  return _googleTokenCache.token;
}

function fsDecodeValue(v) {
  if (v == null) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return parseInt(v.integerValue, 10);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fsDecodeValue);
  if ('mapValue' in v) return fsDecodeFields(v.mapValue.fields || {});
  return null;
}
function fsDecodeFields(fields) {
  const out = {};
  for (const k in fields) out[k] = fsDecodeValue(fields[k]);
  return out;
}
function fsDecodeDoc(doc) {
  const out = fsDecodeFields(doc.fields || {});
  out.id = doc.name.split('/').pop();
  return out;
}

async function firestoreListAll(env, collectionPath) {
  const token = await getGoogleAccessToken(env);
  let docs = [];
  let pageToken = '';
  do {
    const base = 'https://firestore.googleapis.com/v1/projects/' + FIREBASE_PROJECT_ID + '/databases/(default)/documents/' + collectionPath + '?pageSize=300';
    const resp = await fetch(base + (pageToken ? ('&pageToken=' + encodeURIComponent(pageToken)) : ''), {
      headers: { Authorization: 'Bearer ' + token }
    });
    const data = await resp.json();
    if (data.documents) docs = docs.concat(data.documents.map(fsDecodeDoc));
    pageToken = data.nextPageToken || '';
  } while (pageToken);
  return docs;
}

async function firestoreGetDoc(env, docPath) {
  const token = await getGoogleAccessToken(env);
  const resp = await fetch('https://firestore.googleapis.com/v1/projects/' + FIREBASE_PROJECT_ID + '/databases/(default)/documents/' + docPath, {
    headers: { Authorization: 'Bearer ' + token }
  });
  if (resp.status === 404) return null;
  const data = await resp.json();
  if (!data.fields) return null;
  return fsDecodeDoc(data);
}

async function requireAdmin(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const m = auth.match(/^Bearer (.+)$/);
  if (!m) throw new Error('Non authentifié');
  const email = await verifyFirebaseIdToken(m[1]);
  const adminDoc = await firestoreGetDoc(env, 'authorized_emails/' + email);
  if (!adminDoc) throw new Error('Non autorisé');
  return email;
}

// --- Jetons de session collaborateurs (après validation du mot de passe) ---

async function hmacSign(env, message) {
  if (!env.CR_ACCESS_SECRET) throw new Error('Secret CR_ACCESS_SECRET absent du Worker.');
  const keyData = new TextEncoder().encode(env.CR_ACCESS_SECRET);
  const key = await crypto.subtle.importKey('raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return base64urlFromBytes(new Uint8Array(sig));
}
async function createSessionToken(env) {
  const payload = JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 180 });
  const encPayload = base64urlFromString(payload);
  const sig = await hmacSign(env, encPayload);
  return encPayload + '.' + sig;
}
async function verifySessionToken(env, token) {
  if (!token || token.indexOf('.') === -1) return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const expectedSig = await hmacSign(env, parts[0]);
  if (expectedSig !== parts[1]) return false;
  try {
    const payload = JSON.parse(base64urlDecodeToString(parts[0]));
    return !!(payload.exp && payload.exp >= Math.floor(Date.now() / 1000));
  } catch (e) { return false; }
}

// --- Filtrage des CR accessibles aux collaborateurs ---

function redactFile(f, kind) {
  return { kind: kind, fileId: f.fileId, nomFichier: f.nomFichier, type: f.type, pages: f.pages || null, texte: f.texte || null };
}
function redactAttachment(p) {
  return { kind: 'piece-jointe', id: p.id, nom: p.nom, type: p.type, fileId: p.fileId || null, url: p.url || null };
}
async function getAccessibleCRs(env) {
  const all = await firestoreListAll(env, 'comptes_rendus_reunion');
  const out = [];
  all.forEach(function (it) {
    const fichiers = [];
    if (it.fichierConfidentiel && it.fichierConfidentiel.accessible) fichiers.push(redactFile(it.fichierConfidentiel, 'confidentiel'));
    if (it.fichierNonConfidentiel && it.fichierNonConfidentiel.accessible) fichiers.push(redactFile(it.fichierNonConfidentiel, 'non-confidentiel'));
    (it.piecesJointes || []).forEach(function (p) { if (p.accessible) fichiers.push(redactAttachment(p)); });
    if (fichiers.length) out.push({ id: it.id, titre: it.titre, date: it.date, categorie: it.categorie || '', fichiers: fichiers });
  });
  out.sort(function (a, b) { return String(b.date || '').localeCompare(String(a.date || '')); });
  return out;
}

// --- Endpoints ---

async function handleCrFileUpload(request, env, ctx) {
  if (request.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });
  if (request.method !== 'POST') return new Response(JSON.stringify({ error: 'Methode non autorisee' }), { status: 405, headers: CORS_HEADERS });
  try {
    await requireAdmin(request, env);
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 401, headers: CORS_HEADERS });
  }
  try {
    const contentLength = parseInt(request.headers.get('content-length') || '0', 10);
    if (contentLength > 25 * 1024 * 1024) {
      return new Response(JSON.stringify({ error: 'Fichier trop volumineux (25 Mo maximum).' }), { status: 413, headers: CORS_HEADERS });
    }
    const buf = await request.arrayBuffer();
    if (!env.CR_FILES) throw new Error("Binding KV \"CR_FILES\" absent (voir wrangler.jsonc).");
    const fileId = crypto.randomUUID();
    await env.CR_FILES.put(fileId, buf);
    return new Response(JSON.stringify({ ok: true, fileId: fileId, taille: buf.byteLength }), { status: 200, headers: CORS_HEADERS });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: CORS_HEADERS });
  }
}

async function handleCrFileGet(request, env, ctx) {
  if (request.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });
  const url = new URL(request.url);
  const fileId = url.searchParams.get('fileId');
  const session = url.searchParams.get('session');
  const nom = url.searchParams.get('nom') || 'fichier';
  if (!fileId) return new Response(JSON.stringify({ error: 'fileId manquant' }), { status: 400, headers: CORS_HEADERS });

  if (request.method === 'DELETE') {
    // Suppression réelle et définitive du fichier dans KV (aucune corbeille, aucune sauvegarde).
    // Réservée aux admins — jamais accessible via un jeton de session collaborateur.
    let adminEmail;
    try {
      adminEmail = await requireAdmin(request, env);
    } catch (err) {
      console.error('DELETE /api/cr-file refusé (' + fileId + ') : ' + err.message);
      return new Response(JSON.stringify({ error: err.message }), { status: 401, headers: CORS_HEADERS });
    }
    if (!env.CR_FILES) {
      console.error('DELETE /api/cr-file (' + fileId + ') : binding KV "CR_FILES" absent.');
      return new Response(JSON.stringify({ error: "Binding KV \"CR_FILES\" absent (voir wrangler.jsonc)." }), { status: 500, headers: CORS_HEADERS });
    }
    console.log('DELETE /api/cr-file par ' + adminEmail + ' — fileId=' + fileId);
    await env.CR_FILES.delete(fileId);
    const verif = await env.CR_FILES.get(fileId);
    if (verif !== null) {
      console.error('DELETE /api/cr-file : clé ' + fileId + ' encore lisible juste après la suppression (propagation KV en cours, ou binding pointant vers un autre namespace que celui affiché dans le tableau de bord).');
    } else {
      console.log('DELETE /api/cr-file : suppression de ' + fileId + ' confirmée.');
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: CORS_HEADERS });
  }

  let allowed = false;
  try {
    if (session) {
      if (await verifySessionToken(env, session)) {
        const accessible = await getAccessibleCRs(env);
        allowed = accessible.some(function (cr) { return cr.fichiers.some(function (f) { return f.fileId === fileId; }); });
      }
    } else {
      await requireAdmin(request, env);
      allowed = true;
    }
  } catch (err) {
    allowed = false;
  }
  if (!allowed) return new Response(JSON.stringify({ error: 'Accès refusé' }), { status: 403, headers: CORS_HEADERS });

  if (!env.CR_FILES) return new Response(JSON.stringify({ error: "Binding KV \"CR_FILES\" absent (voir wrangler.jsonc)." }), { status: 500, headers: CORS_HEADERS });
  const obj = await env.CR_FILES.get(fileId, 'arrayBuffer');
  if (!obj) return new Response(JSON.stringify({ error: 'Fichier introuvable' }), { status: 404, headers: CORS_HEADERS });

  const ext = (nom.split('.').pop() || '').toLowerCase();
  const contentType = ext === 'pdf' ? 'application/pdf'
    : (ext === 'docx' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    : (ext === 'doc' ? 'application/msword' : 'application/octet-stream'));

  const headers = Object.assign({}, CORS_HEADERS, {
    'Content-Type': contentType,
    'Content-Disposition': 'inline; filename="' + nom.replace(/"/g, '') + '"'
  });
  return new Response(obj, { status: 200, headers: headers });
}

// ============================================================================
// Inspections CSSCT — fichier de compte-rendu joint (même stockage KV
// "CR_FILES" que les CR de réunion, mais clé préfixée "insp_" pour bien les
// distinguer dans le tableau de bord Cloudflare ; pas de partage public ici,
// contrairement aux CR de réunion — accès réservé aux comptes autorisés de
// l'appli, comme le reste des inspections).
// ============================================================================

async function handleInspFileUpload(request, env, ctx) {
  if (request.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });
  if (request.method !== 'POST') return new Response(JSON.stringify({ error: 'Methode non autorisee' }), { status: 405, headers: CORS_HEADERS });
  try {
    await requireAdmin(request, env);
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 401, headers: CORS_HEADERS });
  }
  try {
    const contentLength = parseInt(request.headers.get('content-length') || '0', 10);
    if (contentLength > 25 * 1024 * 1024) {
      return new Response(JSON.stringify({ error: 'Fichier trop volumineux (25 Mo maximum).' }), { status: 413, headers: CORS_HEADERS });
    }
    const buf = await request.arrayBuffer();
    if (!env.CR_FILES) throw new Error("Binding KV \"CR_FILES\" absent (voir wrangler.jsonc).");
    const fileId = 'insp_' + crypto.randomUUID();
    await env.CR_FILES.put(fileId, buf);
    return new Response(JSON.stringify({ ok: true, fileId: fileId, taille: buf.byteLength }), { status: 200, headers: CORS_HEADERS });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: CORS_HEADERS });
  }
}

async function handleInspFileGet(request, env, ctx) {
  if (request.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });
  const url = new URL(request.url);
  const fileId = url.searchParams.get('fileId');
  const nom = url.searchParams.get('nom') || 'fichier';
  if (!fileId) return new Response(JSON.stringify({ error: 'fileId manquant' }), { status: 400, headers: CORS_HEADERS });

  let email;
  try {
    email = await requireAdmin(request, env);
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 401, headers: CORS_HEADERS });
  }

  if (!env.CR_FILES) return new Response(JSON.stringify({ error: "Binding KV \"CR_FILES\" absent (voir wrangler.jsonc)." }), { status: 500, headers: CORS_HEADERS });

  if (request.method === 'DELETE') {
    console.log('DELETE /api/insp-file par ' + email + ' — fileId=' + fileId);
    await env.CR_FILES.delete(fileId);
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: CORS_HEADERS });
  }

  const obj = await env.CR_FILES.get(fileId, 'arrayBuffer');
  if (!obj) return new Response(JSON.stringify({ error: 'Fichier introuvable' }), { status: 404, headers: CORS_HEADERS });

  const ext = (nom.split('.').pop() || '').toLowerCase();
  const contentType = ext === 'pdf' ? 'application/pdf'
    : (ext === 'docx' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    : (ext === 'doc' ? 'application/msword' : 'application/octet-stream'));

  const headers = Object.assign({}, CORS_HEADERS, {
    'Content-Type': contentType,
    'Content-Disposition': 'inline; filename="' + nom.replace(/"/g, '') + '"'
  });
  return new Response(obj, { status: 200, headers: headers });
}

async function handleCrPasswordCheck(request, env, ctx) {
  if (request.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });
  if (request.method !== 'POST') return new Response(JSON.stringify({ error: 'Methode non autorisee' }), { status: 405, headers: CORS_HEADERS });
  if (!(await checkRateLimit(env, 'RATE_LIMITER_CR_PASSWORD', request))) {
    return tooManyRequestsResponse();
  }
  try {
    const data = await request.json();
    const password = String(data.password || '');
    if (!password) return new Response(JSON.stringify({ error: 'Mot de passe requis' }), { status: 400, headers: CORS_HEADERS });

    const doc = await firestoreGetDoc(env, 'config/cr_password_hash');
    const storedHash = doc && doc.hash;
    if (!storedHash) {
      return new Response(JSON.stringify({ error: "Aucun mot de passe n'a encore été configuré par le CSE." }), { status: 503, headers: CORS_HEADERS });
    }
    const enteredHash = await sha256Hex(password);
    if (enteredHash !== storedHash) {
      return new Response(JSON.stringify({ error: 'Mot de passe incorrect.' }), { status: 401, headers: CORS_HEADERS });
    }
    const token = await createSessionToken(env);
    return new Response(JSON.stringify({ ok: true, token: token }), { status: 200, headers: CORS_HEADERS });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: CORS_HEADERS });
  }
}

async function handleCrListePublique(request, env, ctx) {
  if (request.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });
  const url = new URL(request.url);
  const session = url.searchParams.get('session');
  if (!session || !(await verifySessionToken(env, session))) {
    return new Response(JSON.stringify({ error: 'Session invalide ou expirée.' }), { status: 401, headers: CORS_HEADERS });
  }
  try {
    const list = await getAccessibleCRs(env);
    return new Response(JSON.stringify({ ok: true, crs: list }), { status: 200, headers: CORS_HEADERS });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: CORS_HEADERS });
  }
}

// ============================================================================
// Notifications Web Push (voir src/push.js). Les messages restent toujours génériques :
// jamais de nom, de code de suivi ni de détail d'un dossier.
// ============================================================================

function reponseJson(objet, code) {
  return new Response(JSON.stringify(objet), { status: code || 200, headers: Object.assign({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, CORS_HEADERS) });
}

// Lecture stricte d'une collection : une erreur d'accès à la base n'est jamais avalée en silence.
async function firestoreListStrict(env, collectionPath) {
  const token = await getGoogleAccessToken(env);
  let docs = [];
  let pageToken = '';
  do {
    const base = 'https://firestore.googleapis.com/v1/projects/' + FIREBASE_PROJECT_ID + '/databases/(default)/documents/' + collectionPath + '?pageSize=300';
    const resp = await fetch(base + (pageToken ? ('&pageToken=' + encodeURIComponent(pageToken)) : ''), { headers: { Authorization: 'Bearer ' + token } });
    if (!resp.ok) throw new Error('Firestore ' + resp.status);
    const data = await resp.json();
    if (data.documents) docs = docs.concat(data.documents.map(fsDecodeDoc));
    pageToken = data.nextPageToken || '';
  } while (pageToken);
  return docs;
}

// Lecture stricte d'un document : renvoie null seulement s'il n'existe pas, lève une erreur si la base refuse l'accès.
async function firestoreGetStrict(env, docPath) {
  const token = await getGoogleAccessToken(env);
  const resp = await fetch('https://firestore.googleapis.com/v1/projects/' + FIREBASE_PROJECT_ID + '/databases/(default)/documents/' + docPath, {
    headers: { Authorization: 'Bearer ' + token }
  });
  if (resp.status === 404) return null;
  if (!resp.ok) throw new Error('Firestore ' + resp.status);
  const data = await resp.json();
  return data.fields ? fsDecodeDoc(data) : null;
}

async function firestoreDeleteDoc(env, docPath) {
  const token = await getGoogleAccessToken(env);
  const resp = await fetch('https://firestore.googleapis.com/v1/projects/' + FIREBASE_PROJECT_ID + '/databases/(default)/documents/' + docPath, {
    method: 'DELETE', headers: { Authorization: 'Bearer ' + token }
  });
  if (!resp.ok && resp.status !== 404) throw new Error('Firestore ' + resp.status);
}

// Message lisible pour une erreur d'accès à la base (secret du compte de service absent, périmé ou incorrect).
function expliquerErreurBase(err) {
  const m = String((err && err.message) || err);
  if (/GOOGLE_SERVICE_ACCOUNT_KEY absent/.test(m)) return 'Le secret GOOGLE_SERVICE_ACCOUNT_KEY est absent de Cloudflare (Paramètres, Variables et secrets).';
  if (/Firestore (401|403)|invalid_grant|Erreur obtention token Google/.test(m)) return 'Accès à la base refusé : le secret GOOGLE_SERVICE_ACCOUNT_KEY de Cloudflare est périmé ou incorrect.';
  if (/JSON/.test(m) && /position|Unexpected|token/i.test(m)) return 'Le secret GOOGLE_SERVICE_ACCOUNT_KEY est illisible : recollez le fichier JSON du compte de service en entier.';
  return 'Erreur d\u2019accès à la base : ' + m.slice(0, 120);
}

// Clé publique à utiliser pour l'abonnement d'un appareil, ou raison pour laquelle elle est indisponible.
async function handleNotifCle(request, env) {
  if (request.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });
  const configuree = !!(nettoyer(env.VAPID_PUBLIC) || nettoyer(env.VAPID_PRIVATE));
  const erreur = configuree ? await verifierCles(env) : 'Les notifications ne sont pas encore configurées : un administrateur doit générer les clés dans Administration.';
  return reponseJson({ cle: erreur ? null : nettoyer(env.VAPID_PUBLIC), erreur: erreur });
}

// Envoie une notification de test à un appareil de la personne connectée (jamais à un autre).
async function handleNotifTest(request, env) {
  if (request.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });
  if (request.method !== 'POST') return reponseJson({ erreur: 'Méthode non autorisée' }, 405);
  let email;
  try {
    const auth = request.headers.get('Authorization') || '';
    const m = auth.match(/^Bearer (.+)$/);
    if (!m) return reponseJson({ erreur: 'Vous n\u2019êtes pas connecté : reconnectez-vous puis réessayez.' }, 401);
    email = await verifyFirebaseIdToken(m[1]);
  } catch (err) {
    return reponseJson({ erreur: 'Connexion non valide (' + err.message + ') : reconnectez-vous puis réessayez.' }, 401);
  }
  try {
    if (!env.GOOGLE_SERVICE_ACCOUNT_KEY) return reponseJson({ erreur: expliquerErreurBase(new Error('GOOGLE_SERVICE_ACCOUNT_KEY absent')) }, 503);
    const autorise = await firestoreGetStrict(env, 'authorized_emails/' + email);
    if (!autorise) return reponseJson({ erreur: 'Votre adresse n\u2019est pas autorisée dans l\u2019application.' }, 403);
    let corps = {};
    try { corps = await request.json(); } catch (e) { /* corps vide */ }
    const endpoint = String(corps.endpoint || '');
    if (!endpoint) return reponseJson({ erreur: 'Aucun appareil indiqué : activez d\u2019abord les notifications sur cet appareil.' }, 400);
    const abonnements = await firestoreListStrict(env, 'abonnements_push');
    const abonnement = abonnements.find(function (a) { return a.endpoint === endpoint && String(a.email || '').toLowerCase() === email; });
    if (!abonnement) return reponseJson({ erreur: 'Cet appareil n\u2019est pas enregistré pour votre adresse : désactivez puis réactivez les notifications.' }, 404);
    const resultat = await envoyer(env, abonnement, { titre: 'Notification de test', corps: 'Les notifications fonctionnent sur cet appareil.', url: 'notifications.html', tag: 'test' });
    if (resultat.code === 404 || resultat.code === 410) {
      try { await firestoreDeleteDoc(env, 'abonnements_push/' + abonnement.id); } catch (e) { console.error('Suppression abonnement périmé impossible : ' + e.message); }
    }
    const ok = resultat.code >= 200 && resultat.code < 300;
    return reponseJson({ ok: ok, erreur: ok ? null : (resultat.code === 0 ? resultat.detail : expliquerCode(resultat.code, resultat.detail)), code: resultat.code }, ok ? 200 : 502);
  } catch (err) {
    return reponseJson({ erreur: expliquerErreurBase(err) }, 503);
  }
}
