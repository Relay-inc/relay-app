# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface
# class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# Uncomment this to preserve the line number information for
# debugging stack traces.
#-keepattributes SourceFile,LineNumberTable

# If you keep the line number information, uncomment this to
# hide the original source file name.
#-renamesourcefileattribute SourceFile
# The sealed-secrets plugin (SealedPlugin.kt): found by name from Rust, its arguments filled by reflection
-keep class be.laurentmeersman.relay.mobile.SealedPlugin { *; }
-keep class be.laurentmeersman.relay.mobile.SealArgs { *; }
# ML Kit (the barcode scanner) finds its component registrars by name and makes them with their no-argument
# constructor; R8 removed those constructors, so scanning crashed in release builds (NoSuchMethodException, then an NPE)
-keep class * implements com.google.firebase.components.ComponentRegistrar { <init>(); }
-keep class com.google.mlkit.** { <init>(); }
