#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
JDK_DIR="${CHEMVIZ_JDK:-/usr/lib/jvm/java-17-openjdk-amd64}"
SDK_DIR="${CHEMVIZ_ANDROID_SDK:-/home/cmprssntl/Android/Sdk}"
if [[ ! -x "$JDK_DIR/bin/java" ]]; then echo "JDK 17 not found: $JDK_DIR" >&2; exit 1; fi
if [[ ! -d "$SDK_DIR/platforms/android-34" ]]; then echo "Android SDK platform 34 not found: $SDK_DIR" >&2; exit 1; fi
export JAVA_HOME="$JDK_DIR"
export ANDROID_HOME="$SDK_DIR"
export ANDROID_SDK_ROOT="$SDK_DIR"
export PATH="$JDK_DIR/bin:$SDK_DIR/platform-tools:$PATH"
export GRADLE_USER_HOME="${CHEMVIZ_GRADLE_HOME:-$PROJECT_DIR/.gradle}"
cd "$PROJECT_DIR"
./gradlew --no-daemon --console=plain :app:assembleDebug
APK="$PROJECT_DIR/app/build/outputs/apk/debug/app-debug.apk"
printf '\nAPK: %s\n' "$APK"
stat -c 'Size: %s bytes' "$APK"
sha256sum "$APK"
