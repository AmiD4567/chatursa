const { execSync } = require('child_process');

try {
  const out = execSync(
    'wmic /node:m149 /user:VLADICE\\amid /password:Pan1309Kris process call create "powershell.exe -Command \\"echo test123 > C:\\Windows\\Temp\\__kpi_quick.txt; echo DONE > C:\\Windows\\Temp\\__kpi_quick.done\\""',
    { timeout: 30000, stdio: 'pipe' }
  );
  console.log('STDOUT:', out.toString());
  console.log('EXIT:', 0);
} catch (e) {
  console.log('ERROR:', e.message);
  console.log('STDOUT:', e.stdout ? e.stdout.toString() : 'null');
  console.log('STDERR:', e.stderr ? e.stderr.toString() : 'null');
  console.log('STATUS:', e.status);
}
