const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const M149_UNC = '\\\\m149\\C$\\Windows\\Temp';
const AS_DLL = 'C:\\Program Files\\Microsoft Power BI Report Server\\PBIRS\\ASEngine\\Microsoft.PowerBI.AdomdClient.dll';
const AS_CATALOG = '2cf44e75-ac00-4ea6-ac0d-9483b9fb5b7a_-2047017521';
const AS_CONN = `Data Source=localhost:5132;Catalog=${AS_CATALOG}`;

const MEASURES = [
  { key: 'wholesale2026',  idx: 10 },
  { key: 'wholesale2025',  idx: 11 },
  { key: 'retail2025',     idx: 16 },
  { key: 'retail2026',     idx: 17 },
  { key: 'wholesaleGrowth',idx: 28 },
  { key: 'retailGrowth',   idx: 29 },
  { key: 'chequeCount2026',idx: 44 },
  { key: 'chequeCount2025',idx: 45 },
];

function buildScript(outFile) {
  const indices = MEASURES.map(m => m.idx).join(',');
  const keys = MEASURES.map(m => `"${m.key}"`).join(',');
  return [
    `$asm = "${AS_DLL}"`,
    `[System.Reflection.Assembly]::LoadFrom($asm) | Out-Null`,
    `$conn = New-Object Microsoft.AnalysisServices.AdomdClient.AdomdConnection("${AS_CONN}")`,
    `$conn.Open()`,
    `$measures = $conn.Cubes[0].Measures`,
    `$indices = @(${indices})`,
    `$keys = @(${keys})`,
    `$result = @{}`,
    `$i = 0`,
    `foreach ($m in $measures) {`,
    `  $idx = [array]::IndexOf($indices, $i)`,
    `  if ($idx -ge 0) {`,
    `    try {`,
    `      $cmd = $conn.CreateCommand()`,
    `      $cmd.CommandText = "EVALUATE ROW(""V"", [$($m.Name)])"`,
    `      $reader = $cmd.ExecuteReader()`,
    `      $reader.Read() | Out-Null`,
    `      $val = $reader[0]`,
    `      $result[$keys[$idx]] = if ($val -eq [System.DBNull]::Value) { $null } else { $val }`,
    `      $reader.Close()`,
    `    } catch { $result[$keys[$idx]] = $null }`,
    `  }`,
    `  $i++`,
    `}`,
    `$conn.Close()`,
    `$result | ConvertTo-Json -Compress | Out-File "${outFile}" -Encoding UTF8`,
    `"DONE" | Out-File "${outFile}.done" -Encoding UTF8`,
  ].join('\n');
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function getKpiData() {
  const ts = Date.now();
  const outFile = `C:\\Windows\\Temp\\__kpi_out_${ts}.txt`;
  const psFile = `C:\\Windows\\Temp\\__kpi_${ts}.ps1`;
  const psScript = buildScript(outFile);

  const uncPs = path.join(M149_UNC, `__kpi_${ts}.ps1`);
  const uncOut = path.join(M149_UNC, `__kpi_out_${ts}.txt`);
  const uncDone = uncOut + '.done';

  try {
    fs.writeFileSync(uncPs, '\uFEFF' + psScript, 'utf8');

    execSync(
      `wmic /node:m149 /user:VLADICE\\amid /password:Pan1309Kris process call create "powershell.exe -ExecutionPolicy Bypass -File ${psFile}"`,
      { timeout: 30000, stdio: 'pipe' }
    );

    for (let i = 0; i < 60; i++) {
      await sleep(2000);
      if (fs.existsSync(uncDone)) break;
    }

    if (!fs.existsSync(uncOut)) return null;

    let raw = fs.readFileSync(uncOut, 'utf8');
    if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
    raw = raw.trim();
    if (!raw) return null;

    let json;
    try { json = JSON.parse(raw); }
    catch (e) { return null; }

    const data = {};
    for (const m of MEASURES) {
      const val = json[m.key];
      data[m.key] = val != null ? Number(val) : null;
    }
    return data;

  } finally {
    try { fs.unlinkSync(uncPs); } catch (e) {}
    try { fs.unlinkSync(uncOut); } catch (e) {}
    try { fs.unlinkSync(uncDone); } catch (e) {}
  }
}

module.exports = { getKpiData };
