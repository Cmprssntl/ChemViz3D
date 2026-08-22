# ChemViz3D - Android Build Guide

This directory is an independent Android copy. Its `src/` and bundled WebView assets are maintained here and do not reference the `main` worktree.

## Prerequisites

1. **Android SDK**
   - Installed path: `/home/cmprssntl/Android/Sdk`
   - Required packages: Android SDK Platform 34 and Build Tools 34.0.0

2. **JDK 17**
   - Installed path: `/usr/lib/jvm/java-17-openjdk-amd64`
   - The project compiles Java and Kotlin with target 17.

3. **Gradle 8.4**
   - Wrapper files are stored in `gradlew` and `gradle/wrapper/`.
   - The wrapper and dependency cache are kept under this project via `GRADLE_USER_HOME`.
   - `settings.gradle.kts` and `build.gradle.kts` include the configured Maven mirrors.

## Build Steps

### Option A: Using Android Studio (Recommended)

1. Open Android Studio
2. Click **File → Open** → select `ChemViz3D-Android/`
3. Wait for Gradle sync to complete
4. Connect an Android device (USB debugging enabled) or start an emulator
5. Click **Run ▶** (green triangle)

### Option B: Command Line

```bash
# Build debug APK with the fixed local environment
./build-apk.sh

# The APK will be at:
# app/build/outputs/apk/debug/app-debug.apk

# 4. Install on connected device
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

## Troubleshooting

| Error | Solution |
|-------|----------|
| `Failed to find Build Tools` | Run `sdkmanager "build-tools;34.0.0"` |
| `Failed to find platform` | Run `sdkmanager "platforms;android-34"` |
| `JAVA_HOME not set` | Set JAVA_HOME to JDK 17 path, e.g. `C:\Program Files\Microsoft\jdk-17.0.2` |
| `gradlew: command not found` | Run `chmod +x gradlew build-apk.sh` in the project directory |

After changing the independent TypeScript source, run `npm run build`, then copy the generated JS/CSS bundle and RDKit files into `app/src/main/assets/webapp/` before running `./build-apk.sh`.
