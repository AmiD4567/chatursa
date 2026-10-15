# AGENTS.md

## Repository

Monorepo for the "Чат Ursa" chat app:
- `chat-app/backend/` — Node.js/Express + socket.io backend, SQLite (`chat.db` at repo root).
- `chat-app/frontend/` — React web client and the **native Android app**.
- `chat-app/frontend/android/` — native Kotlin + Jetpack Compose app (`com.chatursa.app`, v1.22).
- `scripts/` — Windows `.bat` helpers (server start, release build/upload).

## Android app

Project root: `chat-app/frontend/android`. Toolchain: AGP 8.13.0, Kotlin 2.0.21,
Gradle 8.14.5, compileSdk/targetSdk 36, minSdk 24. `JAVA_HOME` must be JDK 21
(`C:\Program Files\Eclipse Adoptium\jdk-21.0.11.10-hotspot\`) — the `java` on PATH is 26.

Android SDK: `C:\Users\amid\AppData\Local\Android\Sdk`; adb is at
`...\Sdk\platform-tools\adb.exe` and is **not on PATH**. AVD: `Medium_Phone`.

### Commands

```powershell
# from chat-app\frontend\android
.\gradlew.bat assembleDebug        # app\build\outputs\apk\debug\app-debug.apk
.\gradlew.bat assembleRelease
.\gradlew.bat bundleRelease
.\gradlew.bat lint
.\gradlew.bat testDebugUnitTest
```

Install/run/logs (full adb path):

```powershell
$adb = "C:\Users\amid\AppData\Local\Android\Sdk\platform-tools\adb.exe"
& $adb install -r "app\build\outputs\apk\debug\app-debug.apk"
& $adb shell am start -n com.chatursa.app/.MainActivity
& $adb logcat -d | Select-String com.chatursa
```

For UI-driven work use the `mobile-mcp` and `android` MCP servers configured in
`opencode.jsonc` (requires a running emulator/device). See the `android-dev` skill
in `.opencode/skills/android-dev/SKILL.md` for the full workflow and code map.

## Backend / web frontend

- Backend: `cd chat-app/backend; npm install; npm start` (or `scripts/start-backend.bat`).
- Web frontend: `cd chat-app/frontend; npm install; npm start` / `npm run build`.
- The Android app talks to a hardcoded server URL in
  `chat-app/frontend/android/app/src/main/java/com/chatursa/app/AppConfig.kt`.

## Conventions

- No comments in code unless necessary; match existing style.
- Do not commit secrets. Note: `scripts/build-release.bat` currently contains a hardcoded
  GitHub token — rotate it and move it to an env var.
