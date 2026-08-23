const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const M149_TEMP = '\\\\m149\\C$\\Windows\\Temp';
const AS_DLL = 'C:\\Program Files\\Microsoft Power BI Report Server\\PBIRS\\ASEngine\\Microsoft.PowerBI.AdomdClient.dll';
const AS_CONN = 'Data Source=localhost:5132;Catalog=2cf44e75-ac00-4ea6-ac0d-9483b9fb5b7a_-2047017521';

// Simple test: get one measure
const dax = `EVALUATE ROW("V", [Продажи 2026, всего с НДС "Опт"])`;

const psScript = [
  `trap { "ERROR: " + $_.Exception.Message | Out-File "C:\\Windows\\Temp\\kpi_err.txt" }`,
  `$asm = "${AS_DLL}"`,
  `[System.Reflection.Assembly]::LoadFrom($asm) | Out-Null`,
  `$conn = New-Object Microsoft.AnalysisServices.AdomdClient.AdomdConnection("${AS_CONN}")`,
  `$conn.Open()`,
  `$cmd = $conn.CreateCommand()`,
  `$dax = @'\n${dax}\n'@`,
  `$cmd.CommandText = $dax`,
  `$reader = $cmd.ExecuteReader()`,
  `if ($reader.Read()) {`,
  `  $val = $reader[0]`,
  `  if ($val -eq [System.DBNull]::Value) { "null" } else { $val.ToString() } | Out-File "C:\\Windows\\Temp\\kpi_val.txt"`,
  `} else { "NO DATA" | Out-File "C:\\Windows\\Temp\\kpi_val.txt" }`,
  `$reader.Close()`,
  `$conn.Close()`
].join('\n');

fs.writeFileSync(path.join(__dirname, '_kpi_debug.ps1'), psScript, 'utf8');
fs.copyFileSync(path.join(__dirname, '_kpi_debug.ps1'), path.join(M149_TEMP, '_kpi_debug.ps1'));

execSync(
  `wmic /node:m149 /user:VLADICE\\amid /password:Pan1309Kris process call create "powershell.exe -ExecutionPolicy Bypass -File C:\\Windows\\Temp\\_kpi_debug.ps1"`,
  { timeout: 120000 }
);

// Wait and read
setTimeout(() => {
  console.log('=== Value ===');
  try { console.log(fs.readFileSync(path.join(M149_TEMP, 'kpi_val.txt'), 'utf8')); } catch(e) { console.log('No val:', e.message); }
  console.log('=== Error ===');
  try { console.log(fs.readFileSync(path.join(M149_TEMP, 'kpi_err.txt'), 'utf8')); } catch(e) { console.log('No err:', e.message); }
}, 30000);
