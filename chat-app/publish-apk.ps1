# Publish APK to GitHub Releases
#
# Usage:
#   .\publish-apk.ps1                    # Auto-increment patch version
#   .\publish-apk.ps1 -Version "1.2.3"   # Specific version
#   .\publish-apk.ps1 -SkipBuild         # Use existing APK
#
# Requirements:
#   - GitHub token in GH_TOKEN env var or .env file
#   - Java JDK 17+ and Android SDK
#   - git on PATH

param(
    [string]$Version = "",
    [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"

# Config
$REPO_OWNER = "AmiD4567"
$REPO_NAME = "chatursa.apk"
$APK_PATH = "app\build\outputs\apk\debug\app-debug.apk"

# Resolve paths
$SCRIPT_DIR = $PSScriptRoot  # C:\ChatServer\chat-app
$ROOT_DIR = Split-Path -Parent $PSScriptRoot  # C:\ChatServer (git repo root)
$ANDROID_DIR = Join-Path $SCRIPT_DIR "frontend\android"  # C:\ChatServer\chat-app\frontend\android
$FULL_APK_PATH = Join-Path $ANDROID_DIR $APK_PATH

# Get GitHub token from .env file in the script directory
$GH_TOKEN = $env:GH_TOKEN
if (-not $GH_TOKEN) {
    $envFile = Join-Path $SCRIPT_DIR ".env"
    if (Test-Path $envFile) {
        $envContent = Get-Content $envFile
        foreach ($line in $envContent) {
            if ($line -match '^GH_TOKEN=(.+)') {
                $GH_TOKEN = $matches[1]
                break
            }
        }
    }
}
if (-not $GH_TOKEN -or $GH_TOKEN -eq "your_token_here") {
    Write-Error "GH_TOKEN not set. Set it in .env file or environment variable."
    exit 1
}

# 1. Determine version
if (-not $Version) {
    $APK_VERSION_FILE = Join-Path $ANDROID_DIR "app\build.gradle"
    $content = Get-Content $APK_VERSION_FILE -Raw
    if ($content -match 'versionName\s+"([^"]+)"') {
        $currentVer = $matches[1]
        $parts = $currentVer.Split('.')
        $patch = [int]$parts[$parts.Length - 1] + 1
        $Version = "$($parts[0..($parts.Length-2)] -join '.').$patch"
    } else {
        $Version = "1.0.1"
    }
    Write-Host "Auto-incremented version: $Version"
}

$TAG = "v$Version"
Write-Host "=== Publishing APK $TAG to $REPO_OWNER/$REPO_NAME ==="

# 2. Update version in build.gradle and AppConfig.kt
$buildGradle = Join-Path $ANDROID_DIR "app\build.gradle"
$content = Get-Content $buildGradle -Raw
$currentCode = if ($content -match 'versionCode (\d+)') { [int]$matches[1] } else { 0 }
$content = $content -replace 'versionCode \d+', "versionCode $($currentCode + 1)"
$content = $content -replace 'versionName "[^"]*"', "versionName `"$Version`""
Set-Content $buildGradle $content

$appConfigFile = Join-Path $ANDROID_DIR "app\src\main\java\com\chatursa\app\AppConfig.kt"
$configContent = Get-Content $appConfigFile -Raw
$configContent = $configContent -replace 'val APP_VERSION: String get\(\) = "[^"]*"', "val APP_VERSION: String get() = `"$Version`""
Set-Content $appConfigFile $configContent

# 3. Build APK (unless skipped)
if (-not $SkipBuild) {
    Write-Host "Building APK..."
    Set-Location $ANDROID_DIR
    & .\gradlew.bat assembleDebug
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Build failed!"
        exit 1
    }
}

if (-not (Test-Path $FULL_APK_PATH)) {
    Write-Error "APK not found at $FULL_APK_PATH"
    exit 1
}

# 4. Check if release already exists
Write-Host "Checking existing releases..."
$headers = @{
    "Authorization" = "token $GH_TOKEN"
    "Accept" = "application/vnd.github.v3+json"
}
$existingRelease = $null
try {
    $releasesUrl = "https://api.github.com/repos/$REPO_OWNER/$REPO_NAME/releases"
    $releases = Invoke-RestMethod -Uri $releasesUrl -Headers $headers -Method Get
    $existingRelease = $releases | Where-Object { $_.tag_name -eq $TAG }
} catch {}

# 5. Create or update release
if ($existingRelease) {
    Write-Host "Release $TAG already exists, updating..."
    $releaseId = $existingRelease.id
    # Delete old assets
    foreach ($asset in $existingRelease.assets) {
        Write-Host "  Deleting old asset: $($asset.name)"
        Invoke-RestMethod -Uri "https://api.github.com/repos/$REPO_OWNER/$REPO_NAME/releases/assets/$($asset.id)" `
            -Headers $headers -Method Delete | Out-Null
    }
} else {
    Write-Host "Creating release $TAG..."
    $body = @{
        tag_name = $TAG
        name = $TAG
        body = "ChatUrsa Android v$Version - Debug build for testing"
    } | ConvertTo-Json
    $response = Invoke-RestMethod -Uri "https://api.github.com/repos/$REPO_OWNER/$REPO_NAME/releases" `
        -Headers $headers -Method Post -Body $body -ContentType "application/json"
    $releaseId = $response.id
}

# 6. Upload APK
Write-Host "Uploading APK..."
$uploadUrl = "https://uploads.github.com/repos/$REPO_OWNER/$REPO_NAME/releases/$releaseId/assets?name=chatursa-$Version-debug.apk"
$apkBytes = [System.IO.File]::ReadAllBytes($FULL_APK_PATH)
$uploadHeaders = @{
    "Authorization" = "token $GH_TOKEN"
    "Content-Type" = "application/vnd.android.package-archive"
}
try {
    $uploadResult = Invoke-RestMethod -Uri $uploadUrl -Headers $uploadHeaders -Method Post -Body $apkBytes
    Write-Host "Upload successful! Download URL: $($uploadResult.browser_download_url)"
} catch {
    Write-Error "Upload failed: $_"
    exit 1
}

# 7. Git commit version bump
Write-Host "Committing version bump..."
Set-Location $ROOT_DIR
git add "chat-app/frontend/android/app/build.gradle"
git add "chat-app/frontend/android/app/src/main/java/com/chatursa/app/AppConfig.kt"
git commit -m "Bump Android version to $Version"
git tag -a "$TAG-apk" -m "Android v$Version"

Write-Host ""
Write-Host "=== Done! ==="
Write-Host "Version: $Version"
Write-Host "Release: https://github.com/$REPO_OWNER/$REPO_NAME/releases/tag/$TAG"
Write-Host "APK URL (for in-app update): https://github.com/$REPO_OWNER/$REPO_NAME/releases/download/$TAG/chatursa-$Version-debug.apk"
