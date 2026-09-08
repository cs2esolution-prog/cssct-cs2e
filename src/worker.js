export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/signalement-collaborateur') {
      return handleCollaborateurSubmission(request, env, ctx);
    }
    if (url.pathname === '/api/expression-besoin') {
      return handleBesoinSubmission(request, env, ctx);
    }
    if (url.pathname === '/api/ajout-complement') {
      return handleComplementSubmission(request, env, ctx);
    }
    if (url.pathname === '/api/cr-file-upload') {
      return handleCrFileUpload(request, env, ctx);
    }
    if (url.pathname === '/api/cr-file') {
      return handleCrFileGet(request, env, ctx);
    }
    if (url.pathname === '/api/cr-password-check') {
      return handleCrPasswordCheck(request, env, ctx);
    }
    if (url.pathname === '/api/cr-liste-publique') {
      return handleCrListePublique(request, env, ctx);
    }

    return env.ASSETS.fetch(request);
  }
};

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};

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
    const tConfirm = pickTemplate(data.templates, 'signalementConfirmation');
    const tNotif = pickTemplate(data.templates, 'signalementNotifCSSCT');
    const collabSubject = fillTemplate(tConfirm.subject, vars);
    const collabBody = fillTemplate(tConfirm.body, vars);
    const cssctSubject = fillTemplate(tNotif.subject, vars);
    const cssctBody = fillTemplate(tNotif.body, vars);

    const fromEmail = env.MAILJET_FROM_EMAIL || 'cs2esolution@gmail.com';
    const fromName = env.MAILJET_FROM_NAME || 'CSSCT';
    const cssctEmails = resolveDestinataires(data.destinataires);

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

    await sendNtfy(env, 'Nouveau signalement ' + numero, rapporteur + ' - ' + site + ' - ' + nature + ' : ' + objet);

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
    const cssctEmails = resolveDestinataires(data.destinataires);

    const auteurLabel = nomPrenom || 'anonyme';
    const entrepriseLabel = entreprise ? (', ' + entreprise) : '';
    const vars = { codeSuivi, theme, description, auteurLabel, entrepriseLabel };

    const messages = [];

    if (emailContact) {
      const tConfirm = pickTemplate(data.templates, 'besoinConfirmation');
      messages.push({
        From: { Email: fromEmail, Name: fromName },
        To: [{ Email: emailContact }],
        Subject: fillTemplate(tConfirm.subject, vars),
        TextPart: fillTemplate(tConfirm.body, vars)
      });
    }

    if (cssctEmails.length) {
      const tNotif = pickTemplate(data.templates, 'besoinNotifCSSCT');
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

    await sendNtfy(env, 'Nouvelle expression de besoin', (nomPrenom || 'Anonyme') + ' - ' + theme + ' : ' + description);

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
    const cssctEmails = resolveDestinataires(data.destinataires);

    const label = kind === 'signalement'
      ? ('dossier de signalement' + (numero ? ' n°' + numero : '') + ' (' + code + ')')
      : ('expression de besoin (' + code + ')');

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

    await sendNtfy(env, 'Complément ajouté - ' + code, label + ' : ' + text);

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

async function handleCrPasswordCheck(request, env, ctx) {
  if (request.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });
  if (request.method !== 'POST') return new Response(JSON.stringify({ error: 'Methode non autorisee' }), { status: 405, headers: CORS_HEADERS });
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
