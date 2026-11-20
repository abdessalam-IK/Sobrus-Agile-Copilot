/**
 * Sobrus AI Copilot — envoi du Sheet « Taux d'Occupation Sobrus » au Copilot.
 *
 * Installation (une seule fois) :
 *   1. Extensions → Apps Script → nouveau fichier « Copilot » → coller ce code → Enregistrer.
 *   2. Choisir la fonction « installerCopilot » dans la liste en haut, puis « Exécuter » et autoriser.
 * Ensuite, les onglets Config, Manual_Input et Raw_Calendar sont envoyés au Copilot toutes les 30 minutes
 * (lecture seule : le script ne modifie rien dans le Sheet).
 */
const COPILOT_URL = 'https://sobrus-agile-copilot.vercel.app/api/sheets';
const COPILOT_TOKEN = 'REMPLACER_PAR_LE_CODE';
const COPILOT_TABS = ['Config', 'Manual_Input', 'Raw_Calendar'];

/** Envoie les onglets au Copilot. */
function envoyerAuCopilot() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const tabs = {};
  COPILOT_TABS.forEach(function (name) {
    const sheet = ss.getSheetByName(name);
    tabs[name] = sheet ? copilotCsv_(sheet.getDataRange().getDisplayValues()) : '';
  });
  const res = UrlFetchApp.fetch(COPILOT_URL, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ token: COPILOT_TOKEN, tabs: tabs }),
    muteHttpExceptions: true,
  });
  Logger.log(res.getResponseCode() + ' ' + res.getContentText());
  if (res.getResponseCode() !== 200) throw new Error('Copilot : ' + res.getContentText());
}

/** À exécuter une fois : programme l'envoi toutes les 30 minutes et fait un premier envoi. */
function installerCopilot() {
  ScriptApp.getProjectTriggers()
    .filter(function (t) { return t.getHandlerFunction() === 'envoyerAuCopilot'; })
    .forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('envoyerAuCopilot').timeBased().everyMinutes(30).create();
  envoyerAuCopilot();
}

function copilotCsv_(rows) {
  return rows.map(function (r) {
    return r.map(function (v) { return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(',');
  }).join('\n');
}
