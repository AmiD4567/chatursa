$asm = "C:\Program Files\Microsoft Power BI Report Server\PBIRS\ASEngine\Microsoft.PowerBI.AdomdClient.dll"
[System.Reflection.Assembly]::LoadFrom($asm) | Out-Null
$conn = New-Object Microsoft.AnalysisServices.AdomdClient.AdomdConnection("Data Source=localhost:5132;Catalog=2cf44e75-ac00-4ea6-ac0d-9483b9fb5b7a_-2047017521")
$conn.Open()
$cmd = $conn.CreateCommand()
$cmd.CommandText = @"
EVALUATE ROW("V", [Продажи 2026, всего с НДС "Опт"])
"@
try {
    $reader = $cmd.ExecuteReader()
    if ($reader.Read()) {
        $val = $reader[0]
        if ($val -eq [System.DBNull]::Value) { "" } else { $val.ToString() } | Out-File "C:\Windows\Temp\kpi_val.txt"
    }
    $reader.Close()
} catch {
    "QUERY ERROR: " + $_.Exception.Message | Out-File "C:\Windows\Temp\kpi_val.txt"
}
$conn.Close()
