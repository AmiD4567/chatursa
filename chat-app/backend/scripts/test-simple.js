const fs = require('fs');
const path = require('path');

async function main() {
  const ts = Date.now();
  const outFile = `C:\\Windows\\Temp\\__kpi_out_${ts}.txt`;
  const doneFile = outFile + '.done';
  const psFile = `C:\\Windows\\Temp\\__kpi_${ts}.ps1`;
  const M149_UNC = '\\\\m149\\C$\\Windows\\Temp';

  const AS_DLL = 'C:\\Program Files\\Microsoft Power BI Report Server\\PBIRS\\ASEngine\\Microsoft.PowerBI.AdomdClient.dll';
  const AS_CATALOG = '2cf44e75-ac00-4ea6-ac0d-9483b9fb5b7a_-2047017521';

  // Try a simple single-measure DAX with the name that has quotes
  const dax = 'EVALUATE ROW("V", [Продажи 2025, всего с НДС "Опт"])';

  const psScript = [
    `$asm = "${AS_DLL}"`,
    `[System.Reflection.Assembly]::LoadFrom($asm) | Out-Null`,
    `$conn = New-Object Microsoft.AnalysisServices.AdomdClient.AdomdConnection("Data Source=localhost:5132;Catalog=${AS_CATALOG}")`,
    `$conn.Open()`,
    `$cmd = $conn.CreateCommand()`,
    `$cmd.CommandText = '${dax.replace(/'/g, "''")}'`,
    `try {`,
    `  $reader = $cmd.ExecuteReader()`,
    `  $reader.Read() | Out-Null`,
    `  $val = $reader[0]`,
    `  $reader.Close()`,
    `  "{""V"":" + $val + "}" | Out-File "${outFile}" -Encoding UTF8`,
    `} catch { "ERR: $_" | Out-File "${outFile}" -Encoding UTF8 }`,
    `$conn.Close()`,
    `"DONE" | Out-File "${doneFile}" -Encoding UTF8`,
  ].join('\n');

  const uncPs = path.join(M149_UNC, `__kpi_${ts}.ps1`);
  const uncOut = path.join(M149_UNC, `__kpi_out_${ts}.txt`);
  const uncDone = uncOut + '.done';

  // Write WITHOUT BOM
  fs.writeFileSync(uncPs, psScript, 'utf8');

  const { execSync } = require('child_process');
  execSync(
    `wmic /node:m149 /user:VLADICE\\amid /password:Pan1309Kris process call create "powershell.exe -ExecutionPolicy Bypass -File ${psFile}"`,
    { timeout: 30000, stdio: 'pipe' }
  );

  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 2000));
    if (fs.existsSync(uncDone)) break;
  }

  if (fs.existsSync(uncOut)) {
    const content = fs.readFileSync(uncOut, 'utf8');
    console.log('Output:', content.trim());
    // Parse to see if it's valid JSON
    if (content.trim().startsWith('{')) {
      try { console.log('Parsed:', JSON.parse(content.trim())); }
      catch(e) { console.log('Parse error:', e.message); }
    }
  } else {
    console.log('No output');
  }
}

main();
