export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/signalement-collaborateur') {
      return handleCollaborateurSubmission(request, env, ctx);
    }

    return env.ASSETS.fetch(request);
  }
};

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

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

    const collabBody =
`Bonjour,

Vous venez de réaliser une demande de suivi auprès du CSSCT. Merci pour votre message. Nous allons étudier votre demande qui porte le numéro "${numero}" qu'il faudra systématiquement intégrer dans nos échanges.

Si des photos doivent être transmises, vous pouvez les envoyer en réponse à ce mail.

Nous vous souhaitons une bonne journée.`;

    const cssctBody =
`Bonjour,

Un nouveau signalement a été réalisé par ${rapporteur} sur le site de ${site} et concerne un ${nature} : ${objet}
Le suivi se fera sous le numéro ${numero}


Ce message a été envoyé automatiquement de l'application CSSCT.`;

    const fromEmail = env.MAILJET_FROM_EMAIL;
    const fromName = env.MAILJET_FROM_NAME || 'CSSCT';
    const cssctEmails = ('choudayer@smag.tech' || '').split(',').map(function(e){ return e.trim(); }).filter(Boolean);

    const messages = [
      {
        From: { Email: fromEmail, Name: fromName },
        To: [{ Email: rapporteurEmail }],
        Subject: `Confirmation de votre signalement CSSCT - ${numero}`,
        TextPart: collabBody
      }
    ];

    if (cssctEmails.length) {
      messages.push({
        From: { Email: fromEmail, Name: fromName },
        To: cssctEmails.map(function(e){ return { Email: e }; }),
        Subject: `Formulaire CSSCT - ${nature} - ${numero}`,
        TextPart: cssctBody,
        Headers: { 'X-Priority': '1', 'Importance': 'High' }
      });
    }

    const mjAuth = btoa(env.MAILJET_API_KEY + ':' + env.MAILJET_API_SECRET);
    const mjResp = await fetch('https://api.mailjet.com/v3.1/send', {
      method: 'POST',
      headers: { 'Authorization': 'Basic ' + mjAuth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ Messages: messages })
    });

    if (!mjResp.ok) {
      const errText = await mjResp.text();
      return new Response(JSON.stringify({ error: 'Erreur envoi email', detail: errText }), { status: 502, headers: CORS_HEADERS });
    }

if (env.NTFY_TOPIC) {
  ctx.waitUntil(fetch('https://ntfy.sh/' + env.NTFY_TOPIC, {
    method: 'POST',
    headers: { 'Title': 'Nouveau signalement ' + numero },
    body: rapporteur + ' - ' + site + ' - ' + nature + ' : ' + objet
  }));
}
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: CORS_HEADERS });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: CORS_HEADERS });
  }
}
