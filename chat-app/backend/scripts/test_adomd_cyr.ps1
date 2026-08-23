trap {
    "TRAPPED: " + $_.Exception.Message | Out-File "C:\Windows\Temp\kpi_val2.txt"
    continue
}

$asm = "C:\Program Files\Microsoft Power BI Report Server\PBIRS\ASEngine\Microsoft.PowerBI.AdomdClient.dll"
[System.Reflection.Assembly]::LoadFrom($asm) | Out-Null
$conn = New-Object Microsoft.AnalysisServices.AdomdClient.AdomdConnection("Data Source=localhost:5132;Catalog=2cf44e75-ac00-4ea6-ac0d-9483b9fb5b7a_-2047017521")
$conn.Open()
$cmd = $conn.CreateCommand()

# Test with simple query first
$cmd.CommandText = "EVALUATE ROW(""V"", [Продажи 2026, всего с НДС ""Опт""])"
try {
    $reader = $cmd.ExecuteReader()
    if ($reader.Read()) {
        "OK: " + $reader[0].ToString() | Out-File "C:\Windows\Temp\kpi_val2.txt"
    }
    $reader.Close()
} catch {
    "ERR1: " + $_.Exception.Message | Out-File "C:\Windows\Temp\kpi_val2.txt"
}

# Try with single quotes around the measure name
$cmd2 = $conn.CreateCommand()
$cmd2.CommandText = "EVALUATE ROW(""V"", 'Продажи 2026, всего с НДС "Опт"'[Продажи 2026, всего с НДС "Опт"])"
try {
    $reader2 = $cmd2.ExecuteReader()
    if ($reader2.Read()) {
        "OK2: " + $reader2[0].ToString() | Out-File "C:\Windows\Temp\kpi_val2.txt" -Append
    }
    $reader2.Close()
} catch {
    "ERR2: " + $_.Exception.Message | Out-File "C:\Windows\Temp\kpi_val2.txt" -Append
}

# Get all measure names
$cmd3 = $conn.CreateCommand()
$cmd3.CommandText = "SELECT MEASURE_NAME, MEASURE_CAPTION FROM $system DISCOVER_MEASURES WHERE CUBE_NAME = 'Model'"
try {
    $reader3 = $cmd3.ExecuteReader()
    "Measures from DISCOVER:" | Out-File "C:\Windows\Temp\kpi_val2.txt" -Append
    while ($reader3.Read()) {
        $reader3[0].ToString() + " | " + $reader3[1].ToString() | Out-File "C:\Windows\Temp\kpi_val2.txt" -Append
    }
    $reader3.Close()
} catch {
    "ERR3: " + $_.Exception.Message | Out-File "C:\Windows\Temp\kpi_val2.txt" -Append
}

$conn.Close()
