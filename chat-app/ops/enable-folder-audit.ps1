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
# Через icacls SACL выставить нельзя — используем .NET FileSystemAuditRule.
# Everyone берём по SID S-1-1-0 с переводом в локализованное имя.
# Права: удаление файла и содержимого, запись/создание, атрибуты, смена прав и владельца.
# Чтение сознательно НЕ аудируем — иначе журнал утонет в событиях самого чат-сервера.
$everyone = (New-Object System.Security.Principal.SecurityIdentifier('S-1-1-0')).Translate([System.Security.Principal.NTAccount])
$rights = 'Delete, DeleteSubdirectoriesAndFiles, WriteData, AppendData, WriteAttributes, WriteExtendedAttributes, ChangePermissions, TakeOwnership'
$auditRule = New-Object System.Security.AccessControl.FileSystemAuditRule(
  $everyone, $rights, 'ContainerInherit', 'None', 'Success'
)
$acl = Get-Acl -LiteralPath $TargetPath

# убираем старые audit-правила для Everyone (идемпотентность при повторном запуске)
$acl.Audit | Where-Object { $_.IdentityReference -eq $everyone } | ForEach-Object { $acl.RemoveAuditRuleSpecific($_) } | Out-Null
$acl.SetAuditRule($auditRule)
Set-Acl -LiteralPath $TargetPath -AclObject $acl
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
