/**
 * Sobrus AI Copilot — lecture du Sheet « Taux d'Occupation Sobrus ».
 * À coller dans Extensions → Apps Script (nouveau fichier « Copilot »), puis
 * Déployer → Nouveau déploiement → Application Web (Exécuter en tant que : Moi ; Accès : Tout le monde).
 * Renvoie en lecture seule les onglets Config, Manual_Input et Raw_Calendar, uniquement avec le bon code.
 */
const COPILOT_TOKEN = 'REMPLACER_PAR_LE_CODE';
const COPILOT_TABS = ['Config', 'Manual_Input', 'Raw_Calendar'];

function doGet(e) {
  const json = (o) => ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
  if (!e || !e.parameter || e.parameter.token !== COPILOT_TOKEN) return json({ error: 'Accès refusé' });
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const out = { updatedAt: new Date().toISOString(), tabs: {} };
  COPILOT_TABS.forEach(function (name) {
    const sheet = ss.getSheetByName(name);
    out.tabs[name] = sheet ? copilotCsv_(sheet.getDataRange().getDisplayValues()) : '';
  });
  return json(out);
}

function copilotCsv_(rows) {
  return rows.map(function (r) {
    return r.map(function (v) { return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(',');
  }).join('\n');
}
