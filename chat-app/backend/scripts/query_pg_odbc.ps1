# Try ODBC connection to PostgreSQL
$outputFile = "C:\Windows\Temp\pg_odbc.csv"

try {
    # List available ODBC drivers
    $drivers = [System.Data.Odbc.OdbcConnection]::GetOdbcFactory().CreateConnection().GetSchema("DriverList")
    
    "Available ODBC drivers:" | Out-File -FilePath $outputFile
    foreach ($driver in $drivers) {
        $driver.Name | Out-File -FilePath $outputFile -Append
    }
    
    # Try connecting via ODBC
    $connString = "Driver={PostgreSQL Unicode};Server=192.168.210.133;Port=5432;Database=fmka;Uid=analyst;Pwd=;"
    $conn = New-Object System.Data.Odbc.OdbcConnection($connString)
    $conn.Open()
    "Connected via ODBC!" | Out-File -FilePath $outputFile -Append
    
    $cmd = $conn.CreateCommand()
    $cmd.CommandText = "SELECT table_schema, table_name FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog', 'information_schema')"
    $reader = $cmd.ExecuteReader()
    
    "Tables:" | Out-File -FilePath $outputFile -Append
    while ($reader.Read()) {
        $reader[0].ToString() + "." + $reader[1].ToString() | Out-File -FilePath $outputFile -Append
    }
    $reader.Close()
    $conn.Close()
}
catch {
    "ODBC Error: " + $_.Exception.Message | Out-File -FilePath $outputFile -Append
    
    # Try with different driver names
    $drivers = @("PostgreSQL", "PostgreSQL Unicode", "PostgreSQL ANSI", "psqlODBC")
    foreach ($d in $drivers) {
        try {
            $c = New-Object System.Data.Odbc.OdbcConnection("Driver={$d};Server=192.168.210.133;Port=5432;Database=fmka;Uid=analyst;Pwd=")
            $c.Open()
            "Connected with driver '$d'!" | Out-File -FilePath $outputFile -Append
            $c.Close()
            break
        } catch {
            "$d failed: $($_.Exception.Message)" | Out-File -FilePath $outputFile -Append
        }
    }
}
