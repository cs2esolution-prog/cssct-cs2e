/*
 * signalement_edition.js — chargé à la fin de signalement_liste.html (après le script principal).
 * Rend toutes les rubriques d'un dossier de signalement modifiables par les élus connectés.
 *
 * Ce fichier remplace les fonctions du même nom définies dans signalement_liste.html :
 *   fieldBlock, sectionCard, toggleEdit, saveSection, renderEchanges
 * et ajoute : editEchangeEntry, saveEchangeEntry, deleteEchangeEntry.
 *
 * Correctif principal : la rubrique "Contexte" ne passait pas en modification car le numéro
 * de dossier est enregistré comme un nombre (et non un texte) — l'ancien code plantait dessus.
 */

function escapeHtml(s){
  return (s === undefined || s === null ? '' : String(s)).replace(/[&<>"']/g, function(c){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
  });
}

const EDIT_LONG_FIELDS = ['description','impactCorporel','impactPsychologique','risque','actionRealisee','actionEnvisagee','infoCloture'];
const EDIT_FIELD_TYPES = {
  numero:'number', date:'date', dateCloture:'date', heureDebut:'time', heureFin:'time',
  natureIncident:'nature', site:'site', incidentOrigineLie:'dossier'
};

// Champs déjà enregistrés sur les dossiers mais jusqu'ici absents de la fiche : on les ajoute
// à la rubrique correspondante pour qu'ils soient visibles et modifiables.
const EDIT_EXTRA_FIELDS = {
  1: [
    { id:'heureDebut', label:'Heure debut' },
    { id:'heureFin', label:'Heure fin' },
    { id:'incidentOrigineLie', label:'Incident de reference (si suivi)' }
  ],
  4: [
    { id:'dateCloture', label:'Clos le' },
    { id:'infoCloture', label:'Info si cloture' }
  ]
};

function fieldBlock(id, label, value){
  const has = value !== undefined && value !== null && value !== '';
  return '<div class="dfield" data-field="' + id + '"><div class="dlabel">' + escapeHtml(label) + '</div>' +
    '<div class="dval ' + (has ? '' : 'empty') + '">' + (has ? escapeHtml(value) : 'Non renseigne') + '</div></div>';
}

function sectionCard(title, num, dossierId, fields){
  const d = findDossier(dossierId) || {};
  const extra = (EDIT_EXTRA_FIELDS[num] || [])
    .filter(function(f){ return !fields.some(function(x){ return x.id === f.id; }); })
    .map(function(f){ return { id:f.id, label:f.label, value:d[f.id] }; });
  const rows = fields.concat(extra).map(function(f){ return fieldBlock(f.id, f.label, f.value); }).join('');
  return '<div class="dsection" data-section="' + num + '"><h3>' + title +
    ' <button class="edit-link" onclick="toggleEdit(\'' + dossierId + '\', ' + num + ')">Modifier</button></h3>' +
    '<div class="section-view">' + rows + '</div></div>';
}

function editInputHtml(d, id, value){
  const v = (value === undefined || value === null) ? '' : String(value);
  const type = EDIT_FIELD_TYPES[id];

  if(EDIT_LONG_FIELDS.indexOf(id) !== -1){
    return '<textarea data-edit="' + id + '">' + escapeHtml(v) + '</textarea>';
  }
  if(type === 'nature'){
    const opts = Object.keys(NATURE_COLORS);
    if(v && opts.indexOf(v) === -1) opts.push(v);
    return '<select data-edit="' + id + '"><option value="">—</option>' +
      opts.map(function(o){ return '<option value="' + escapeHtml(o) + '"' + (o === v ? ' selected' : '') + '>' + escapeHtml(o) + '</option>'; }).join('') +
      '</select>';
  }
  if(type === 'site'){
    const sites = uniqueSorted(dossiers.map(function(x){ return x.site; }));
    return '<input type="text" list="editSitesList" data-edit="' + id + '" value="' + escapeHtml(v) + '">' +
      '<datalist id="editSitesList">' + sites.map(function(s){ return '<option value="' + escapeHtml(s) + '">'; }).join('') + '</datalist>';
  }
  if(type === 'dossier'){
    const opts = dossiers
      .filter(function(x){ return x.id !== d.id && !isBadNumero(x.numero); })
      .sort(function(a,b){ return (parseInt(b.numero,10) || 0) - (parseInt(a.numero,10) || 0); });
    let html = '<select data-edit="' + id + '"><option value="">Aucun</option>';
    if(v && !opts.some(function(x){ return String(x.numero) === v; })){
      html += '<option value="' + escapeHtml(v) + '" selected>N° ' + escapeHtml(v) + '</option>';
    }
    html += opts.map(function(x){
      const n = String(x.numero);
      return '<option value="' + escapeHtml(n) + '"' + (n === v ? ' selected' : '') + '>N° ' + escapeHtml(n) + ' - ' + escapeHtml(x.objet || '') + '</option>';
    }).join('');
    return html + '</select>';
  }
  // Un champ date/heure n'utilise le sélecteur natif que si la valeur existante est au bon format,
  // sinon le navigateur l'afficherait vide et l'enregistrement l'effacerait.
  if(type === 'date' && (v === '' || /^\d{4}-\d{2}-\d{2}$/.test(v))){
    return '<input type="date" data-edit="' + id + '" value="' + escapeHtml(v) + '">';
  }
  if(type === 'time' && (v === '' || /^\d{2}:\d{2}$/.test(v))){
    return '<input type="time" data-edit="' + id + '" value="' + escapeHtml(v) + '">';
  }
  if(type === 'number'){
    return '<input type="text" inputmode="numeric" data-edit="' + id + '" value="' + escapeHtml(v) + '">';
  }
  return '<input type="text" data-edit="' + id + '" value="' + escapeHtml(v) + '">';
}

function toggleEdit(dossierId, sectionNum){
  const d = findDossier(dossierId);
  if(!d) return;
  const sec = document.querySelector('.dsection[data-section="' + sectionNum + '"]');
  if(!sec || sec.classList.contains('editing')) return;
  const view = sec.querySelector('.section-view');
  view.querySelectorAll('.dfield').forEach(function(f){
    const id = f.dataset.field;
    const label = f.querySelector('.dlabel').textContent;
    f.innerHTML = '<div class="dlabel">' + escapeHtml(label) + '</div>' + editInputHtml(d, id, d[id]);
  });
  view.insertAdjacentHTML('afterend',
    '<div class="edit-actions" data-actions="' + sectionNum + '">' +
      '<button class="save-btn" onclick="saveSection(\'' + dossierId + '\', ' + sectionNum + ')">Enregistrer</button>' +
      '<button class="cancel-btn" onclick="openDrawer(\'' + dossierId + '\')">Annuler</button>' +
    '</div>');
  sec.classList.add('editing');
}

function saveSection(dossierId, sectionNum){
  const d = findDossier(dossierId);
  if(!d) return;
  const sec = document.querySelector('.dsection[data-section="' + sectionNum + '"]');
  const fields = {};
  sec.querySelectorAll('[data-edit]').forEach(function(el){ fields[el.dataset.edit] = el.value; });

  if(Object.prototype.hasOwnProperty.call(fields, 'numero')){
    const raw = String(fields.numero).trim();
    if(raw === ''){ showToast('Le numero de dossier ne peut pas etre vide.'); return; }
    fields.numero = /^\d+$/.test(raw) ? Number(raw) : raw;
    const doublon = dossiers.find(function(x){ return x.id !== d.id && String(x.numero) === String(fields.numero); });
    if(doublon){ showToast('Le numero ' + raw + ' est deja utilise par un autre dossier.'); return; }
  }

  Object.assign(d, fields); // mise à jour locale immédiate
  window.CSSCT_FIREBASE.updateFields(d.id, fields).then(function(){
    showToast('Rubrique mise a jour');
  }).catch(function(err){
    showToast('Erreur : ' + err.message);
  });
  populateFilters();
  openDrawer(dossierId);
  render();
}

// ---- Retours au collaborateur : chaque entrée devient modifiable / supprimable ----
function renderEchanges(d){
  const arr = (d.echanges || [])
    .map(function(h, idx){ return { h:h, idx:idx }; })
    .sort(function(a,b){ return (a.h.date || '').localeCompare(b.h.date || ''); });
  if(!arr.length) return '<div style="font-size:12px;color:var(--ink-soft);">Aucun échange avec le salarié pour l\'instant.</div>';
  return arr.map(function(item){
    const h = item.h;
    const tag = h.auteur === 'salarie' ? '<span class="h-tag">Salarié</span>' : '<span class="h-tag cssct">CSSCT</span>';
    return '<div class="histo-item" data-echange-idx="' + item.idx + '">' +
      '<div class="h-date">' + toFR(h.date) + tag + '</div>' +
      '<div style="white-space:pre-wrap;">' + escapeHtml(h.text) + '</div>' +
      '<div style="margin-top:4px;display:flex;gap:12px;">' +
        '<button type="button" class="edit-link" onclick="editEchangeEntry(\'' + d.id + '\', ' + item.idx + ')">Modifier</button>' +
        '<button type="button" class="edit-link" style="color:var(--danger);" onclick="deleteEchangeEntry(\'' + d.id + '\', ' + item.idx + ')">Supprimer</button>' +
      '</div>' +
    '</div>';
  }).join('');
}

function editEchangeEntry(dossierId, idx){
  const d = findDossier(dossierId);
  if(!d || !d.echanges || !d.echanges[idx]) return;
  const entry = d.echanges[idx];
  const wrap = document.querySelector('[data-echange-idx="' + idx + '"]');
  if(!wrap) return;
  wrap.innerHTML =
    '<input type="date" id="editEchangeDate" value="' + escapeHtml(entry.date) + '" style="width:100%;margin-bottom:6px;padding:8px 10px;border:1px solid var(--line);border-radius:7px;">' +
    '<textarea id="editEchangeText" style="width:100%;min-height:60px;padding:8px 10px;border:1px solid var(--line);border-radius:7px;font-family:Inter,sans-serif;font-size:13px;">' + escapeHtml(entry.text) + '</textarea>' +
    '<div class="edit-actions">' +
      '<button class="save-btn" onclick="saveEchangeEntry(\'' + dossierId + '\', ' + idx + ')">Enregistrer</button>' +
      '<button class="cancel-btn" onclick="openDrawer(\'' + dossierId + '\')">Annuler</button>' +
    '</div>';
}

function saveEchangeEntry(dossierId, idx){
  const d = findDossier(dossierId);
  if(!d) return;
  const newText = document.getElementById('editEchangeText').value.trim();
  const newDate = document.getElementById('editEchangeDate').value;
  if(!newText){ showToast('Le texte ne peut pas etre vide.'); return; }
  const newArr = (d.echanges || []).slice();
  newArr[idx] = Object.assign({}, newArr[idx], { date:newDate, text:newText });
  d.echanges = newArr;
  window.CSSCT_FIREBASE.updateFields(d.id, { echanges:newArr }).then(function(){
    showToast('Retour modifie (visible par le salarie)');
  }).catch(function(err){ showToast('Erreur : ' + err.message); });
  openDrawer(dossierId);
}

function deleteEchangeEntry(dossierId, idx){
  if(!confirm('Supprimer ce retour ? Il ne sera plus visible par le salarie.')) return;
  const d = findDossier(dossierId);
  if(!d) return;
  const newArr = (d.echanges || []).slice();
  newArr.splice(idx, 1);
  d.echanges = newArr;
  window.CSSCT_FIREBASE.updateFields(d.id, { echanges:newArr }).then(function(){
    showToast('Retour supprime');
  }).catch(function(err){ showToast('Erreur : ' + err.message); });
  openDrawer(dossierId);
}

// Quand un autre élu enregistre une modification, la liste se met à jour en direct.
// On évite alors de redessiner la fiche ouverte si une saisie est en cours (elle serait perdue).
(function(){
  const original = window.onDossiersUpdated;
  window.onDossiersUpdated = function(){
    const saisieEnCours = document.querySelector('#drawer .dsection.editing, #drawer #editEchangeText, #drawer #editSuiviText');
    if(saisieEnCours){
      dossiers = window.dossiers || [];
      populateFilters();
      render();
      return;
    }
    if(typeof original === 'function') original();
  };
})();
