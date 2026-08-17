import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.ksp)
}

// El plugin de Google Services se aplica solo si existe google-services.json,
// así podemos hacer builds debug sin configurar FCM todavía. Se aplica fuera
// del bloque `plugins {}` porque ese DSL no admite condicionales que evalúen
// ficheros en tiempo de configuración.
if (file("google-services.json").exists()) {
    apply(plugin = "com.google.gms.google-services")
}

// ─────────────────────────────────────────────────────────────────
//  Carga de secretos — Supabase URL/anon key y firma de release.
//  secrets.properties se ignora en git; en CI se inyecta via env vars.
// ─────────────────────────────────────────────────────────────────
val secretsFile = rootProject.file("secrets.properties")
val secrets = Properties().apply {
    if (secretsFile.exists()) load(secretsFile.inputStream())
}
fun secret(key: String, default: String = ""): String =
    secrets.getProperty(key) ?: System.getenv(key) ?: default

android {
    namespace = "app.calendariociclismo.android"
    compileSdk = 36

    defaultConfig {
        // applicationId idéntico al package registrado en Firebase (el que
        // aparece en `google-services.json` → `package_name`). El namespace
        // Kotlin (línea arriba) coincide a propósito para que todo encaje.
        applicationId = "app.calendariociclismo.android"
        minSdk = 26
        targetSdk = 36
        versionCode = 467
        versionName = "4.3.0"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        vectorDrawables { useSupportLibrary = true }

        // Expuestos a BuildConfig para que SupabaseService los lea en runtime.
        buildConfigField(
            "String",
            "SUPABASE_URL",
            "\"${secret("SUPABASE_URL", "https://bcecwlkynpgovnzhbpah.supabase.co")}\"",
        )
        buildConfigField(
            "String",
            "SUPABASE_ANON_KEY",
            "\"${secret("SUPABASE_ANON_KEY", "sb_publishable_4j0S4lUm6dYphrb0DEUYkw_OGAUoCLL")}\"",
        )
        // QA local: ID de test device de AdMob leído de secrets.properties (local,
        // gitignored). En CI/Play el secreto no existe → cadena vacía → no se
        // marca ningún dispositivo como test en producción. Permite probar la
        // unidad REAL en un release local sin generar tráfico inválido.
        buildConfigField(
            "String",
            "ADS_TEST_DEVICE_ID",
            "\"${secret("ADS_TEST_DEVICE_ID")}\"",
        )
    }

    signingConfigs {
        create("release") {
            val storeFilePath = secret("RELEASE_STORE_FILE")
            if (storeFilePath.isNotEmpty()) {
                storeFile = file(storeFilePath)
                storePassword = secret("RELEASE_STORE_PASSWORD")
                keyAlias = secret("RELEASE_KEY_ALIAS")
                keyPassword = secret("RELEASE_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        debug {
            isMinifyEnabled = false
            // No `applicationIdSuffix` — debug y release comparten el mismo
            // applicationId para que un único `google-services.json` (con el
            // paquete `app.calendariociclismo.android`) valga para ambos. Si
            // en el futuro queremos ejecutar debug y release en paralelo en
            // el mismo dispositivo, registramos `app.calendariociclismo.android.debug`
            // como segunda app Android en Firebase y restauramos el sufijo.
            versionNameSuffix = "-debug"
            // Sin PREMIUM_TEST_BUILD en Debug — sigue usando el toggle manual
            // (`debugSetSubscribed`) en Ajustes → Premium para activar/desactivar
            // el flag y poder probar tanto el flujo gratuito como el Premium.
            buildConfigField("boolean", "PREMIUM_TEST_BUILD", "false")
        }
        release {
            signingConfig = signingConfigs.getByName("release")
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
            // Incluye símbolos nativos en el AAB para que Play Console pueda
            // decodificar stack traces de ANR/fallos en librerías nativas.
            ndk { debugSymbolLevel = "SYMBOL_TABLE" }
            // PREMIUM_TEST_BUILD — desactivado al pasar a Beta abierta con
            // promo codes y suscripciones reales. Para builds de Internal
            // Testing donde quieras forzar el flag, ponlo temporalmente a
            // "true" y bumpa versionCode. NO subir a Play Store con true.
            // Equivalente al flag homónimo de iOS.
            buildConfigField("boolean", "PREMIUM_TEST_BUILD", "false")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    testOptions {
        unitTests {
            // Robolectric necesita recursos Android en los tests JVM (getString).
            isIncludeAndroidResources = true
        }
    }

    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }
}

// KSP — schema de Room exportado a un directorio versionable (útil para diffs).
ksp {
    arg("room.schemaLocation", "$projectDir/schemas")
    arg("room.incremental", "true")
}

dependencies {
    // Core
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.core.splashscreen)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)

    // Compose BOM + UI
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.graphics)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.compose.material.icons.extended)
    implementation(libs.androidx.navigation.compose)
    // Necesario solo por los estilos XML `Theme.Material3.*` que usa la
    // Activity como launching theme antes de que Compose monte el tema real.
    implementation(libs.google.android.material)
    debugImplementation(libs.androidx.compose.ui.tooling)

    // Coroutines
    implementation(libs.kotlinx.coroutines.core)
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.kotlinx.coroutines.play.services)

    // Serialization
    implementation(libs.kotlinx.serialization.json)

    // Supabase Kotlin SDK + Ktor client (solo Postgrest)
    implementation(libs.supabase.postgrest.kt)
    implementation(libs.ktor.client.okhttp)

    // Room (local cache / offline)
    implementation(libs.androidx.room.runtime)
    implementation(libs.androidx.room.ktx)
    ksp(libs.androidx.room.compiler)

    // DataStore (preferencias tipadas)
    implementation(libs.androidx.datastore.preferences)

    // WorkManager (sincronización offline en background)
    implementation(libs.androidx.work.runtime.ktx)

    // Browser (Custom Tabs — navegador interno para documentación)
    implementation(libs.androidx.browser)

    // AppCompat — solo para AppCompatDelegate.setApplicationLocales.
    implementation(libs.androidx.appcompat)

    // Coil (carga async de imágenes, rich notifications)
    implementation(libs.coil.compose)
    implementation(libs.coil.network.okhttp)
    implementation(libs.coil.svg)

    // Firebase Cloud Messaging + Analytics
    implementation(platform(libs.firebase.bom))
    implementation(libs.firebase.messaging)
    implementation(libs.firebase.analytics)

    // Google Play Billing (IAP — suscripciones Premium, Fase 6).
    implementation(libs.billing.ktx)

    // MapLibre GL Native — mapa del recorrido nativo (estilo vector OpenFreeMap, sin key).
    implementation(libs.maplibre.android.sdk)

    // Jetpack Glance — widget "Hoy en el ciclismo".
    implementation(libs.androidx.glance.appwidget)
    implementation(libs.androidx.glance.material3)

    // Testing
    testImplementation(libs.junit)
    testImplementation(libs.kotlinx.coroutines.test)
    testImplementation(libs.turbine)
    // Robolectric: Context real con recursos en tests JVM (RaceLogicTest resuelve strings).
    testImplementation(libs.robolectric)
    testImplementation(libs.androidx.test.core)
    androidTestImplementation(libs.androidx.junit)
    androidTestImplementation(libs.androidx.room.testing)
}
