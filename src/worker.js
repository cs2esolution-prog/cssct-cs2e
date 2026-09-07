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

    return env.ASSETS.fetch(request);
  }
};

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

const DEFAULT_CSSCT_EMAILS = ['choudayer@smag.tech'];

// Modèles par défaut, utilisés tant que config/email_templates (éditable depuis Administration
// > Dossiers de signalement / Expression de besoin > Modèles d'email) n'a pas été personnalisé
// pour le champ correspondant. Le client transmet le contenu de ce document dans `data.templates`.
const DEFAULT_TEMPLATES = {
  signalementConfirmation: {
    subject: 'Confirmation de votre signalement CSSCT - {{numero}}',
    body: 'Bonjour,\n\nVous venez de réaliser une demande de suivi auprès du CSSCT. Merci pour votre message. Nous allons étudier votre demande qui porte le numéro "{{numero}}" qu\'il faudra systématiquement intégrer dans nos échanges.\n\nSi des photos doivent être transmises, vous pouvez les envoyer en réponse à ce mail.\n\nNous vous souhaitons une bonne journée.'
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
    const rapporteur = data.rapporteur || '';
    const rapporteurEmail = data.rapporteurEmail || '';
    const site = data.site || '';
    const nature = data.nature || '';
    const objet = data.objet || '';

    if (!numero || !rapporteurEmail || !objet) {
      return new Response(JSON.stringify({ error: 'Champs obligatoires manquants' }), { status: 400, headers: CORS_HEADERS });
    }

    const vars = { numero, rapporteur, site, nature, objet };
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
