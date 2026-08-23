const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const M149_TEMP = '\\\\m149\\C$\\Windows\\Temp';
const REMOTE_OUTPUT = 'C:\\Windows\\Temp\\kpi-pbi-result.json';
const AS_DLL = 'C:\\Program Files\\Microsoft Power BI Report Server\\PBIRS\\ASEngine\\Microsoft.PowerBI.AdomdClient.dll';
const AS_CONN = 'Data Source=localhost:5132;Catalog=2cf44e75-ac00-4ea6-ac0d-9483b9fb5b7a_-2047017521';

const MEASURE_NAMES = {
  wholesale2025: 'Продажи 2025, всего с НДС "Опт"',
  wholesale2026: 'Продажи 2026, всего с НДС "Опт"',
  retail2025: 'Продажи 2025, всего с НДС "Розн"',
  retail2026: 'Продажи 2026, всего с НДС "Розн"',
  total2025: 'Продажи 2025, всего с НДС',
  total2026: 'Продажи 2026, всего с НДС',
  wholesaleGrowth: 'Продажи "Опт" всего с НДС 25-24',
  retailGrowth: 'Продажи Розн всего с НДС 25-24',
  // Try a few more that might exist
};

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function queryMeasures() {
  const keys = Object.keys(MEASURE_NAMES);
  const names = keys.map(k => MEASURE_NAMES[k]);
  
  // Build DAX query with escaped measure names
  const measureRows = names.map((n, i) => `"M${i}", [${n.replace(/"/g, '""')}]`).join(',\n    ');
  const dax = `EVALUATE ROW(\n    ${measureRows}\n)`;

  // Build PS script using a temp file for the DAX to avoid quoting issues
  const psScript = [
    `$asm = "${AS_DLL}"`,
    `[System.Reflection.Assembly]::LoadFrom($asm) | Out-Null`,
    `$conn = New-Object Microsoft.AnalysisServices.AdomdClient.AdomdConnection("${AS_CONN}")`,
    `$conn.Open()`,
    `$cmd = $conn.CreateCommand()`,
    `$dax = @'\n${dax}\n'@`,
    `$cmd.CommandText = $dax`,
    `$reader = $cmd.ExecuteReader()`,
    `$reader.Read() | Out-Null`,
    `$r = @{}`,
    `for ($i = 0; $i -lt $reader.FieldCount; $i++) {`,
    `  $val = $reader[$i]`,
    `  if ($val -eq [System.DBNull]::Value) { $val = $null }`,
    `  $r["M$i"] = $val`,
    `}`,
    `$reader.Close()`,
    `$conn.Close()`,
    `$r | ConvertTo-Json -Compress | Out-File "${REMOTE_OUTPUT}"`
  ].join('\n');

  // Write PS script locally first
  const localPs = path.join(__dirname, '..', 'backend', '_kpi_query.ps1');
  fs.writeFileSync(localPs, psScript, 'utf8');

  // Copy to m149
  const remotePs = 'C:\\Windows\\Temp\\_kpi_query.ps1';
  fs.copyFileSync(localPs, path.join(M149_TEMP, '_kpi_query.ps1'));

  // Execute via WMI
  console.log('Executing WMI...');
  execSync(
    `wmic /node:m149 /user:VLADICE\\amid /password:Pan1309Kris process call create "powershell.exe -ExecutionPolicy Bypass -File ${remotePs}"`,
    { timeout: 120000 }
  );

  // Wait for output
  console.log('Waiting for result...');
  let result = null;
  for (let i = 0; i < 30; i++) {
    await sleep(2000);
    if (fs.existsSync(path.join(M149_TEMP, 'kpi-pbi-result.json'))) {
      try {
        const raw = fs.readFileSync(path.join(M149_TEMP, 'kpi-pbi-result.json'), 'utf8');
        if (raw && raw.trim()) {
          result = JSON.parse(raw);
          console.log('Result received!');
          break;
        }
      } catch(e) { console.log('Parse error:', e.message); }
    }
    if (i % 5 === 0) process.stderr.write('.');
  }

  // Cleanup
  fs.unlinkSync(localPs);
  try { fs.unlinkSync(path.join(M149_TEMP, '_kpi_query.ps1')); } catch(e) {}
  try { fs.unlinkSync(path.join(M149_TEMP, 'kpi-pbi-result.json')); } catch(e) {}

  if (!result) {
    console.log('No result received');
    return null;
  }

  // Map results
  const data = {};
  for (let i = 0; i < keys.length; i++) {
    data[keys[i]] = result[`M${i}`] != null ? Number(result[`M${i}`]) : null;
  }
  return data;
}

queryMeasures().then(d => {
  if (d) {
    console.log('\n=== KPI Data ===');
    for (const [k, v] of Object.entries(d)) {
      console.log(`  ${k}: ${v != null ? v.toLocaleString('ru-RU', {maximumFractionDigits:2}) : 'N/A'}`);
    }
  }
}).catch(e => console.error('Error:', e.message));
