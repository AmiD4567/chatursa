const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

async function main() {
  const M149_UNC = '\\\\m149\\C$\\Windows\\Temp';

  const ts = Date.now();
  const psFile = `C:\\Windows\\Temp\\__kpi_${ts}.ps1`;
  const outFile = `C:\\Windows\\Temp\\__kpi_out_${ts}.txt`;
  const doneFile = outFile + '.done';
  const uncPs = path.join(M149_UNC, `__kpi_${ts}.ps1`);
  const uncOut = path.join(M149_UNC, `__kpi_out_${ts}.txt`);
  const uncDone = uncOut + '.done';

  const psScript = [
    `trap { continue }`,
    `try {`,
    `  $asm = "C:\\Program Files\\Microsoft Power BI Report Server\\PBIRS\\ASEngine\\Microsoft.PowerBI.AdomdClient.dll"`,
    `  [System.Reflection.Assembly]::LoadFrom($asm) | Out-Null`,
    `  $conn = New-Object Microsoft.AnalysisServices.AdomdClient.AdomdConnection("Data Source=localhost:5132;Catalog=2cf44e75-ac00-4ea6-ac0d-9483b9fb5b7a_-2047017521")`,
    `  $conn.Open()`,
    `  $r = @{}`,
    `  $i = 0`,
    `  foreach ($m in $conn.Cubes[0].Measures) {`,
    `    try {`,
    `      $cmd = $conn.CreateCommand()`,
    `      $cmd.CommandText = "EVALUATE ROW(""V"", [$($m.Name)])"`,
    `      $reader = $cmd.ExecuteReader()`,
    `      $reader.Read() | Out-Null`,
    `      $val = $reader[0]`,
    `      if ($val -eq [System.DBNull]::Value) { $r["M$i"] = $null } else { $r["M$i"] = $val }`,
    `      $reader.Close()`,
    `    } catch { $r["M$i"] = $null }`,
    `    $i++`,
    `  }`,
    `  $conn.Close()`,
    `  $r | ConvertTo-Json -Compress | Out-File "${outFile}"`,
    `} catch { "ERROR: $_" | Out-File "${outFile}" }`,
    `"DONE" | Out-File "${doneFile}"`,
  ].join('\n');

  console.log('Writing ps1 to', uncPs);
  fs.writeFileSync(uncPs, psScript, 'utf8');
  console.log('PS1 written, size:', fs.statSync(uncPs).size);

  console.log('\nRunning wmic...');
  try {
    const out = execSync(
      `wmic /node:m149 /user:VLADICE\\amid /password:Pan1309Kris process call create "powershell.exe -ExecutionPolicy Bypass -File ${psFile}"`,
      { timeout: 30000, stdio: 'pipe' }
    );
    console.log('wmic stdout:', out.toString());
  } catch (e) {
    console.log('wmic error:', e.message);
    console.log('wmic stderr:', e.stderr ? e.stderr.toString() : '');
    console.log('wmic status:', e.status);
  }

  console.log('\nWaiting for done file...');
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 2000));
    console.log(`  Check ${i+1}: done=${fs.existsSync(uncDone)} out=${fs.existsSync(uncOut)}`);
    if (fs.existsSync(uncDone)) break;
  }

  if (fs.existsSync(uncOut)) {
    console.log('\n=== Output content ===');
    console.log(fs.readFileSync(uncOut, 'utf8').substring(0, 500));
  } else {
    console.log('\nNo output file found');
  }
}

main();

