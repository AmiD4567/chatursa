#Requires -RunAsAdministrator
<#
.SYNOPSIS
  Одноразовая настройка аудита доступа к папке проекта (кто что делал).
  Включает политику аудита файловой системы, вешает SACL на папку,
  увеличивает журнал Security. Запускать от администратора ОДИН РАЗ.

.USAGE
  powershell -ExecutionPolicy Bypass -File ops\enable-folder-audit.ps1 [-TargetPath C:\ChatServer] [-SecurityLogMb 256]

.NOTES
  Отключение аудита (если когда-нибудь понадобится):
    auditpol /set /subcategory:"{0CCE9217-69AE-11D9-BED3-505054503030}" /success:disable /failure:disable
#>
param(
  [string]$TargetPath = 'C:\ChatServer',
  [int]$SecurityLogMb = 256
)

$ErrorActionPreference = 'Stop'

# Защита от дурака: путь должен существовать
if (-not (Test-Path -LiteralPath $TargetPath)) {
  Write-Error "Путь не найден: $TargetPath"; exit 1
}

Write-Host '=== Аудит доступа к папке проекта ===' -ForegroundColor Cyan

# ── 1. Политика аудита: события доступа к файловой системе ──
# GUID {0CCE9217-...} = подкатегория File System — не зависит от языка Windows
auditpol /set /subcategory:"{0CCE9217-69AE-11D9-BED3-505054503030}" /success:enable /failure:enable | Out-Null
Write-Host '[1/3] Политика "Audit File System" включена (success + failure)'

# ── 2. SACL на папку: наследуется на всё дерево ──
# *S-1-1-0 = Everyone по SID (не зависит от локализации)
# DE=удаление, DC=удаление внутри, WD=запись данных, AD=создание файлов/папок,
# WEA/WA=атрибуты, WDAC=смена прав, WO=смена владельца.
# Чтение сознательно НЕ аудируем — иначе журнал утонет в событиях самого чат-сервера.
icacls $TargetPath /audit "*S-1-1-0:(OI)(CI)DE,DC,WD,AD,WEA,WA,WDAC,WO" | Out-Null
Write-Host "[2/3] SACL выставлен на '$TargetPath' (наследуется рекурсивно)"

# ── 3. Размер журнала Security ──
wevtutil sl Security /ms:$([int64]$SecurityLogMb * 1MB)
Write-Host ("[3/3] Журнал Security увеличен до {0} МБ" -f $SecurityLogMb)

Write-Host ''
Write-Host '=== Текущее состояние ===' -ForegroundColor Cyan
auditpol /get /subcategory:"{0CCE9217-69AE-11D9-BED3-505054503030}"
(Get-Acl -LiteralPath $TargetPath).Audit |
  Format-Table AuditType, IdentityReference, FileSystemRights, IsInherited -AutoSize | Out-String | Write-Host

Write-Host ''
Write-Host 'Готово. События начнут появляться в журнале Security сразу же.' -ForegroundColor Green
Write-Host 'Отчёт: powershell -File ops\access-report.ps1 -Days 7'
