// Notifications Web Push (RFC 8291 « aes128gcm » + VAPID RFC 8292, signature ES256).
// Uniquement l'API Web Crypto du Worker : aucune dépendance externe.
// Variables : VAPID_PUBLIC (variable Cloudflare), VAPID_PRIVATE (secret Cloudflare),
// VAPID_SUBJECT (facultatif : « mailto:... » ou « https://... », sinon l'adresse du site de l'abonné).
// Les clés sont générées dans Administration, jamais écrites dans un fichier.

const enc = new TextEncoder();

export function b64uEncode(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64uDecode(texte) {
  let s = String(texte || '').replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Retire espaces, retours à la ligne et guillemets (copier-coller depuis un tableau de bord).
export function nettoyer(valeur) {
  return String(valeur == null ? '' : valeur).replace(/[\s"'`]+/g, '');
}

function decoderSur(texte, longueur, nomCle) {
  let octets;
  try { octets = b64uDecode(texte); } catch (e) {
    throw new Error(nomCle + ' contient des caractères invalides (valeur à copier telle quelle, sans modification)');
  }
  if (octets.length !== longueur) {
    const cause = octets.length < longueur ? 'tronquée' : 'trop longue';
    throw new Error(nomCle + ' ' + cause + ' (' + octets.length + ' octets reçus, ' + longueur + ' attendus) : recopiez-la en entier');
  }
  return octets;
}

async function importerPrivee(pubOctets, privOctets) {
  return crypto.subtle.importKey('jwk', {
    kty: 'EC', crv: 'P-256', ext: true,
    x: b64uEncode(pubOctets.slice(1, 33)),
    y: b64uEncode(pubOctets.slice(33, 65)),
    d: b64uEncode(privOctets)
  }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
}

// Retourne null si tout va bien, sinon un message en français expliquant le problème.
export async function verifierCles(env) {
  const pub = nettoyer(env.VAPID_PUBLIC);
  const priv = nettoyer(env.VAPID_PRIVATE);
  if (!pub && !priv) return 'Clés de notification absentes : générez-les dans Administration, puis enregistrez VAPID_PUBLIC (variable) et VAPID_PRIVATE (secret) dans Cloudflare';
  if (!pub) return 'Clé publique absente : la variable VAPID_PUBLIC n’existe pas dans Cloudflare';
  if (!priv) return 'Clé privée absente : le secret VAPID_PRIVATE n’existe pas dans Cloudflare';
  try {
    const pubOctets = decoderSur(pub, 65, 'La clé publique VAPID_PUBLIC');
    if (pubOctets[0] !== 4) return 'Clé publique invalide : elle ne commence pas comme une clé P-256 (vérifiez que vous avez copié la bonne valeur)';
    const privOctets = decoderSur(priv, 32, 'La clé privée VAPID_PRIVATE');
    let cle;
    try { cle = await importerPrivee(pubOctets, privOctets); }
    catch (e) { return 'Paire de clés incohérente : la clé publique et la clé privée ne vont pas ensemble (régénérez les deux clés en même temps)'; }
    const message = enc.encode('verification');
    const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, cle, message);
    const clePublique = await crypto.subtle.importKey('raw', pubOctets, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    const bonne = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, clePublique, signature, message);
    if (!bonne) return 'Paire de clés incohérente : la clé publique et la clé privée ne vont pas ensemble (régénérez les deux clés en même temps)';
  } catch (e) {
    return e.message;
  }
  return null;
}

// Le jeton VAPID est valable 12 h et identique pour tous les appareils d'un même service de notification
// (Google, Mozilla, Apple) : on le signe une fois puis on le réutilise, ce qui économise du temps de calcul.
const jetonsEnMemoire = new Map();

// En-tête d'autorisation VAPID pour un service de notification donné (adresse de l'abonnement).
export async function jetonVapid(env, endpoint, sujet, maintenant) {
  const pub = nettoyer(env.VAPID_PUBLIC);
  const horloge = maintenant || Math.floor(Date.now() / 1000);
  const cleCache = new URL(endpoint).origin + '|' + sujet + '|' + pub;
  const memorise = jetonsEnMemoire.get(cleCache);
  if (memorise && memorise.exp - horloge > 3600) return memorise.valeur;
  const pubOctets = b64uDecode(pub);
  const cle = await importerPrivee(pubOctets, b64uDecode(nettoyer(env.VAPID_PRIVATE)));
  const entete = b64uEncode(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const corps = b64uEncode(enc.encode(JSON.stringify({
    aud: new URL(endpoint).origin,
    exp: horloge + 12 * 3600,
    sub: sujet
  })));
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, cle, enc.encode(entete + '.' + corps));
  const valeur = 'vapid t=' + entete + '.' + corps + '.' + b64uEncode(new Uint8Array(signature)) + ', k=' + pub;
  jetonsEnMemoire.set(cleCache, { valeur: valeur, exp: horloge + 12 * 3600 });
  return valeur;
}

async function hkdf(sel, secret, info, longueur) {
  const base = await crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: sel, info: info }, base, longueur * 8);
  return new Uint8Array(bits);
}

function concat() {
  let total = 0;
  for (const a of arguments) total += a.length;
  const out = new Uint8Array(total);
  let pos = 0;
  for (const a of arguments) { out.set(a, pos); pos += a.length; }
  return out;
}

// Chiffre le message pour l'appareil (RFC 8291). « options » ne sert qu'aux tests (clé éphémère et sel imposés).
export async function chiffrer(abonnement, texte, options) {
  const opts = options || {};
  const uaPublique = decoderSur(abonnement.p256dh, 65, 'La clé p256dh de l’abonnement');
  const secretAuth = decoderSur(abonnement.auth, 16, 'Le secret auth de l’abonnement');
  const paire = opts.paire || await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublique = new Uint8Array(await crypto.subtle.exportKey('raw', paire.publicKey));
  const clePublique = await crypto.subtle.importKey('raw', uaPublique, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const partage = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: clePublique }, paire.privateKey, 256));
  const ikm = await hkdf(secretAuth, partage, concat(enc.encode('WebPush: info\0'), uaPublique, asPublique), 32);
  const sel = opts.sel || crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(sel, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(sel, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const clair = concat(enc.encode(texte), new Uint8Array([2]));
  const cleAes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const chiffre = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, cleAes, clair));
  const tailleBloc = new Uint8Array([0, 0, 16, 0]); // 4096
  return concat(sel, tailleBloc, new Uint8Array([asPublique.length]), asPublique, chiffre);
}

// Envoie une notification à un appareil. Retourne { code, detail } ; code 0 = échec avant l'envoi.
// abonnement : { endpoint, p256dh, auth, origine } ; message : objet { titre, corps, url, tag }.
export async function envoyer(env, abonnement, message) {
  const erreur = await verifierCles(env);
  if (erreur) return { code: 0, detail: erreur };
  let sujet = nettoyer(env.VAPID_SUBJECT);
  if (!sujet) sujet = abonnement.origine && /^https:\/\//.test(abonnement.origine) ? abonnement.origine : '';
  if (!sujet) return { code: 0, detail: 'Contact VAPID absent : ajoutez la variable VAPID_SUBJECT (mailto:adresse ou https://adresse-du-site) dans Cloudflare' };
  let corps;
  let autorisation;
  try {
    corps = await chiffrer(abonnement, JSON.stringify(message));
    autorisation = await jetonVapid(env, abonnement.endpoint, sujet);
  } catch (e) {
    return { code: 0, detail: 'Préparation du message impossible : ' + String(e.message || e).slice(0, 160) };
  }
  try {
    const reponse = await fetch(abonnement.endpoint, {
      method: 'POST',
      headers: {
        Authorization: autorisation,
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: '86400',
        Urgency: 'normal'
      },
      body: corps
    });
    let detail = '';
    if (!reponse.ok) { try { detail = (await reponse.text()).slice(0, 200); } catch (e) { /* sans importance */ } }
    return { code: reponse.status, detail: detail };
  } catch (e) {
    return { code: 0, detail: 'Service de notification injoignable : ' + String(e.message || e).slice(0, 120) };
  }
}

// Traduit le code de retour du service de notification en phrase claire.
export function expliquerCode(code, detail) {
  if (code >= 200 && code < 300) return 'Notification envoyée.';
  if (code === 404 || code === 410) return 'Cet appareil n’est plus abonné (abonnement expiré ou supprimé) : réactivez les notifications.';
  if (code === 400 || code === 401 || code === 403) return 'Le service de notification a refusé l’envoi (code ' + code + '). Les clés VAPID ont probablement changé depuis l’activation de cet appareil : désactivez puis réactivez les notifications.' + (detail ? ' Détail : ' + detail : '');
  if (code === 413) return 'Message trop volumineux pour le service de notification.';
  if (code === 429) return 'Trop d’envois : le service de notification demande de patienter, réessayez dans quelques minutes.';
  if (code >= 500) return 'Le service de notification est indisponible (code ' + code + ') : réessayez plus tard.';
  return detail || 'Échec de l’envoi (code ' + code + ').';
}
