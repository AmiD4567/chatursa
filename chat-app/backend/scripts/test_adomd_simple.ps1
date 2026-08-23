trap {
    "TRAPPED: " + $_.Exception.Message | Out-File "C:\Windows\Temp\kpi_val.txt"
    continue
}

$asm = "C:\Program Files\Microsoft Power BI Report Server\PBIRS\ASEngine\Microsoft.PowerBI.AdomdClient.dll"
"Loading $asm..." | Out-File "C:\Windows\Temp\kpi_val.txt"

[System.Reflection.Assembly]::LoadFrom($asm) | Out-Null
"Assembly loaded" | Out-File "C:\Windows\Temp\kpi_val.txt" -Append

$connStr = "Data Source=localhost:5132;Catalog=2cf44e75-ac00-4ea6-ac0d-9483b9fb5b7a_-2047017521"
$conn = New-Object Microsoft.AnalysisServices.AdomdClient.AdomdConnection($connStr)
"Connecting..." | Out-File "C:\Windows\Temp\kpi_val.txt" -Append
$conn.Open()
"Connected!" | Out-File "C:\Windows\Temp\kpi_val.txt" -Append

$cmd = $conn.CreateCommand()
$cmd.CommandText = "EVALUATE ROW(""V"", 42)"
$reader = $cmd.ExecuteReader()
$reader.Read() | Out-Null
"Got: " + $reader[0].ToString() | Out-File "C:\Windows\Temp\kpi_val.txt" -Append
$reader.Close()
$conn.Close()
