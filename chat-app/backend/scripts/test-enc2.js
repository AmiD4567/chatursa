const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const M149_UNC = '\\\\m149\\C$\\Windows\\Temp';
const AS_DLL = 'C:\\Program Files\\Microsoft Power BI Report Server\\PBIRS\\ASEngine\\Microsoft.PowerBI.AdomdClient.dll';
const AS_CATALOG = '2cf44e75-ac00-4ea6-ac0d-9483b9fb5b7a_-2047017521';
const AS_CONN = `Data Source=localhost:5132;Catalog=${AS_CATALOG}`;

const MEASURES = {
  wholesale2025:  `[Продажи 2025, всего с НДС "Опт"]`,
  wholesale2026:  `[Продажи 2026, всего с НДС "Опт"]`,
  retail2025:     `[Продажи 2025, всего с НДС Розн]`,
  retail2026:     `[Продажи 2026, всего с НДС Розн]`,
  retailGrowth:   `[Продажи Розн, всего с НДС 26/25]`,
  wholesaleGrowth:`[Продажи"Опт", всего с НДС 26/25]`,
  chequeCount2025:`[Колво чеков 2025]`,
  chequeCount2026:`[Колво чеков 2026]`,
};

function buildDax() {
  const cols = Object.entries(MEASURES)
    .map(([key, m]) => `"${key}", ${m}`)
    .join(', ');
  return `EVALUATE ROW(${cols})`;
}

async function main() {
  const ts = Date.now();
  const outFile = `C:\\Windows\\Temp\\__kpi_out_${ts}.txt`;
  const doneFile = outFile + '.done';
  const psFile = `C:\\Windows\\Temp\\__kpi_${ts}.ps1`;

  const dax = buildDax();
  console.log('DAX:');
  console.log(dax);

  // Write PS as a here-string with explicit UTF8 encoding
  const psScript = [
    `chcp 65001 > $null`,
    `$OutputEncoding = [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()`,
    `$asm = "${AS_DLL}"`,
    `[System.Reflection.Assembly]::LoadFrom($asm) | Out-Null`,
    `$conn = New-Object Microsoft.AnalysisServices.AdomdClient.AdomdConnection("${AS_CONN}")`,
    `$conn.Open()`,
    `$cmd = $conn.CreateCommand()`,
    `$dax = @"`,
    dax,
    `"@`,
    `$cmd.CommandText = $dax`,
    `try {`,
    `  $reader = $cmd.ExecuteReader()`,
    `  $reader.Read() | Out-Null`,
    `  $json = @{}`,
    `  for ($i = 0; $i -lt $reader.FieldCount; $i++) { $json[$reader.GetName($i)] = $reader[$i] }`,
    `  $reader.Close()`,
    `  $json | ConvertTo-Json -Compress | Out-File "${outFile}" -Encoding UTF8`,
    `} catch { "ERR: $_" | Out-File "${outFile}" -Encoding UTF8 }`,
    `$conn.Close()`,
    `"DONE" | Out-File "${doneFile}" -Encoding UTF8`,
  ].join('\n');

  // Write ps1 using PowerShell itself to handle encoding properly
  const writeCmd = `powershell.exe -Command "& { Set-Content -Path '${psFile}' -Value '${psScript.replace(/'/g, "''")}' -Encoding UTF8 }"`;
  // Too complex. Let me write via Node but with BOM
  const bom = '\uFEFF';
  const raw = bom + psScript;
  const uncPs = path.join(M149_UNC, `__kpi_${ts}.ps1`);
  const uncOut = path.join(M149_UNC, `__kpi_out_${ts}.txt`);
  const uncDone = uncOut + '.done';

  fs.writeFileSync(uncPs, raw, 'utf8');
  console.log('\nPS1 written, bytes:', fs.readFileSync(uncPs).length);

  try {
    execSync(
      `wmic /node:m149 /user:VLADICE\\amid /password:Pan1309Kris process call create "powershell.exe -ExecutionPolicy Bypass -File ${psFile}"`,
      { timeout: 30000, stdio: 'pipe' }
    );
  } catch (e) {
    console.log('wmic status:', e.status);
  }

  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 2000));
    if (fs.existsSync(uncDone)) break;
  }

  if (fs.existsSync(uncOut)) {
    console.log('\nOutput:');
    console.log(fs.readFileSync(uncOut, 'utf8'));
  } else {
    console.log('\nNo output file');
  }
}

main();
