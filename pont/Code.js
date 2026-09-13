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
const LEADS_HDR = ['ID', 'Créé le', 'MAJ', 'Prénom nom', 'Téléphone', 'E-mail', 'Source', 'Date du call', 'Statut', 'Qualifié /10', 'Besoin / situation', 'Objection', 'Action suivante', 'Date de relance', 'Prix proposé', 'Encaissé', 'Vendu le', 'Notes'];
const LEADS_KEYS = ['id', 'created', 'updated', 'name', 'phone', 'email', 'source', 'call_at', 'status', 'score', 'need', 'objection', 'next_action', 'next_at', 'price', 'paid', 'sold_at', 'notes'];

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
  return { ok: true, now: stamp(), leads: rows(sh, LEADS_KEYS) };
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

function out(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
