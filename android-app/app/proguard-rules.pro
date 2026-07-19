# Proguard rules for release builds.

# Kotlinx Serialization — preservar clases anotadas con @Serializable.
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.AnnotationsKt
-keep,includedescriptorclasses class app.calendariociclismo.android.**$$serializer { *; }
-keepclassmembers class app.calendariociclismo.android.** {
    *** Companion;
}
-keepclasseswithmembers class app.calendariociclismo.android.** {
    kotlinx.serialization.KSerializer serializer(...);
}

# Coroutines
-keepnames class kotlinx.coroutines.internal.MainDispatcherFactory {}
-keepnames class kotlinx.coroutines.CoroutineExceptionHandler {}

# OkHttp / Ktor
-dontwarn okhttp3.**
-dontwarn okio.**
-dontwarn io.ktor.**
# Ktor usa reflexión para seleccionar el engine en runtime.
-keep class io.ktor.client.** { *; }
-keep class io.ktor.util.** { *; }
-keep class io.ktor.network.** { *; }

# Room
-keep class androidx.room.** { *; }

# Firebase Messaging
-keep class com.google.firebase.messaging.** { *; }

# Supabase Kotlin SDK — usa reflexión intensiva para serialización y routing.
-keep class io.github.jan.supabase.** { *; }
-dontwarn io.github.jan.supabase.**

# Coil 3 — usado en CCFirebaseMessagingService para BigPictureStyle.
-keep class coil3.** { *; }
-dontwarn coil3.**

# SLF4J — la implementación estática no está presente en Android (usa Logcat).
-dontwarn org.slf4j.impl.StaticLoggerBinder

# Conservar números de línea en stack traces de release para facilitar debugging.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile
