trap {
    "T: " + $_.Exception.Message | Out-File "C:\Windows\Temp\kpi_val3.txt"
    continue
}

$asm = "C:\Program Files\Microsoft Power BI Report Server\PBIRS\ASEngine\Microsoft.PowerBI.AdomdClient.dll"
[System.Reflection.Assembly]::LoadFrom($asm) | Out-Null
$conn = New-Object Microsoft.AnalysisServices.AdomdClient.AdomdConnection("Data Source=localhost:5132;Catalog=2cf44e75-ac00-4ea6-ac0d-9483b9fb5b7a_-2047017521")
$conn.Open()

# Get ALL measure names from ADOMD object model
foreach ($m in $conn.Cubes[0].Measures) {
    $m.Name | Out-File "C:\Windows\Temp\kpi_val3.txt" -Append
}

# Now try to query one
$cmd = $conn.CreateCommand()
$cmd.CommandText = "EVALUATE ROW(""V"", 1)"
$reader = $cmd.ExecuteReader()
$reader.Read() | Out-Null
"---" | Out-File "C:\Windows\Temp\kpi_val3.txt" -Append
"DAX test: " + $reader[0].ToString() | Out-File "C:\Windows\Temp\kpi_val3.txt" -Append
$reader.Close()
$conn.Close()
