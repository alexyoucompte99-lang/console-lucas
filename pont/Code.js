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
//   call_upsert { call:{ id, … }, lead?:{ id, … }, create? }  met à jour un call (onglet Calls ; create:true pour en créer un) et, dans le même verrou,
//                                        applique les changements de la fiche lead (jamais créée ici)
//   call_delete { id }                   supprime un call ajouté à la main
//   contacts_preview {}                  (GET) non bookés iClosed qui seraient créés, sans rien écrire
//   inscrits   {}                        inscrits au live
//
// Onglet Calls (17/09/2026) : une ligne par call (réservation iClosed ou call ajouté dans la console),
// pour le suivi des calls passés et des stats justes quand un lead a plusieurs calls.
//
// Non bookés (17/09/2026) : contacts iClosed qui ont commencé à réserver sans choisir de créneau
// (statut iClosed POTENTIAL ou QUALIFIED, aucun call). La synchro leur crée une fiche statut « nonbooke »
// (colonne iClosed statut auto = nonbooke). S'ils réservent, la synchro des calls passe la fiche en booke
// et ajoute une note « a réservé (non booké, N relances) ».

// À exécuter une fois dans l'éditeur pour accorder les autorisations (Sheets)
function autoriser() {
  const ss = book();
  tab(ss, LEADS_TAB, LEADS_HDR);
  tab(ss, CALLS_TAB, CALLS_HDR);
  SpreadsheetApp.openById(INSCRITS_ID).getName();
  Logger.log('OK ' + ss.getUrl());
}

const KEY = 'lucas-759dc1a01a28ae1d91ac25c8';
const P = PropertiesService.getScriptProperties();
const TZ = 'Europe/Paris';
const SHEET_NAME = 'Console Lucas · leads';
const LEADS_TAB = 'Leads';
const LEADS_HDR = ['ID', 'Créé le', 'MAJ', 'Prénom nom', 'Téléphone', 'E-mail', 'Source', 'Date du call', 'Statut', 'Qualifié /10', 'Besoin / situation', 'Objection', 'Action suivante', 'Date de relance', 'Prix proposé', 'Encaissé', 'Vendu le', 'Notes', 'iClosed contact', 'iClosed statut auto', 'iClosed infos', 'Lien visio', 'Type de call', 'Résultat iClosed', 'Confirmation envoyée', 'Nb relances', 'Dernière relance', 'Offre', 'Paiement', 'Température'];
const LEADS_KEYS = ['id', 'created', 'updated', 'name', 'phone', 'email', 'source', 'call_at', 'status', 'score', 'need', 'objection', 'next_action', 'next_at', 'price', 'paid', 'sold_at', 'notes', 'ic_contact', 'ic_status', 'ic_info', 'ic_link', 'ic_event', 'ic_result', 'confirmed', 'touches', 'last_touch', 'offer', 'payment', 'temp'];
// Une ligne par call. kind : r1 | suivi | client ; ic_state : a_venir | passe | annule (iClosed) ;
// show : present | noshow | reporte | annule ; result : vendu | followup | perdu | non_qualifie ; temp : chaud | tiede | froid ;
// objection : plusieurs objections séparées par « · » ; conf_sent : message de confirmation envoyé le ; conf_reply : ok | decale | rien
const CALLS_TAB = 'Calls';
const CALLS_HDR = ['ID', 'Lead', 'Créé le', 'MAJ', 'Date du call', 'Prospect', 'Type', 'Événement', 'Closer', 'État iClosed', 'Présence', 'Résultat', 'Qualifié /10', 'Température', 'Offre', 'Prix proposé', 'Paiement', 'Encaissé', 'Objection', 'Pourquoi pas signé', 'Prochaine étape', 'Relance le', 'Enregistrement', 'Notes du call', 'Rempli le', 'Confirmation envoyée', 'Réponse confirmation'];
const CALLS_KEYS = ['id', 'lead_id', 'created', 'updated', 'call_at', 'name', 'kind', 'event', 'closer', 'ic_state', 'show', 'result', 'score', 'temp', 'offer', 'price', 'payment', 'paid', 'objection', 'reason', 'next_step', 'next_at', 'recording', 'notes', 'filled_at', 'conf_sent', 'conf_reply'];
// Réservations iClosed qui sont des séances de clients (pas des calls de vente)
const IC_CLIENT = /accompagnement|1\s*to\s*1|one\s*to\s*one/i;

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
  if (p.what === 'call_upsert') return callUpsert(p);
  if (p.what === 'call_delete') return callDelete(p);
  if (p.what === 'contacts_preview') return icContactsSync(stamp(), true);
  if (p.what === 'inscrits') return inscrits();
  if (p.what === 'sync') { try { return icSync(p.force === '1' || p.force === true); } catch (e) { return { ok: false, error: String(e) }; } }
  if (p.what === 'ic_setkey') return icSetKey(p);
  if (p.what === 'tg_setup') return tgSetup(p);
  if (p.what === 'settings_set') return settingsSet(p);
  if (p.what === 'cron') return cron(p);
  if (p.what === 'brief_preview') { const d = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'); return { ok: true, brief: brief(d), soir: soir(d) }; } // lecture seule, rien n'est envoyé
  if (!p.what) return { ok: true, pong: true, v: 1 };
  return { ok: false, error: 'unknown what' };
}

// ---------- setup ----------
function setup() {
  const ss = book();
  tab(ss, LEADS_TAB, LEADS_HDR);
  tab(ss, CALLS_TAB, CALLS_HDR);
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

// largeur des colonnes de texte long, par onglet
const WIDE = { need: 280, notes: 320, reason: 300, next_step: 220, ic_info: 260 };
function tab(ss, name, hdr) {
  const keys = name === CALLS_TAB ? CALLS_KEYS : LEADS_KEYS;
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    if (sh.getMaxColumns() < hdr.length) sh.insertColumnsAfter(sh.getMaxColumns(), hdr.length - sh.getMaxColumns());
    sh.getRange(1, 1, 1, hdr.length).setValues([hdr]).setFontWeight('bold').setBackground('#a6ff4d').setFontColor('#060a04');
    sh.setFrozenRows(1);
    Object.keys(WIDE).forEach(k => { const i = keys.indexOf(k); if (i >= 0 && k !== 'ic_info') sh.setColumnWidth(i + 1, WIDE[k]); });
  } else if (sh.getLastColumn() < hdr.length) {
    if (sh.getMaxColumns() < hdr.length) sh.insertColumnsAfter(sh.getMaxColumns(), hdr.length - sh.getMaxColumns());
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
  const ss = book();
  const sh = tab(ss, LEADS_TAB, LEADS_HDR);
  const cs = tab(ss, CALLS_TAB, CALLS_HDR);
  return { ok: true, now: stamp(), leads: rows(sh, LEADS_KEYS), calls: rows(cs, CALLS_KEYS), ic_sync: P.getProperty('IC_LAST') || '', settings: settingsGet(), tg: !!P.getProperty('TG_TOKEN'), ic_due: Date.now() - Number(P.getProperty('IC_LAST_MS') || 0) > IC_EVERY_MS && !!P.getProperty('ICLOSED_KEY') };
}

function rowObj(sh, keys, r) {
  const v = sh.getRange(r, 1, 1, keys.length).getValues()[0];
  const o = {}; keys.forEach((k, i) => { o[k] = cell(v[i]); });
  return o;
}

function findRow(sh, id) {
  const last = sh.getLastRow();
  if (last < 2) return 0;
  const ids = sh.getRange(2, 1, last - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) if (String(ids[i][0]) === String(id)) return i + 2;
  return 0;
}

// ---------- écriture ----------
const NUM_KEYS = ['score', 'price', 'paid', 'touches'];
function clean(k, v) {
  if (v === null || v === undefined) return '';
  if (NUM_KEYS.indexOf(k) >= 0) { const n = Number(v); return isNaN(n) || v === '' ? '' : n; }
  return String(v);
}

// Écrit un objet dans un onglet : mise à jour (seules les clés envoyées, jamais id ni created) si l'id existe,
// sinon création (sauf create === false). À appeler sous verrou.
function writeRow(sh, keys, obj, prefix, create) {
  const now = stamp();
  const r = obj.id ? findRow(sh, obj.id) : 0;
  if (r) {
    keys.forEach((k, i) => {
      if (k === 'id' || k === 'created' || k === 'updated') return;
      if (!Object.prototype.hasOwnProperty.call(obj, k)) return;
      sh.getRange(r, i + 1).setNumberFormat('@').setValue(clean(k, obj[k]));
    });
    sh.getRange(r, keys.indexOf('updated') + 1).setNumberFormat('@').setValue(now);
    return { ok: true, id: String(obj.id), updated: now };
  }
  if (create === false) return { ok: false, error: 'introuvable', id: String(obj.id || '') };
  const id = obj.id ? String(obj.id) : prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const row = keys.map(k => {
    if (k === 'id') return id;
    if (k === 'created') return obj.created ? String(obj.created) : now;
    if (k === 'updated') return now;
    return clean(k, obj[k]);
  });
  const at = sh.getLastRow() + 1;
  sh.getRange(at, 1, 1, row.length).setNumberFormat('@').setValues([row]);
  return { ok: true, id, created: row[keys.indexOf('created')], updated: now };
}

function upsert(p) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    return writeRow(tab(book(), LEADS_TAB, LEADS_HDR), LEADS_KEYS, p.lead || {}, 'l');
  } finally {
    lock.releaseLock();
  }
}

// résultat d'un call : la ligne du call + les changements de la fiche lead, sous le même verrou
function callUpsert(p) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  let res = { ok: true }, sale = null;
  try {
    const ss = book();
    if (p.call) {
      const cs = tab(ss, CALLS_TAB, CALLS_HDR);
      const r = p.call.id ? findRow(cs, p.call.id) : 0;
      const before = r ? rowObj(cs, CALLS_KEYS, r) : {};
      res.call = writeRow(cs, CALLS_KEYS, p.call, 'c', p.create === true); // pas de ligne à moitié vide si l'id est inconnu
      if (res.call.ok && p.call.result === 'vendu' && before.result !== 'vendu') sale = Object.assign({}, before, p.call);
    }
    if (p.lead && p.lead.id) res.lead = writeRow(tab(ss, LEADS_TAB, LEADS_HDR), LEADS_KEYS, p.lead, 'l', false);
    if (res.call) res.id = res.call.id;
    if (res.call && !res.call.ok) res = Object.assign(res, { ok: false, error: 'call introuvable' });
  } finally {
    lock.releaseLock();
  }
  if (sale) {
    try {
      tg('💰 <b>Vente Lucas</b>\n' + h(sale.name) + (Number(sale.price) ? ' · ' + Math.round(Number(sale.price)).toLocaleString('fr-FR') + ' €' : '') +
        (sale.offer ? '\n' + h(sale.offer) : '') + (sale.payment ? ' · ' + h(sale.payment) : '') + '\n\n<a href="' + CONSOLE_URL + '#chiffres">Ouvrir la console</a>');
    } catch (e) { /* la vente est enregistrée même si Telegram ne répond pas */ }
  }
  return res;
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

function callDelete(p) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = tab(book(), CALLS_TAB, CALLS_HDR);
    const r = findRow(sh, p.id);
    if (!r) return { ok: true, missing: true };
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
function icDigits(t) { let d = String(t || '').replace(/\D/g, ''); if (d.startsWith('00')) d = d.slice(2); if (d.length === 10 && d.startsWith('0')) d = '33' + d.slice(1); if (d.length === 12 && d.startsWith('330')) d = '33' + d.slice(3); return d; }
function icLocal(utc) { return utc ? Utilities.formatDate(new Date(utc), TZ, "yyyy-MM-dd'T'HH:mm") : ''; }
function icCancelled(c) { return !!(c.cancelReason || c.cancelledBy); }

// Résume toutes les réservations d'une personne en une fiche
function icEventText(c) { return ((c.event || {}).name || '') + ' ' + ((c.event || {}).internalDescription || ''); }
function icPerson(calls) {
  calls.sort((a, b) => String(a.dateTimeUTC).localeCompare(String(b.dateTimeUTC)));
  const now = Date.now();
  const sales = calls.filter(c => !IC_CLIENT.test(icEventText(c)));
  const base = sales.length ? sales : calls; // une séance client ne change ni le statut ni le prochain call
  const active = base.filter(c => !icCancelled(c));
  const last = active.length ? active[active.length - 1] : base[base.length - 1];
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
  const stale = now - lastTime > 45 * 86400000; // au-delà : plus une relance, une réactivation
  if (deals.length || tasks.some(x => x.t.outcome === 'WON')) status = 'vendu';
  else if (!icCancelled(last) && lastTime > now) status = 'booke';
  else if (icCancelled(last)) status = old ? 'ancien' : 'a_appeler';
  else if (lastTask.outcome === 'NO_SALE') {
    const r = lastTask.noSaleReason;
    status = r === 'FOLLOW_UP_SCHEDULE' ? (stale ? 'ancien' : 'followup') : r === 'NO_SHOW' ? (stale ? 'ancien' : 'noshow') : ['UNQUALIFIED', 'NOT_INTERESTED', 'CONTACT_CANCELLED', 'ADMIN_CANCELLED'].includes(r) ? 'perdu' : 'fait';
  } else status = old ? 'ancien' : 'booke'; // passé sans résultat : récent = à renseigner, ancien = archive

  const result = status === 'vendu' ? 'Vendu' : !icCancelled(last) && lastTime > now ? 'Call à venir' : icCancelled(last) ? 'Annulé'
    : lastTask.outcome === 'NO_SALE' ? (IC_NOSALE[lastTask.noSaleReason] || 'Pas de vente') : 'Sans résultat';
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
  const offer = deals.map(d => (d.product || {}).name || '').filter(Boolean).join(', ');

  return {
    ic_contact: String(last.contactId || first.contactId || ''),
    name: last.inviteeName || pick(/Full Name/i) || '',
    email: String(last.inviteeEmail || (last.contact || {}).email || '').toLowerCase(),
    phone: last.phoneNumber || (last.contact || {}).phoneNumber || pick(/Phone Number/i) || '',
    source, call_at: icLocal(last.dateTimeUTC), status, score: '', need,
    objection: obj ? (IC_OBJ[obj] !== undefined ? IC_OBJ[obj] : obj.toLowerCase().replace(/_/g, ' ')) : '',
    price: price || '', sold_at: soldAt, notes, offer,
    created: icLocal(first.createdAt || first.dateTimeUTC).replace(/$/, ':00'),
    ic_info: info, ic_link: !icCancelled(last) && lastTime > now ? (last.locationLinkInvitee || last.locationLink || '') : '', ic_event: (last.event || {}).name || '', ic_result: result,
    next_at: status === 'followup' ? Utilities.formatDate(new Date(lastTime + 86400000), TZ, 'yyyy-MM-dd') : status === 'noshow' || status === 'a_appeler' ? Utilities.formatDate(new Date(Math.max(lastTime, now)), TZ, 'yyyy-MM-dd') : '',
    next_action: status === 'followup' ? 'Relance follow-up' : status === 'noshow' ? 'Reprogrammer le call' : status === 'a_appeler' ? 'Call annulé : relancer' : '',
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
    const ALWAYS = ['ic_contact', 'ic_info', 'ic_link', 'ic_event', 'ic_result', 'call_at'];
    let created = 0, updated = 0;
    const touched = new Set();
    const fresh = [];
    const leadOf = {}; // groupe iClosed -> id de la fiche lead
    Object.keys(groups).forEach(g => {
      const f = icPerson(groups[g]);
      let i = byContact[f.ic_contact];
      if (i === undefined && f.email) i = byEmail[f.email];
      if (i === undefined && icDigits(f.phone)) i = byPhone[icDigits(f.phone)];
      if (i === undefined) {
        created++;
        const nid = 'ic' + (f.ic_contact || Utilities.getUuid().slice(0, 8));
        leadOf[g] = nid;
        fresh.push(LEADS_KEYS.map(k => k === 'id' ? nid : k === 'created' ? f.created : k === 'updated' ? stampNow : k === 'ic_status' ? f.status : clean(k, f[k])));
        return;
      }
      leadOf[g] = String(data[i][col('id')]);
      const r = data[i];
      let changed = false;
      const set = (k, v) => { const c = col(k); if (String(r[c]) !== String(v)) { r[c] = v; changed = true; } };
      const prevCall = String(r[col('call_at')] || '').slice(0, 16);
      ALWAYS.forEach(k => { if (k === 'call_at' && r[col('call_at')] && String(r[col('call_at')]).slice(0, 16) > f.call_at) return; set(k, clean(k, f[k])); });
      ['name', 'email', 'phone', 'source', 'score', 'need', 'objection', 'price', 'sold_at', 'notes', 'offer'].forEach(k => { if (r[col(k)] === '' && f[k] !== '') set(k, clean(k, f[k])); });
      const cur = String(r[col('status')] || ''), auto = String(r[col('ic_status')] || '');
      const newBooking = f.status === 'booke' && f.call_at > prevCall && f.call_at > icLocal(new Date().toISOString());
      if (auto === 'nonbooke' && f.status !== 'nonbooke') {
        const n = Number(r[col('touches')]) || 0;
        const line = Utilities.formatDate(new Date(), TZ, 'dd/MM') + ' : a réservé (non booké, ' + (n ? n + ' relance' + (n > 1 ? 's' : '') : 'sans relance') + ')';
        set('notes', line + (r[col('notes')] ? '\n' + r[col('notes')] : ''));
      }
      if (!cur || cur === auto || (newBooking && cur !== 'vendu' && cur !== 'ecarte')) {
        set('status', f.status);
        if (newBooking) { set('confirmed', ''); }
        if (f.next_at && r[col('next_at')] === '' && f.status !== auto) { set('next_at', f.next_at); set('next_action', f.next_action); }
      }
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
    let callsSync, contactsSync;
    try { callsSync = icCallsSync(groups, leadOf, stampNow); } catch (e) { callsSync = { ok: false, error: String(e && e.message || e) }; }
    try { contactsSync = icContactsSync(stampNow, false); } catch (e) { contactsSync = { ok: false, error: String(e && e.message || e) }; }
    P.setProperty('IC_LAST_MS', String(Date.now()));
    P.setProperty('IC_LAST', stampNow);
    icWatch(calls);
    return { ok: true, calls: calls.length, people: Object.keys(groups).length, created, updated, calls_sync: callsSync, contacts_sync: contactsSync };
  } finally {
    lock.releaseLock();
  }
}

// Champs d'un call tirés d'iClosed (résultat seulement si Lucas l'a saisi dans iClosed)
function icCallFields(c, kind) {
  const t = (c.task || [])[0] || {};
  const cancelled = icCancelled(c);
  const r = t.noSaleReason;
  let show = '', result = '';
  if (cancelled) show = 'annule';
  else if (t.outcome === 'WON') { show = 'present'; result = 'vendu'; }
  else if (t.outcome === 'NO_SALE') {
    if (r === 'NO_SHOW') show = 'noshow';
    else if (r === 'CONTACT_CANCELLED' || r === 'ADMIN_CANCELLED') show = 'annule';
    else { show = 'present'; result = r === 'FOLLOW_UP_SCHEDULE' ? 'followup' : r === 'UNQUALIFIED' ? 'non_qualifie' : 'perdu'; }
  }
  const won = (c.deals || []).filter(d => d.transactionType === 'WON');
  const obj = t.objection && t.objection !== 'NO_OBJECTION' ? (IC_OBJ[t.objection] !== undefined ? IC_OBJ[t.objection] : String(t.objection).toLowerCase().replace(/_/g, ' ')) : '';
  const note = icText(t.notes);
  return {
    call_at: icLocal(c.dateTimeUTC), name: String(c.inviteeName || '').trim(), kind, event: String((c.event || {}).name || '').trim(),
    closer: String((c.user || {}).firstName || '').trim(), ic_state: cancelled ? 'annule' : new Date(c.dateTimeUTC).getTime() > Date.now() ? 'a_venir' : 'passe',
    show, result, objection: obj,
    notes: cancelled && c.cancelReason ? 'Annulé : ' + String(c.cancelReason).trim() + (note ? '\n' + note : '') : note,
    price: won.reduce((s, d) => s + (Number(d.value) || 0), 0) || '', offer: won.map(d => (d.product || {}).name || '').filter(Boolean).join(', '),
  };
}

// Onglet Calls : crée les réservations nouvelles, rafraîchit date / état iClosed, et ne remplit
// les champs de résultat que s'ils sont vides (ce qui est saisi dans la console n'est jamais écrasé)
function icCallsSync(groups, leadOf, stampNow) {
  const sh = tab(book(), CALLS_TAB, CALLS_HDR);
  const last = sh.getLastRow();
  const data = last >= 2 ? sh.getRange(2, 1, last - 1, CALLS_KEYS.length).getValues() : [];
  const col = k => CALLS_KEYS.indexOf(k);
  const byId = {};
  data.forEach((r, i) => { if (r[0] !== '') byId[String(r[0])] = i; });
  const ALWAYS = ['call_at', 'event', 'closer', 'ic_state'];
  const FILL = ['lead_id', 'name', 'kind', 'show', 'result', 'objection', 'notes', 'price', 'offer'];
  const touched = new Set(), fresh = [];
  let created = 0, updated = 0;
  Object.keys(groups).forEach(g => {
    const list = groups[g].slice().sort((a, b) => String(a.dateTimeUTC).localeCompare(String(b.dateTimeUTC)));
    let sales = false;
    list.forEach(c => {
      const ev = ((c.event || {}).name || '') + ' ' + ((c.event || {}).internalDescription || '');
      const kind = IC_CLIENT.test(ev) ? 'client' : sales ? 'suivi' : 'r1';
      if (kind !== 'client' && !icCancelled(c)) sales = true;
      const f = icCallFields(c, kind);
      f.lead_id = leadOf[g] || '';
      const id = 'icc' + c.id;
      const i = byId[id];
      if (i === undefined) {
        created++;
        fresh.push(CALLS_KEYS.map(k => k === 'id' ? id : k === 'created' ? icLocal(c.createdAt || c.dateTimeUTC) : k === 'updated' ? stampNow : clean(k, f[k])));
        byId[id] = -1;
        return;
      }
      if (i < 0) return;
      const r = data[i];
      let changed = false;
      const set = (k, v) => { const ci = col(k); if (String(r[ci]) !== String(v)) { r[ci] = v; changed = true; } };
      ALWAYS.forEach(k => set(k, clean(k, f[k])));
      FILL.forEach(k => { if (String(r[col(k)]) === '' && String(f[k]) !== '') set(k, clean(k, f[k])); });
      if (changed) { r[col('updated')] = stampNow; updated++; touched.add(i); }
    });
  });
  [...touched].forEach(i => sh.getRange(i + 2, 1, 1, CALLS_KEYS.length).setNumberFormat('@').setValues([data[i].map(v => v instanceof Date ? cell(v) : v)]));
  if (fresh.length) sh.getRange(sh.getLastRow() + 1, 1, fresh.length, CALLS_KEYS.length).setNumberFormat('@').setValues(fresh);
  return { ok: true, created, updated };
}

// Non bookés : une fiche par contact iClosed sans réservation (hors podcast, recrutement, tests).
// Ne touche jamais au statut d'une fiche existante : met seulement à jour l'événement et la qualification
// des fiches encore marquées nonbooke. preview = true : ne rien écrire, renvoyer ce qui serait créé.
function icContactsSync(stampNow, preview) {
  const key = P.getProperty('ICLOSED_KEY');
  if (!key) return { ok: false, error: 'clé iClosed absente' };
  let list = [];
  for (let page = 0; page < 50; page++) {
    const res = UrlFetchApp.fetch('https://public.api.iclosed.io/v1/contacts?limit=100&page=' + page, { headers: { Authorization: 'Bearer ' + key }, muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) throw new Error('iClosed contacts HTTP ' + res.getResponseCode());
    const cs = ((JSON.parse(res.getContentText()).data || {}).contacts) || [];
    list = list.concat(cs);
    if (cs.length < 100) break;
  }
  const sh = tab(book(), LEADS_TAB, LEADS_HDR);
  const last = sh.getLastRow();
  const data = last >= 2 ? sh.getRange(2, 1, last - 1, LEADS_KEYS.length).getValues() : [];
  const col = k => LEADS_KEYS.indexOf(k);
  const byContact = {}, byEmail = {}, byPhone = {};
  const index = (r, i) => {
    if (r[col('ic_contact')]) byContact[String(r[col('ic_contact')])] = i;
    if (r[col('email')]) byEmail[String(r[col('email')]).toLowerCase().trim()] = i;
    if (icDigits(r[col('phone')])) byPhone[icDigits(r[col('phone')])] = i;
  };
  data.forEach(index);
  const touched = new Set(), fresh = [], sample = [];
  let skipped = 0, updated = 0;
  list.forEach(ct => {
    const events = (ct.ContactEvents || []).map(e => String((e && e.name) || '').trim()).filter(Boolean);
    const sales = events.filter(n => !IC_SKIP.test(n));
    if (ct.status === 'STRATEGY_CALL_BOOKED' || (events.length && !sales.length)) { skipped++; return; } // a réservé (géré par les calls), ou podcast / recrutement
    const cid = String(ct.id || '');
    let mail = String(ct.email || '').trim().toLowerCase();
    if (mail.indexOf('@') < 0) mail = ''; // iClosed recopie le numéro dans l'e-mail quand le formulaire s'arrête au téléphone
    const tel = icDigits(ct.phoneNumber);
    const name = (String(ct.firstName || '').trim() + ' ' + String(ct.lastName || '').trim()).trim();
    if (/^test\b/i.test(name) || /\btest\b/i.test(mail)) { skipped++; return; }
    if (!cid || (!mail && !tel)) { skipped++; return; }
    const result = ct.status === 'QUALIFIED' ? 'Qualifié, sans créneau' : 'Formulaire commencé';
    const ev = sales.join(', ');
    let i = byContact[cid];
    if (i === undefined && mail) i = byEmail[mail];
    if (i === undefined && tel) i = byPhone[tel];
    if (i !== undefined) {
      if (i < 0) return; // déjà créé plus haut dans ce passage
      const r = data[i];
      if (String(r[col('ic_status')]) !== 'nonbooke') return; // fiche suivie par les calls
      let changed = false;
      const set = (k, v) => { const c = col(k); if (String(r[c]) !== String(v)) { r[c] = v; changed = true; } };
      if (ev) set('ic_event', ev);
      set('ic_result', result);
      if (changed) { r[col('updated')] = stampNow; touched.add(i); updated++; }
      return;
    }
    const lead = { id: 'ic' + cid, created: icLocal(ct.createdAt) ? icLocal(ct.createdAt) + ':00' : stampNow, updated: stampNow, name: name || mail, phone: tel ? '+' + tel : '', email: mail, source: 'iclosed', status: 'nonbooke', ic_contact: cid, ic_status: 'nonbooke', ic_event: ev, ic_result: result };
    fresh.push(LEADS_KEYS.map(k => clean(k, lead[k])));
    if (sample.length < 5) sample.push({ name: lead.name, created: lead.created, result, event: ev });
    byContact[cid] = -1; if (mail) byEmail[mail] = -1; if (tel) byPhone[tel] = -1;
  });
  if (preview) return { ok: true, preview: true, contacts: list.length, created: fresh.length, updated, skipped, sample };
  [...touched].forEach(i => sh.getRange(i + 2, 1, 1, LEADS_KEYS.length).setNumberFormat('@').setValues([data[i].map(v => v instanceof Date ? cell(v) : v)]));
  if (fresh.length) sh.getRange(sh.getLastRow() + 1, 1, fresh.length, LEADS_KEYS.length).setNumberFormat('@').setValues(fresh);
  return { ok: true, contacts: list.length, created: fresh.length, updated, skipped };
}

// ---------- réglages partagés (objectifs + messages WhatsApp) ----------
function settingsGet() { try { return JSON.parse(P.getProperty('SETTINGS') || '{}'); } catch (e) { return {}; } }
function settingsSet(p) {
  const cur = settingsGet();
  const next = Object.assign(cur, p.settings || {});
  P.setProperty('SETTINGS', JSON.stringify(next));
  return { ok: true, settings: next };
}

// ---------- Telegram (bot To do Alex) ----------
function tgSetup(p) {
  if (P.getProperty('TG_TOKEN') && !p.force) return { ok: false, error: 'déjà configuré' };
  if (!/^\d+:[\w-]+$/.test(String(p.token || '')) || !/^-?\d+$/.test(String(p.chat || ''))) return { ok: false, error: 'token ou chat invalide' };
  P.setProperty('TG_TOKEN', String(p.token));
  P.setProperty('TG_CHAT', String(p.chat));
  return { ok: true };
}
function tg(text) {
  const token = P.getProperty('TG_TOKEN'), chat = P.getProperty('TG_CHAT');
  if (!token || !chat) return false;
  const res = UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
    method: 'post', muteHttpExceptions: true,
    payload: { chat_id: chat, text: text, parse_mode: 'HTML', disable_web_page_preview: 'true' },
  });
  return res.getResponseCode() === 200;
}
function h(t) { return String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
const CONSOLE_URL = 'https://alexyoucompte99-lang.github.io/console-lucas/';

// Nouveaux calls bookés / annulés : compare les calls à venir avec ceux vus au passage précédent
function icWatch(calls) {
  const now = Date.now();
  const up = {};
  calls.forEach(c => { if (!icCancelled(c) && new Date(c.dateTimeUTC).getTime() > now) up[c.id] = { n: String(c.inviteeName || '').trim(), d: icLocal(c.dateTimeUTC), e: (c.event || {}).name || '' }; });
  const prevRaw = P.getProperty('IC_UPCOMING');
  P.setProperty('IC_UPCOMING', JSON.stringify(up));
  if (!prevRaw) return; // premier passage : on mémorise sans notifier
  const prev = JSON.parse(prevRaw);
  const byId = {}; calls.forEach(c => byId[c.id] = c);
  Object.keys(up).forEach(id => {
    if (prev[id]) return;
    const c = byId[id];
    const ans = (c.secondaryAnswers || []).map(q => [q.statement, icAnswer(q.answer)]).filter(x => x[1] && /en quoi|pourquoi souhaitez|TJM|échelle/i.test(x[0]));
    tg('📅 <b>Nouveau call booké</b> · Lucas\n' + h(up[id].n) + '\n' + h(up[id].d.replace('T', ' à ').replace(':', 'h')) + ' · ' + h(up[id].e) +
      (c.phoneNumber ? '\n' + h(c.phoneNumber) : '') + (ans.length ? '\n\n' + ans.map(x => '• ' + h(x[1])).join('\n') : '') + '\n\n<a href="' + CONSOLE_URL + '">Ouvrir la console</a>');
  });
  Object.keys(prev).forEach(id => {
    if (up[id]) return;
    const c = byId[id];
    if (c && icCancelled(c)) tg('❌ <b>Call annulé</b> · Lucas\n' + h(prev[id].n) + ' (' + h(prev[id].d.replace('T', ' à ').replace(':', 'h')) + ')' + (c.cancelReason ? '\nRaison : ' + h(c.cancelReason) : '') + '\nÀ relancer pour recaler.');
  });
}

// ---------- cron (GitHub Actions toutes les 15 min) ----------
// synchro iClosed + alertes (nouveau call, annulation) + brief 8h + calls non remplis 20h, une fois par jour chacun
function cron(p) {
  const outp = { ok: true };
  try { outp.sync = icSync(true); } catch (e) { outp.sync = { ok: false, error: String(e) }; }
  const hour = Number(Utilities.formatDate(new Date(), TZ, 'H'));
  const today = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  if ((hour >= 8 && hour < 12 && P.getProperty('BRIEF_DAY') !== today) || p.test === 'brief') {
    if (tg(brief(today))) { if (p.test !== 'brief') P.setProperty('BRIEF_DAY', today); outp.brief = true; }
  }
  if ((hour >= 20 && P.getProperty('SOIR_DAY') !== today) || p.test === 'soir') {
    const txt = soir(today);
    if (txt) tg(txt);
    if (p.test !== 'soir') P.setProperty('SOIR_DAY', today);
    outp.soir = !!txt;
  }
  return outp;
}

function leadsNow() { return rows(tab(book(), LEADS_TAB, LEADS_HDR), LEADS_KEYS); }
function callsNow() { return rows(tab(book(), CALLS_TAB, CALLS_HDR), CALLS_KEYS); }
function addDaysIso(iso, n) { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return Utilities.formatDate(d, TZ, 'yyyy-MM-dd'); }
function nowLocal() { return Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd'T'HH:mm"); }
const OPEN_ST = ['a_appeler', 'booke', 'fait', 'followup', 'noshow']; // « ecarte » (doublon, test) : hors stats et hors relances
// un call ajouté à la main et pas rempli est un doublon si iClosed a une réservation le même jour pour ce lead
function dedupeCalls(C) {
  const icDays = {};
  C.forEach(c => { if (String(c.id).indexOf('icc') === 0 && !cancelledCall(c)) icDays[c.lead_id + '|' + String(c.call_at).slice(0, 10)] = true; });
  return C.filter(c => String(c.id).indexOf('icc') === 0 || c.show || !icDays[c.lead_id + '|' + String(c.call_at).slice(0, 10)]);
}
// non booké à relancer : jamais relancé et arrivé il y a moins de 45 jours, ou relance due (3 relances au plus)
function nbDue(l, today) {
  if (l.status !== 'nonbooke') return false;
  const n = Number(l.touches) || 0;
  if (n >= 3) return false;
  if (!n) return String(l.created).slice(0, 10) >= addDaysIso(today, -45);
  return !!l.next_at && String(l.next_at).slice(0, 10) <= today;
}
function cancelledCall(c) { return c.ic_state === 'annule' || c.show === 'annule' || c.show === 'reporte'; }
// calls de vente passés sans présence renseignée (30 derniers jours)
function callsToFill(calls, today) {
  const now = nowLocal(), lim = addDaysIso(today, -30);
  return calls.filter(c => c.kind !== 'client' && !cancelledCall(c) && !c.show && String(c.call_at).slice(0, 16) < now && String(c.call_at).slice(0, 10) >= lim);
}

function monthStats(leads, calls, m) {
  const now = nowLocal();
  const cm = calls.filter(c => c.kind !== 'client' && !cancelledCall(c) && String(c.call_at).slice(0, 7) === m && String(c.call_at).slice(0, 16) < now);
  const shows = cm.filter(c => c.show === 'present').length;
  const noshow = cm.filter(c => c.show === 'noshow').length;
  const ventes = leads.filter(l => l.status === 'vendu' && String(l.sold_at).slice(0, 7) === m);
  const ca = ventes.reduce((a, l) => a + (Number(l.price) || 0), 0);
  const cash = ventes.reduce((a, l) => a + (Number(l.paid) || 0), 0);
  return { calls: cm.length, shows, noshow, ventes: ventes.length, ca, cash };
}

function brief(today) {
  const L = leadsNow();
  const ecartes = new Set(L.filter(l => l.status === 'ecarte').map(l => String(l.id)));
  const C = dedupeCalls(callsNow()).filter(c => !ecartes.has(String(c.lead_id)));
  const S = settingsGet();
  const byId = {}; L.forEach(l => byId[String(l.id)] = l);
  const tomorrow = addDaysIso(today, 1);
  const eur = n => Math.round(n).toLocaleString('fr-FR') + ' €';
  const hh = c => String(c.call_at).slice(11, 16).replace(':', 'h');
  const callsToday = C.filter(c => String(c.call_at).slice(0, 10) === today && !cancelledCall(c)).sort((a, b) => String(a.call_at).localeCompare(String(b.call_at)));
  const toFill = callsToFill(C, today);
  const late = L.filter(l => l.next_at && OPEN_ST.includes(l.status) && String(l.next_at).slice(0, 10) <= today);
  const tom = C.filter(c => String(c.call_at).slice(0, 10) === tomorrow && !cancelledCall(c) && c.kind !== 'client' && c.conf_reply !== 'ok');
  const fu = L.filter(l => l.status === 'followup');
  const fuVal = fu.reduce((a, l) => a + (Number(l.price) || 0), 0);
  const m = today.slice(0, 7);
  const st = monthStats(L, C, m);
  const obj = Number(S.objectif_ca) || 0;
  const day = Number(today.slice(8, 10)), dim = new Date(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 0).getDate();
  const proj = day > 1 ? st.ca / (day - 1) * dim : 0;
  let t = '☀️ <b>Lucas · brief du ' + Utilities.formatDate(new Date(), TZ, 'd/MM') + '</b>\n\n';
  const conf = c => c.conf_reply === 'ok' ? ' ✅' : c.conf_reply === 'decale' ? ' (veut décaler)' : c.conf_sent ? ' (message envoyé, pas de réponse)' : ' (pas confirmé)';
  t += '📞 <b>Calls aujourd\'hui : ' + callsToday.length + '</b>\n' + (callsToday.length ? callsToday.map(c => '• ' + hh(c) + ' ' + h(c.name) + (c.kind === 'client' ? ' (séance client)' : conf(c))).join('\n') + '\n' : '');
  if (tom.length) t += '🗓 Demain : ' + tom.length + ' call' + (tom.length > 1 ? 's' : '') + ' à confirmer\n';
  t += '\n🔁 <b>Relances à faire : ' + late.length + '</b>\n' + (late.length ? late.slice(0, 8).map(l => '• ' + h(l.name) + ' · ' + h(l.next_action || 'relance')).join('\n') + (late.length > 8 ? '\n• +' + (late.length - 8) + ' autres' : '') + '\n' : '');
  if (fu.length) t += '\n🔥 Follow-ups ouverts : ' + fu.length + (fuVal ? ' · ' + eur(fuVal) + ' sur la table' : '') + '\n';
  const nb = L.filter(l => nbDue(l, today));
  if (nb.length) t += '📝 Non bookés iClosed à relancer : ' + nb.length + '\n';
  if (toFill.length) t += '\n⚠️ <b>' + toFill.length + ' call' + (toFill.length > 1 ? 's' : '') + ' sans résultat</b> (à remplir)\n';
  t += '\n📊 <b>Mois en cours</b>\nCalls passés ' + st.calls + ' · show-up ' + (st.shows + st.noshow ? Math.round(100 * st.shows / (st.shows + st.noshow)) + ' %' : '–') + ' · ventes ' + st.ventes + ' · closing ' + (st.shows ? Math.round(100 * st.ventes / st.shows) + ' %' : '–') + '\nCA signé ' + eur(st.ca) + (obj ? ' / ' + eur(obj) + ' (projection ' + eur(proj) + ')' : '') + ' · encaissé ' + eur(st.cash) + '\n';
  const lastSale = L.filter(l => l.status === 'vendu' && l.sold_at).map(l => String(l.sold_at).slice(0, 10)).sort().pop();
  if (lastSale) {
    const n = Math.round((new Date(today + 'T12:00:00') - new Date(lastSale + 'T12:00:00')) / 86400000);
    // au-delà de 90 jours, les ventes n'étaient pas encore suivies dans la console : pas d'alerte
    if (n >= 4 && n <= 90) t += '\n' + (n >= 7 ? '🔴' : '🟠') + ' ' + n + ' jours sans vente (dernière le ' + lastSale.slice(8, 10) + '/' + lastSale.slice(5, 7) + ')\n';
  }
  t += '\n<a href="' + CONSOLE_URL + '">Ouvrir la console</a>';
  return t;
}

function soir(today) {
  const now = nowLocal();
  const ecartes = new Set(leadsNow().filter(l => l.status === 'ecarte').map(l => String(l.id)));
  const miss = dedupeCalls(callsNow()).filter(c => !ecartes.has(String(c.lead_id))).filter(c => String(c.call_at).slice(0, 10) === today && String(c.call_at).slice(0, 16) < now && c.kind !== 'client' && !cancelledCall(c) && !c.show)
    .sort((a, b) => String(a.call_at).localeCompare(String(b.call_at)));
  if (!miss.length) return '';
  return '🌙 <b>Lucas · ' + miss.length + ' call' + (miss.length > 1 ? 's' : '') + ' du jour sans résultat</b>\n' + miss.map(c => '• ' + String(c.call_at).slice(11, 16).replace(':', 'h') + ' ' + h(c.name)).join('\n') + '\n\nVenu ? Vendu ? Follow-up ? Objection ? 1 minute dans la console.\n<a href="' + CONSOLE_URL + '#today">Remplir</a>';
}

function out(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
