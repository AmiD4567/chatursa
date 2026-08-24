#Requires -RunAsAdministrator
<#
.SYNOPSIS
  Отчёт «Кто входил на сервер и что делал в папке проекта» за период.
  HTML + CSV. Парсинг событий строго по XML-полям (EventData) —
  работает независимо от языка Windows.
  Запускать ОТ АДМИНИСТРАТОРА: чтение журнала Security требует прав.

.USAGE
  powershell -ExecutionPolicy Bypass -File ops\access-report.ps1 [-Days 7] [-Open]

.NOTES
  Требуется ранее выполненный ops\enable-folder-audit.ps1.
#>
param(
  [int]$Days = 7,
  [string]$ProjectPath = 'C:\ChatServer',
  [string]$OutDir = (Join-Path $PSScriptRoot 'reports'),
  # Учётки, чьи действия НЕ показываем (служебные). Дополните учёткой сервиса чата.
  [string[]]$ExcludeAccounts = @('SYSTEM', 'LOCAL SERVICE', 'NETWORK SERVICE'),
  [switch]$Open
)

$ErrorActionPreference = 'Stop'
$start = (Get-Date).AddDays(-$Days)
$normPath = $ProjectPath.TrimEnd('\')

function Get-EvtFields($event) {
  $x = [xml]$event.ToXml()
  $h = @{ }
  foreach ($d in $x.Event.EventData.Data) {
    if ($d.Name) { $h[$d.Name] = [string]$d.'#text' }
  }
  return $h
}

function HtmlEncode([string]$s) {
  if ($null -eq $s) { return '' }
  $s.Replace('&','&amp;').Replace('<','&lt;').Replace('>','&gt;').Replace('"','&quot;')
}

Write-Host "=== Отчёт доступа к '$ProjectPath' за последние $Days дн. ===" -ForegroundColor Cyan
Write-Host 'Читаем журнал Security...'

$events = Get-WinEvent -FilterHashtable @{
  LogName   = 'Security'
  Id        = 4624, 4625, 4659, 4660, 4663
  StartTime = $start
} -ErrorAction SilentlyContinue

if (-not $events) { $events = @() }
Write-Host ("Найдено событий: {0}" -f $events.Count)

# ── Разбор ──
$logons      = New-Object System.Collections.Generic.List[object]
$failLogons  = New-Object System.Collections.Generic.List[object]
$fileOps     = New-Object System.Collections.Generic.List[object]

foreach ($e in $events) {
  $f = Get-EvtFields $e

  switch ($e.Id) {

    4624 {  # Успешный вход: интересуют интерактив(2), RDP(10), сеть/шара(3)
      $ltRaw = $f['LogonType']; if (-not $ltRaw) { $ltRaw = 0 }
      $lt = [int]$ltRaw
      if ($lt -notin @(2, 3, 10)) { continue }
      $acct = $f['TargetUserName']
      if (-not $acct -or $acct.EndsWith('$') -or $ExcludeAccounts -contains $acct) { continue }
      $typeName = switch ($lt) { 2 {'Локальный'} 10 {'RDP'} 3 {'Сеть/шара'} default {"Тип $lt"} }
      $logons.Add([pscustomobject]@{
        Время    = $e.TimeCreated
        Учётка   = $acct
        Тип      = $typeName
        IP       = ($f['IpAddress'] -replace '-', '')
        Компьютер= $f['WorkstationName']
      })
    }

    4625 {  # Неудачная попытка входа — всегда показываем
      $ltRaw = $f['LogonType']; if (-not $ltRaw) { $ltRaw = 0 }
      $lt = [int]$ltRaw
      if ($lt -notin @(2, 3, 10)) { continue }
      $acct = $f['TargetUserName']
      if (-not $acct -or $acct.EndsWith('$')) { continue }
      failLogons.Add([pscustomobject]@{
        Время    = $e.TimeCreated
        Учётка   = $acct
        Тип      = "Тип $lt"
        IP       = ($f['IpAddress'] -replace '-', '')
        Причина  = $f['FailureReason']
      })
    }

    { $_ -in 4659, 4660, 4663 } {  # Файловые операции в проекте
      $obj = $f['ObjectName']
      if (-not $obj -or -not $obj.StartsWith($normPath, [StringComparison]::OrdinalIgnoreCase)) { continue }
      $subject = $f['SubjectUserName']
      if ($ExcludeAccounts -contains $subject) { continue }

      $op = switch ($e.Id) {
        4660 { '🗑 УДАЛЕНИЕ' }
        4659 { '⚠ Запрошено удаление' }
        default {
          $al = "$($f['AccessList'])"
          if     ($al -match '%%4417') { '✏ Изменение файла' }
          elseif ($al -match '%%4418') { '✏ Добавление данных' }
          elseif ($al -match '%%4424') { '📁 Удаление внутри папки' }
          elseif ($al -match '%%4423') { 'Атрибуты' }
          elseif ($al -match 'WDAC|WO') { '🔑 Смена прав/владельца' }
          else { 'Доступ' }
        }
      }

      fileOps.Add([pscustomobject]@{
        Время    = $e.TimeCreated
        Кто      = "$($f['SubjectDomainName'])\$subject"
        Операция = $op
        Путь     = $obj
        Процесс  = ($f['ProcessName'] -replace '^.*\\', '')
      })
    }
  }
}

if ($fileOps.Count -gt 1) {
  # 4659+4663 дублируют одно и то же действие рядом по времени от того же пользователя:
  # оставляем уникальные пары (кто+путь+операция) с точностью до секунды для чистоты отчёта.
  $fileOps = @($fileOps | Sort-Object Время | Group-Object Кто, Операция, Путь, { $_.Время.ToString('yyyyMMddHHmmss') } |
    ForEach-Object { $_.Group | Select-Object -First 1 })
}

# ── CSV ──
if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Path $OutDir | Out-Null }
$stamp = Get-Date -Format 'yyyyMMdd-HHmm'
$csvLogons = Join-Path $OutDir "logons-$stamp.csv"
$csvFiles  = Join-Path $OutDir "file-ops-$stamp.csv"
$logons    | Export-Csv -Path $csvLogons -NoTypeInformation -Encoding UTF8
$fileOps   | Export-Csv -Path $csvFiles -NoTypeInformation -Encoding UTF8

# ── Сводка по пользователям ──
$topUsers = @($fileOps | Group-Object Кто | Sort-Object Count -Descending |
  Select-Object @{n='Кто';e={$_.Name}}, @{n='Операций';e={$_.Count}})

# ── HTML ──
$tableStyle = '<style>
body{font-family:Segoe UI,Arial,sans-serif;margin:24px;background:#f5f6fa}
h2{border-bottom:2px solid #667eea;padding-bottom:6px;color:#333}
table{border-collapse:collapse;width:100%;margin-bottom:28px;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.12)}
th{background:#667eea;color:#fff;text-align:left;padding:8px 10px;font-size:13px}
td{padding:7px 10px;border-bottom:1px solid #eee;font-size:13px}
tr:hover td{background:#f0f2ff}
.danger{color:#c0392b;font-weight:600}.warn{color:#b9770e}
.meta{color:#777;font-size:13px}
</style>'

$secLogons = ''
foreach ($r in ($logons | Sort-Object Время -Descending)) {
  $secLogons += "<tr><td>$($r.Время)</td><td><b>$(HtmlEncode $r.Учётка)</b></td><td>$(HtmlEncode $r.Тип)</td><td>$(HtmlEncode $r.IP)</td><td>$(HtmlEncode $r.Компьютер)</td></tr>"
}
$secFail = ''
foreach ($r in ($failLogons | Sort-Object Время -Descending)) {
  $secFail += "<tr class='danger'><td>$($r.Время)</td><td>$(HtmlEncode $r.Учётка)</td><td>$(HtmlEncode $r.Тип)</td><td>$(HtmlEncode $r.IP)</td><td>$(HtmlEncode $r.Причина)</td></tr>"
}
$secOps = ''
foreach ($r in ($fileOps | Sort-Object Время -Descending)) {
  $cls = if ($r.Операция -like '*УДАЛЕНИЕ*') { 'danger' } elseif ($r.Операция -like '*Изменение*' -or $r.Операция -like '*Добавление*') { 'warn' } else { '' }
  $secOps += "<tr><td>$($r.Время)</td><td><b>$(HtmlEncode $r.Кто)</b></td><td class='$cls'>$(HtmlEncode $r.Операция)</td><td>$(HtmlEncode $r.Путь)</td><td>$(HtmlEncode $r.Процесс)</td></tr>"
}
$secTop = ''
foreach ($r in $topUsers) {
  $secTop += "<li><b>$(HtmlEncode $r.Кто)</b> — $($r.Операций) операций</li>"
}

$html = @"
<!DOCTYPE html><html><head><meta charset="utf-8"><title>Отчёт доступа — $ProjectPath</title>$tableStyle</head><body>
<h1>Отчёт доступа: $(HtmlEncode $ProjectPath)</h1>
<p class="meta">Период: $($start.ToString('dd.MM.yyyy HH:mm')) — $(Get-Date -Format 'dd.MM.yyyy HH:mm') · Сгенерирован: $(Get-Date -Format 'dd.MM.yyyy HH:mm:ss')</p>

<h2>👑 Активность по пользователям (файловые операции)</h2>
<ul>$secTop</ul>

<h2>📂 Действия в папке проекта ($($fileOps.Count))</h2>
<table><tr><th>Время</th><th>Кто</th><th>Операция</th><th>Путь</th><th>Процесс</th></tr>$secOps</table>

<h2>🔑 Входы на сервер ($($logons.Count))</h2>
<table><tr><th>Время</th><th>Учётка</th><th>Тип</th><th>IP</th><th>С рабочей станции</th></tr>$secLogons</table>

<h2 style="color:#c0392b">⛔ Неудачные попытки входа ($($failLogons.Count))</h2>
<table><tr><th>Время</th><th>Учётка</th><th>Тип</th><th>IP</th><th>Причина</th></tr>$secFail</table>

</body></html>
"@

$htmlFile = Join-Path $OutDir "folder-access-$stamp.html"
[System.IO.File]::WriteAllText($htmlFile, $html, [System.Text.Encoding]::UTF8)

Write-Host ''
Write-Host ("Входов: {0} (неудачных: {1}) · Файловых операций: {2}" -f $logons.Count, $failLogons.Count, $fileOps.Count)
Write-Host ("HTML: {0}" -f $htmlFile) -ForegroundColor Green
Write-Host ("CSV : {0}" -f $csvFiles)

if ($Open) { Start-Process $htmlFile }
