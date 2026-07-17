# ChemViz3D - Android Build Guide

## Prerequisites

1. **Android Studio** (or Android command-line tools)
   - Download from: https://developer.android.com/studio
   - During installation, install **Android SDK Platform 34** and **Build Tools 34.0.0**

2. **Java 17+** (OpenJDK recommended)
   - The project uses Java 17 for compilation

## Build Steps

### Option A: Using Android Studio (Recommended)

1. Open Android Studio
2. Click **File → Open** → select `ChemViz3D-Android/`
3. Wait for Gradle sync to complete
4. Connect an Android device (USB debugging enabled) or start an emulator
5. Click **Run ▶** (green triangle)

### Option B: Command Line

```bash
# 1. Set Android SDK path
set ANDROID_HOME=C:\Users\mc_wu\AppData\Local\Android\Sdk

# 2. Generate Gradle wrapper (first time only)
gradle wrapper --gradle-version 8.4

# 3. Build debug APK
gradlew assembleDebug

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
| `gradlew: command not found` | First run `gradle wrapper` in the project directory |
