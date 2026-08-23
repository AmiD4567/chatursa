Add-Type -Path "C:\Windows\Temp\Npgsql.dll"

$connString = "Host=192.168.210.133;Port=5432;Database=fmka;Username=analyst;Password=";
$outputFile = "C:\Windows\Temp\pg_tables.csv"

try {
    $conn = New-Object Npgsql.NpgsqlConnection($connString)
    $conn.Open()
    Write-Host "Connected to PostgreSQL!"

    $cmd = $conn.CreateCommand()
    $cmd.CommandText = "SELECT table_schema, table_name, table_type FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog', 'information_schema') ORDER BY table_schema, table_name"
    
    $reader = $cmd.ExecuteReader()
    $results = @()
    while ($reader.Read()) {
        $results += [PSCustomObject]@{
            Schema = $reader[0].ToString()
            Table = $reader[1].ToString()
            Type = $reader[2].ToString()
        }
    }
    $reader.Close()
    $conn.Close()

    $results | Export-Csv -Path $outputFile -NoTypeInformation
    Write-Host "Exported $($results.Count) tables to $outputFile"
    
    # Also output to stdout
    $results | Format-Table -AutoSize | Out-String -Width 200
}
catch {
    "ERROR: " + $_.Exception.Message | Out-File -FilePath "C:\Windows\Temp\pg_error.txt"
    Write-Host "Error: $($_.Exception.Message)"
}
