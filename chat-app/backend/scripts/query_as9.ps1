$asmPath = "C:\Program Files\Microsoft Power BI Report Server\PBIRS\ASEngine\Microsoft.PowerBI.AdomdClient.dll"
[System.Reflection.Assembly]::LoadFrom($asmPath) | Out-Null
$connStr = "Data Source=localhost:5132;Catalog=2cf44e75-ac00-4ea6-ac0d-9483b9fb5b7a_-2047017521"
$conn = New-Object Microsoft.AnalysisServices.AdomdClient.AdomdConnection($connStr)
$conn.Open()
$out = "C:\Windows\Temp\as_result.txt"

"=== All measures ===" | Out-File $out -Encoding UTF8
$count = 0
foreach ($m in $conn.Cubes[0].Measures) {
    try {
        $cmd = $conn.CreateCommand()
        $cmd.CommandText = "EVALUATE ROW(""V"", [$($m.Name)])"
        $reader = $cmd.ExecuteReader()
        $reader.Read() | Out-Null
        $val = $reader[0].ToString()
        $reader.Close()
        "$($m.Name) = $val" | Out-File $out -Append -Encoding UTF8
        $count++
    } catch {
        "$($m.Name) = ERROR" | Out-File $out -Append -Encoding UTF8
    }
    if ($count -ge 15) { break }
}

"`n=== Dimension names ===" | Out-File $out -Append -Encoding UTF8
foreach ($dim in $conn.Cubes[0].Dimensions) {
    if ($dim.Name -eq "Measures") { continue }
    "`nDim: $($dim.Name)" | Out-File $out -Append -Encoding UTF8
    foreach ($h in $dim.Hierarchies) {
        "  Hierarchy: $($h.Name)" | Out-File $out -Append -Encoding UTF8
    }
}

$conn.Close()
