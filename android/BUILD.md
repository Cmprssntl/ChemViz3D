# ChemViz3D - Android Build Guide

This directory is **only the Android shell** of the ChemViz3D repository. The
web application is built once at the repository root and copied into
`app/src/main/assets/webapp/`; there is no separate TypeScript source, Vite
config or `node_modules` here.

## What lives here

```
app/src/main/java/com/chemviz3d/MainActivity.kt   WebView shell, JS bridge
app/src/main/assets/webapp/                       build output (main repo)
app/src/main/res/                                 theme, launcher icon
```

`MainActivity` serves the bundle through `WebViewAssetLoader` from
`https://appassets.androidplatform.net/assets/webapp/index.html`, so the same
`assets/main.js` that runs on web and desktop also runs here.

## 1. Build the web bundle (repository root)

```bash
cd ..                       # repository root
node scripts/package.mjs android
```

That writes `release/android/` with `index.html`, `assets/main.js`,
`assets/style.css` and `platform.json`.

## 2. Sync it into the shell

```bash
cd android
./sync-webapp.sh            # defaults to ../release/android
# or: ./sync-webapp.sh /path/to/release/android
```

The script refuses to run if the bundle contains `import.meta` or a
`type="module"` script tag.

## 3. Build the APK

```bash
./build-apk.sh
# APK: app/build/outputs/apk/debug/app-debug.apk
```

`build-apk.sh` uses JDK 17 and the SDK under `/home/cmprssntl/Android/Sdk`
(override with `CHEMVIZ_JDK` / `CHEMVIZ_ANDROID_SDK`).

## Prerequisites

- Android SDK Platform 34 and Build Tools 34.0.0
- JDK 17
- Gradle wrapper (`gradlew`) and its cache under `GRADLE_USER_HOME`

## Troubleshooting

| Error | Solution |
|-------|----------|
| `Failed to find Build Tools` | `sdkmanager "build-tools;34.0.0"` |
| `Failed to find platform` | `sdkmanager "platforms;android-34"` |
| `JAVA_HOME not set` | Point it at JDK 17 |
| Blank screen after install | Re-run `./sync-webapp.sh`; check `assets/webapp/index.html` exists |

The app keeps AI settings and the AI cache in app-private storage
(`SharedPreferences` / `cacheDir`), and screenshots are written to
`Pictures/ChemViz3D` through MediaStore.
