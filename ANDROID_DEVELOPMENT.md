# Android development workflow

Layout: React source in `mobile/`, Android Studio project in `android/`. `mobile/capacitor.config.json` links them (`webDir: dist`, `android.path: ../android`).
All commands are PowerShell, run from `D:\RMH_Advisors_Internal_Tools\14_RMH_Alerts_Hub`.

## One-time setup
```powershell
cd mobile
npm install
Copy-Item .env.example .env.development   # VITE_CLOUD_API_URL (public cloud_api URL, not a secret)
Copy-Item .env.example .env.production    # both files are git-ignored
```
Needs JDK 21 (`java -version`) and the Android SDK (Android Studio installs it). Existing `android/local.properties` already points at the SDK.

## Development vs production (kept separate)
- `capacitor.config.json` never contains a dev URL. Live reload is injected **temporarily** by `cap run -l` and removed when you stop it; the generated `android/app/src/main/assets/capacitor.config.json` is git-ignored.
- `npm run build` refuses a production `VITE_CLOUD_API_URL` that is `http://`, localhost or a LAN address, then `scripts/check-prod.mjs` scans the output.
- `npm run build:sync` also scans the Android assets for live-reload URLs / cleartext. Always use it before a release.

## Commands
Start mobile development (browser preview, hot reload) — terminal 1, leave running:
```powershell
cd mobile; npm run dev            # http://localhost:5173
```
Live reload on the emulator — terminal 2 (dev server from terminal 1 must be running):
```powershell
cd mobile; npm run live:emulator  # emulator reaches your PC as 10.0.2.2
```
Live reload on a physical phone — terminal 2:
```powershell
cd mobile; npm run live:device    # picks your PC's LAN IP; choose the phone when asked
```
Build the React app (production):
```powershell
cd mobile; npm run build
```
Sync Capacitor (production build into the Android project):
```powershell
cd mobile; npm run build:sync
```
Open in Android Studio:
```powershell
cd mobile; npx cap open android
```
Start the emulator (AVD name from `emulator -list-avds`):
```powershell
& "$env:LOCALAPPDATA\Android\Sdk\emulator\emulator.exe" -avd Medium_Phone_API_37.0
```
Install & run the built app on the emulator/phone (no live reload):
```powershell
cd mobile; npm run build:sync; npx cap run android
```
Debug APK (`android\app\build\outputs\apk\debug\app-debug.apk`):
```powershell
cd mobile; npm run build:sync
cd ..\android; $env:JAVA_HOME = "C:\Program Files\Eclipse Adoptium\jdk-21.0.13.9-hotspot"; .\gradlew.bat assembleDebug
```
Production APK (`android\app\build\outputs\apk\release\app-release.apk`):
```powershell
cd mobile; npm run build:sync
cd ..\android; .\gradlew.bat assembleRelease
```
It is **unsigned** (cannot be installed) until you create a keystore once and `android\keystore.properties` (git-ignored; never commit either):
```powershell
keytool -genkeypair -v -keystore android\rmh-release.jks -alias rmh -keyalg RSA -keysize 2048 -validity 10000
# android\keystore.properties:
#   storeFile=rmh-release.jks
#   storePassword=...
#   keyAlias=rmh
#   keyPassword=...
```
Keep the keystore backed up somewhere safe: losing it means you cannot update an installed app.

## Physical phone
1. Phone: Settings > About phone > tap *Build number* 7 times; then Developer options > enable **USB debugging**.
2. Connect by USB, accept the "Allow USB debugging?" prompt (tick *Always allow*).
3. `& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" devices` must list the phone as `device` (not `unauthorized`).
4. For live reload the phone and PC must be on the same Wi-Fi. Allow inbound TCP 5173 in Windows Firewall (Private network) if the phone cannot load the page.
5. Run `npm run dev`, then `npm run live:device`.

## Firebase, API and device registration
- Firebase: `android/app/google-services.json` (client config, not a secret) and appId `com.rmhadvisors.dsctracker` are unchanged; no service-account key is in the app. Server-side FCM credentials stay on Render.
- API: the app calls `VITE_CLOUD_API_URL` (https) in both modes; live reload only changes where the *web assets* come from. The `cloud_api` CORS allows any origin, so the live-reload origin works.
- Registration: the app registers its FCM token with `/devices/register` after login (unchanged code). Push needs a real device or an emulator image with Google Play services, and the notification permission granted on Android 13+.
- Note: `13_DSC_Tracker/frontend/capacitor.config.json` also targets this `android/` folder. Sync only from `mobile/` to avoid overwriting assets with the old app.

## Verification status (honest)
Verified on 2026-11-13: `npm run build`, `npm run build:sync` (leak check passes), `gradlew assembleDebug` (BUILD SUCCESSFUL), and the dev server answering on the LAN address.
**Not yet verified:** live reload, app launch, API login, FCM registration/delivery on an emulator or phone. The emulator showed `unauthorized` in adb (needs the USB-debugging prompt accepted).
