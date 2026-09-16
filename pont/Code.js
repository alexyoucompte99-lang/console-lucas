// Pont « Console Lucas » : les leads de Lucas Fabre (Leads and Business) dans un Google Sheet,
// lus et écrits en direct par la page https://alexyoucompte99-lang.github.io/console-lucas/
//
// La clé KEY est aussi dans index.html (page publique) : elle évite juste les appels accidentels.
// L'id du Sheet des leads est posé dans les ScriptProperties par what=setup, jamais dans ce code.
//
// doGet  ?key=…&what=setup      crée le Sheet « Console Lucas · leads » si besoin (à ouvrir une fois dans Chrome pour l'OAuth)
// doGet  ?key=…&what=all        -> { ok, leads:[…] }
// doGet  ?key=…&what=inscrits   -> { ok, inscrits:[…] }  (lecture du Sheet des inscriptions au live)
// doPost { key, what, … } :
//   setup      {}                        idem GET
//   all        {}                        tous les leads
//   upsert     { lead:{ id?, … } }       crée (sans id) ou met à jour (avec id) un lead, renvoie { ok, id }
//   delete     { id }                    supprime la ligne
//   inscrits   {}                        inscrits au live

// À exécuter une fois dans l'éditeur pour accorder les autorisations (Sheets)
function autoriser() {
  const ss = book();
  tab(ss, LEADS_TAB, LEADS_HDR);
  SpreadsheetApp.openById(INSCRITS_ID).getName();
  Logger.log('OK ' + ss.getUrl());
}

const KEY = 'lucas-759dc1a01a28ae1d91ac25c8';
const P = PropertiesService.getScriptProperties();
const TZ = 'Europe/Paris';
const SHEET_NAME = 'Console Lucas · leads';
const LEADS_TAB = 'Leads';
const LEADS_HDR = ['ID', 'Créé le', 'MAJ', 'Prénom nom', 'Téléphone', 'E-mail', 'Source', 'Date du call', 'Statut', 'Qualifié /10', 'Besoin / situation', 'Objection', 'Action suivante', 'Date de relance', 'Prix proposé', 'Encaissé', 'Vendu le', 'Notes', 'iClosed contact', 'iClosed statut auto', 'iClosed infos', 'Lien visio', 'Type de call'];
const LEADS_KEYS = ['id', 'created', 'updated', 'name', 'phone', 'email', 'source', 'call_at', 'status', 'score', 'need', 'objection', 'next_action', 'next_at', 'price', 'paid', 'sold_at', 'notes', 'ic_contact', 'ic_status', 'ic_info', 'ic_link', 'ic_event'];

// Sheet des inscriptions au live (rempli par le webhook de la LP live-leads-and-business)
const INSCRITS_ID = '1G-v7_Ow_jLJtu1lVMRCpsPdecrBVTBabMA71lqVPA-8';
const INSCRITS_TAB = 'Inscriptions';
const INSCRITS_FIRST_ROW = 3; // ligne 1 = en-têtes, ligne 2 = case d'envoi du webhook
// En-têtes du Sheet -> clés renvoyées à la console
const INSCRITS_MAP = {
  'Mail': 'statut', 'Suivi': 'crm', 'Date': 'horodateur', 'Session': 'session', 'Prénom': 'prenom', 'E-mail': 'email',
  'Téléphone': 'tel', 'Mode': 'mode', 'Dernière étape': 'etape', 'Profil': 'profil', 'Son business': 'business',
  'Blocage n°1': 'blocage1', 'Blocage n°2': 'blocage2', 'Blocage n°3': 'blocage3', 'Objectif': 'objectif',
  'CA mensuel': 'ca', 'OK coaching en direct': 'accord', "Droit à l'image": 'droits', 'Source': 'source',
};

function doGet(e) {
  const q = (e && e.parameter) || {};
  if (q.key !== KEY) return out({ ok: true, pong: true, v: 1 });
  try { return out(route(q)); } catch (err) { return out({ ok: false, error: String(err && err.message || err) }); }
}

function doPost(e) {
  let p = {};
  try { p = JSON.parse(e.postData.contents); } catch (err) { return out({ ok: false, error: 'bad json' }); }
  if (p.key !== KEY) return out({ ok: false, error: 'bad key' });
  try { return out(route(p)); } catch (err) { return out({ ok: false, error: String(err && err.message || err) }); }
}

function route(p) {
  if (p.what === 'setup') return setup();
  if (p.what === 'all') return all();
  if (p.what === 'upsert') return upsert(p);
  if (p.what === 'delete') return remove(p);
  if (p.what === 'inscrits') return inscrits();
  if (p.what === 'sync') { try { return icSync(p.force === '1' || p.force === true); } catch (e) { return { ok: false, error: String(e) }; } }
  if (p.what === 'ic_setkey') return icSetKey(p);
  if (!p.what) return { ok: true, pong: true, v: 1 };
  return { ok: false, error: 'unknown what' };
}

// ---------- setup ----------
function setup() {
  const ss = book();
  tab(ss, LEADS_TAB, LEADS_HDR);
  const def = ss.getSheetByName('Feuille 1') || ss.getSheetByName('Sheet1');
  if (def && ss.getSheets().length > 1) ss.deleteSheet(def);
  let inscritsOk = false;
  try { SpreadsheetApp.openById(INSCRITS_ID).getName(); inscritsOk = true; } catch (e) { /* pas d'accès */ }
  return { ok: true, sheet_url: ss.getUrl(), sheet_id: ss.getId(), inscrits: inscritsOk };
}

function book() {
  const id = P.getProperty('SHEET_ID');
  if (id) { try { return SpreadsheetApp.openById(id); } catch (e) { /* recréé ci-dessous */ } }
  const ss = SpreadsheetApp.create(SHEET_NAME);
  P.setProperty('SHEET_ID', ss.getId());
  return ss;
}

function tab(ss, name, hdr) {
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, hdr.length).setValues([hdr]).setFontWeight('bold').setBackground('#a6ff4d').setFontColor('#060a04');
    sh.setFrozenRows(1);
    sh.setColumnWidth(LEADS_KEYS.indexOf('need') + 1, 280);
    sh.setColumnWidth(LEADS_KEYS.indexOf('notes') + 1, 320);
  } else if (sh.getLastColumn() < hdr.length) {
    sh.getRange(1, 1, 1, hdr.length).setValues([hdr]).setFontWeight('bold');
  }
  return sh;
}

// ---------- lecture ----------
function stamp() { return Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd'T'HH:mm:ss"); }

function cell(x) {
  if (x instanceof Date) return Utilities.formatDate(x, TZ, "yyyy-MM-dd'T'HH:mm:ss");
  return x;
}

function rows(sh, keys) {
  const last = sh.getLastRow();
  if (last < 2) return [];
  const v = sh.getRange(2, 1, last - 1, keys.length).getValues();
  return v.filter(r => r[0] !== '').map(r => {
    const o = {};
    keys.forEach((k, i) => { o[k] = cell(r[i]); });
    return o;
  });
}

function all() {
  const sh = tab(book(), LEADS_TAB, LEADS_HDR);
  return { ok: true, now: stamp(), leads: rows(sh, LEADS_KEYS), ic_sync: P.getProperty('IC_LAST') || '', ic_due: Date.now() - Number(P.getProperty('IC_LAST_MS') || 0) > IC_EVERY_MS && !!P.getProperty('ICLOSED_KEY') };
}

function findRow(sh, id) {
  const last = sh.getLastRow();
  if (last < 2) return 0;
  const ids = sh.getRange(2, 1, last - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) if (String(ids[i][0]) === String(id)) return i + 2;
  return 0;
}

// ---------- écriture ----------
function clean(k, v) {
  if (v === null || v === undefined) return '';
  if (k === 'score' || k === 'price' || k === 'paid') { const n = Number(v); return isNaN(n) || v === '' ? '' : n; }
  return String(v);
}

function upsert(p) {
  const lead = p.lead || {};
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = tab(book(), LEADS_TAB, LEADS_HDR);
    const now = stamp();
    let r = lead.id ? findRow(sh, lead.id) : 0;
    if (r) {
      // mise à jour : seules les clés envoyées sont écrites, jamais id ni created
      LEADS_KEYS.forEach((k, i) => {
        if (k === 'id' || k === 'created' || k === 'updated') return;
        if (!Object.prototype.hasOwnProperty.call(lead, k)) return;
        sh.getRange(r, i + 1).setNumberFormat('@').setValue(clean(k, lead[k]));
      });
      sh.getRange(r, LEADS_KEYS.indexOf('updated') + 1).setNumberFormat('@').setValue(now);
      return { ok: true, id: String(lead.id), updated: now };
    }
    const id = lead.id ? String(lead.id) : 'l' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const row = LEADS_KEYS.map(k => {
      if (k === 'id') return id;
      if (k === 'created') return lead.created ? String(lead.created) : now;
      if (k === 'updated') return now;
      return clean(k, lead[k]);
    });
    sh.appendRow(row);
    sh.getRange(sh.getLastRow(), 1, 1, row.length).setNumberFormat('@');
    return { ok: true, id, created: row[1], updated: now };
  } finally {
    lock.releaseLock();
  }
}

function remove(p) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = tab(book(), LEADS_TAB, LEADS_HDR);
    const r = findRow(sh, p.id);
    if (!r) return { ok: false, error: 'lead introuvable' };
    sh.deleteRow(r);
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

// ---------- inscrits au live ----------
function inscrits() {
  const ss = SpreadsheetApp.openById(INSCRITS_ID);
  const sh = ss.getSheetByName(INSCRITS_TAB);
  if (!sh) return { ok: true, inscrits: [] };
  const last = sh.getLastRow(), lastCol = sh.getLastColumn();
  if (last < INSCRITS_FIRST_ROW || !lastCol) return { ok: true, inscrits: [] };
  const hdr = sh.getRange(1, 1, 1, lastCol).getDisplayValues()[0].map(h => String(h).trim());
  const keys = hdr.map(h => INSCRITS_MAP[h] || (h ? h.toLowerCase().replace(/[^a-z0-9]+/g, '_') : ''));
  const v = sh.getRange(INSCRITS_FIRST_ROW, 1, last - INSCRITS_FIRST_ROW + 1, lastCol).getDisplayValues();
  const list = [];
  v.forEach((r, i) => {
    const o = { row: INSCRITS_FIRST_ROW + i };
    keys.forEach((k, j) => { if (k) o[k] = String(r[j] || '').trim(); });
    if (o.email || o.prenom) list.push(o);
  });
  list.reverse(); // les plus récents en premier
  return { ok: true, now: stamp(), inscrits: list };
}

// ---------- iClosed ----------
// La clé API iClosed vit dans les ScriptProperties (ICLOSED_KEY), jamais dans ce code (repo public).
// Synchro : au plus toutes les 10 min, lancée par la console après son chargement (what=sync), forcée avec force=1.
// Une fiche par personne (contactId iClosed, sinon e-mail, sinon téléphone).
// Règle : les champs iClosed ne remplissent que les cases vides ; le statut n'est changé que s'il n'a pas
// été modifié à la main depuis la dernière synchro (colonne « iClosed statut auto »).
const IC_EVERY_MS = 10 * 60 * 1000;
const IC_OBJ = { FEAR: 'Peur', PRICE: 'Prix', MONEY: 'Argent', TIME: 'Timing', TIMING: 'Timing', SPOUSE: 'Conjoint', PARTNER: 'Associé / conjoint', THINK_ABOUT_IT: 'Doit réfléchir', TRUST: 'Confiance', LOGISTIC: 'Logistique', SMOKE_SCREEN: 'Écran de fumée', NO_OBJECTION: '' };
// Réservations qui ne sont pas des prospects
const IC_SKIP = /podcast|recrutement/i;
const IC_NOSALE = { FOLLOW_UP_SCHEDULE: 'Follow-up prévu', UNQUALIFIED: 'Pas qualifié', NOT_INTERESTED: 'Pas intéressé', CONTACT_CANCELLED: 'Annulé par le prospect', ADMIN_CANCELLED: 'Annulé par l\'équipe', NO_SHOW: 'No-show' };

function icSetKey(p) {
  if (P.getProperty('ICLOSED_KEY') && !p.force) return { ok: false, error: 'clé déjà posée' };
  if (!/^iclosed_[a-z0-9]+$/.test(String(p.ic_key || ''))) return { ok: false, error: 'clé invalide' };
  P.setProperty('ICLOSED_KEY', String(p.ic_key));
  return { ok: true };
}

function icFetch() {
  const key = P.getProperty('ICLOSED_KEY');
  if (!key) throw new Error('clé iClosed absente');
  let list = [];
  for (let page = 0; page < 50; page++) {
    const res = UrlFetchApp.fetch('https://public.api.iclosed.io/v1/eventCalls?limit=100&page=' + page, { headers: { Authorization: 'Bearer ' + key }, muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) throw new Error('iClosed HTTP ' + res.getResponseCode());
    const calls = ((JSON.parse(res.getContentText()).data || {}).eventCalls) || [];
    list = list.concat(calls);
    if (calls.length < 100) break;
  }
  return list;
}

function icAnswer(a) {
  if (a === null || a === undefined) return '';
  if (Array.isArray(a)) return a.map(x => x && typeof x === 'object' ? (x.answer ?? x.number ?? x.date ?? '') : x).filter(x => x !== '' && x !== null).join(', ').trim();
  return String(a).trim();
}
function icText(html) { return String(html || '').replace(/<!DOCTYPE[^>]*>/gi, '').replace(/<br\s*\/?>|<\/p>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\n{3,}/g, '\n\n').trim(); }
function icDigits(t) { let d = String(t || '').replace(/\D/g, ''); if (d.startsWith('00')) d = d.slice(2); if (d.length === 10 && d.startsWith('0')) d = '33' + d.slice(1); return d; }
function icLocal(utc) { return utc ? Utilities.formatDate(new Date(utc), TZ, "yyyy-MM-dd'T'HH:mm") : ''; }
function icCancelled(c) { return !!(c.cancelReason || c.cancelledBy); }

// Résume toutes les réservations d'une personne en une fiche
function icPerson(calls) {
  calls.sort((a, b) => String(a.dateTimeUTC).localeCompare(String(b.dateTimeUTC)));
  const now = Date.now();
  const active = calls.filter(c => !icCancelled(c));
  const last = active.length ? active[active.length - 1] : calls[calls.length - 1];
  const first = calls[0];
  const ans = {};
  calls.forEach(c => (c.secondaryAnswers || []).concat(c.questions || []).forEach(q => { const a = icAnswer(q && q.answer); if (q && q.statement && a.replace(/[\s'".,-]/g, '').length) ans[q.statement.trim()] = a; }));
  const pick = re => { const k = Object.keys(ans).find(x => re.test(x)); return k ? ans[k] : ''; };

  const deals = [];
  calls.forEach(c => (c.deals || []).forEach(d => { if (d.transactionType === 'WON') deals.push(d); }));
  const tasks = [];
  calls.forEach(c => (c.task || []).forEach(t => tasks.push({ c, t })));
  const lastTask = (last.task || [])[0] || {};

  let status;
  const lastTime = new Date(last.dateTimeUTC).getTime();
  const old = now - lastTime > 30 * 86400000;
  if (deals.length || tasks.some(x => x.t.outcome === 'WON')) status = 'vendu';
  else if (!icCancelled(last) && lastTime > now) status = 'booke';
  else if (icCancelled(last)) status = old ? 'ancien' : 'a_appeler';
  else if (lastTask.outcome === 'NO_SALE') {
    const r = lastTask.noSaleReason;
    status = r === 'FOLLOW_UP_SCHEDULE' ? 'followup' : r === 'NO_SHOW' ? 'noshow' : ['UNQUALIFIED', 'NOT_INTERESTED', 'CONTACT_CANCELLED', 'ADMIN_CANCELLED'].includes(r) ? 'perdu' : 'fait';
  } else status = old ? 'ancien' : 'booke'; // passé sans résultat : récent = à renseigner, ancien = archive

  const ready = pick(/échelle de 1 à 10/i);
  const need = [
    pick(/en quoi puis-je/i) && 'Besoin : ' + pick(/en quoi puis-je/i),
    pick(/pourquoi souhaitez/i) && 'Pourquoi ce call : ' + pick(/pourquoi souhaitez/i),
    pick(/TJM|CA\b/i) && 'TJM / CA : ' + pick(/TJM|CA\b/i),
    ready && 'Prêt à se lancer : ' + ready + ' /10',
  ].filter(Boolean).join('\n');

  const hist = calls.map(c => {
    const t = (c.task || [])[0] || {};
    const res = icCancelled(c) ? 'annulé' + (c.cancelReason ? ' (' + c.cancelReason + ')' : '')
      : t.outcome === 'WON' ? 'vendu' : t.outcome === 'NO_SALE' ? 'pas de vente' + (IC_NOSALE[t.noSaleReason] ? ' · ' + IC_NOSALE[t.noSaleReason] : '')
      : new Date(c.dateTimeUTC).getTime() > now ? 'à venir' : 'sans résultat';
    const note = icText(t.notes);
    return '• ' + icLocal(c.dateTimeUTC).replace('T', ' ') + ' · ' + ((c.event || {}).name || 'call') + ' · ' + ((c.user || {}).firstName || '') + ' · ' + res + (note ? '\n  ' + note.replace(/\n/g, '\n  ') : '');
  }).join('\n');
  const other = Object.keys(ans).filter(k => !/en quoi puis-je|pourquoi souhaitez|TJM|échelle de 1 à 10|Phone Number|Full Name|no show|conscient que|Call Outcome|No Sale Reason|^Objection$/i.test(k))
    .map(k => k + ' : ' + ans[k]).join('\n');
  const info = 'Réservations iClosed (' + calls.length + ')\n' + hist + (other ? '\n\nQuestionnaire\n' + other : '');

  const obj = tasks.map(x => x.t.objection).filter(o => o && o !== 'NO_OBJECTION').pop();
  const desc = ((last.event || {}).internalDescription || (last.event || {}).name || '');
  const source = /setter/i.test(desc) ? 'setter' : /linkedin/i.test(desc) ? 'linkedin' : 'iclosed';
  const price = deals.reduce((s, d) => s + (Number(d.value) || 0), 0);
  const soldAt = deals.length ? Utilities.formatDate(new Date(deals[deals.length - 1].time), TZ, 'yyyy-MM-dd') : '';
  const notes = deals.length ? 'Vendu : ' + deals.map(d => ((d.product || {}).name || 'offre') + ' ' + d.value + ' €').join(', ') : '';

  return {
    ic_contact: String(last.contactId || first.contactId || ''),
    name: last.inviteeName || pick(/Full Name/i) || '',
    email: String(last.inviteeEmail || (last.contact || {}).email || '').toLowerCase(),
    phone: last.phoneNumber || (last.contact || {}).phoneNumber || pick(/Phone Number/i) || '',
    source, call_at: icLocal(last.dateTimeUTC), status, score: '', need,
    objection: obj ? (IC_OBJ[obj] !== undefined ? IC_OBJ[obj] : obj.toLowerCase().replace(/_/g, ' ')) : '',
    price: price || '', sold_at: soldAt, notes,
    created: icLocal(first.createdAt || first.dateTimeUTC).replace(/$/, ':00'),
    ic_info: info, ic_link: !icCancelled(last) && lastTime > now ? (last.locationLinkInvitee || last.locationLink || '') : '', ic_event: (last.event || {}).name || '',
  };
}

function icSync(force) {
  const lastRun = Number(P.getProperty('IC_LAST_MS') || 0);
  if (!force && Date.now() - lastRun < IC_EVERY_MS) return { ok: true, skipped: true };
  if (!P.getProperty('ICLOSED_KEY')) return { ok: false, error: 'clé iClosed absente' };
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) return { ok: true, skipped: true };
  try {
    if (!force && Date.now() - Number(P.getProperty('IC_LAST_MS') || 0) < IC_EVERY_MS) return { ok: true, skipped: true };
    const calls = icFetch().filter(c => !IC_SKIP.test(((c.event || {}).name || '') + ' ' + ((c.event || {}).internalDescription || '')));
    // regroupement par personne
    const groups = {}, alias = {};
    calls.forEach(c => {
      const em = String(c.inviteeEmail || '').toLowerCase().trim(), ph = icDigits(c.phoneNumber);
      const keys = [c.contactId ? 'c' + c.contactId : '', em ? 'e' + em : '', ph ? 'p' + ph : ''].filter(Boolean);
      let g = keys.map(k => alias[k]).find(Boolean);
      if (!g) { g = keys[0] || 'x' + c.id; groups[g] = []; }
      groups[g].push(c);
      keys.forEach(k => { if (!alias[k]) alias[k] = g; });
    });

    const sh = tab(book(), LEADS_TAB, LEADS_HDR);
    const last = sh.getLastRow();
    const data = last >= 2 ? sh.getRange(2, 1, last - 1, LEADS_KEYS.length).getValues() : [];
    const col = k => LEADS_KEYS.indexOf(k);
    const byContact = {}, byEmail = {}, byPhone = {};
    data.forEach((r, i) => {
      if (r[col('ic_contact')]) byContact[String(r[col('ic_contact')])] = i;
      if (r[col('email')]) byEmail[String(r[col('email')]).toLowerCase().trim()] = i;
      if (icDigits(r[col('phone')])) byPhone[icDigits(r[col('phone')])] = i;
    });
    const stampNow = stamp();
    const ALWAYS = ['ic_contact', 'ic_info', 'ic_link', 'ic_event', 'call_at'];
    let created = 0, updated = 0;
    const touched = new Set();
    const fresh = [];
    Object.keys(groups).forEach(g => {
      const f = icPerson(groups[g]);
      let i = byContact[f.ic_contact];
      if (i === undefined && f.email) i = byEmail[f.email];
      if (i === undefined && icDigits(f.phone)) i = byPhone[icDigits(f.phone)];
      if (i === undefined) {
        created++;
        fresh.push(LEADS_KEYS.map(k => k === 'id' ? 'ic' + (f.ic_contact || Utilities.getUuid().slice(0, 8)) : k === 'created' ? f.created : k === 'updated' ? stampNow : k === 'ic_status' ? f.status : clean(k, f[k])));
        return;
      }
      const r = data[i];
      let changed = false;
      const set = (k, v) => { const c = col(k); if (String(r[c]) !== String(v)) { r[c] = v; changed = true; } };
      ALWAYS.forEach(k => { if (k === 'call_at' && r[col('call_at')] && String(r[col('call_at')]).slice(0, 16) > f.call_at) return; set(k, clean(k, f[k])); });
      ['name', 'email', 'phone', 'source', 'score', 'need', 'objection', 'price', 'sold_at', 'notes'].forEach(k => { if (r[col(k)] === '' && f[k] !== '') set(k, clean(k, f[k])); });
      const cur = String(r[col('status')] || ''), auto = String(r[col('ic_status')] || '');
      if (!cur || cur === auto) { set('status', f.status); }
      set('ic_status', f.status);
      if (changed) { r[col('updated')] = stampNow; updated++; touched.add(i); }
    });
    if (touched.size) {
      // réécriture des lignes modifiées seulement (plages contiguës)
      [...touched].sort((a, b) => a - b).forEach(i => sh.getRange(i + 2, 1, 1, LEADS_KEYS.length).setNumberFormat('@').setValues([data[i].map(v => v instanceof Date ? cell(v) : v)]));
    }
    if (fresh.length) {
      const start = sh.getLastRow() + 1;
      sh.getRange(start, 1, fresh.length, LEADS_KEYS.length).setNumberFormat('@').setValues(fresh);
    }
    P.setProperty('IC_LAST_MS', String(Date.now()));
    P.setProperty('IC_LAST', stampNow);
    return { ok: true, calls: calls.length, people: Object.keys(groups).length, created, updated };
  } finally {
    lock.releaseLock();
  }
}

function out(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
