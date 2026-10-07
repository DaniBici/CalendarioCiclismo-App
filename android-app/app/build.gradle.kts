import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.ksp)
}

if (file("google-services.json").exists()) {
    apply(plugin = "com.google.gms.google-services")
}

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
        applicationId = "app.calendariociclismo.android"
        minSdk = 26
        targetSdk = 36
        versionCode = 630
        versionName = "5.0.14"

        vectorDrawables { useSupportLibrary = true }

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
            versionNameSuffix = "-debug"
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
            ndk { debugSymbolLevel = "SYMBOL_TABLE" }
            buildConfigField("boolean", "PREMIUM_TEST_BUILD", "false")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    testOptions {
        unitTests {
            isIncludeAndroidResources = true
        }
    }

    sourceSets.getByName("test").resources.directories += "schemas"

    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }
}

ksp {
    arg("room.schemaLocation", "$projectDir/schemas")
    arg("room.incremental", "true")
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.core.splashscreen)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)

    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.graphics)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.compose.material.icons.extended)
    implementation(libs.androidx.compose.material3.adaptive)
    implementation(libs.androidx.compose.material3.adaptive.navigation.suite)
    implementation(libs.androidx.navigation.compose)
    implementation(libs.google.android.material)
    debugImplementation(libs.androidx.compose.ui.tooling)

    implementation(libs.kotlinx.coroutines.core)
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.kotlinx.coroutines.play.services)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.supabase.postgrest.kt)
    implementation(libs.ktor.client.okhttp)
    implementation(libs.androidx.room.runtime)
    implementation(libs.androidx.room.ktx)
    ksp(libs.androidx.room.compiler)
    implementation(libs.androidx.datastore.preferences)
    implementation(libs.androidx.work.runtime.ktx)
    implementation(libs.androidx.browser)
    implementation(libs.androidx.appcompat)
    implementation(libs.coil.compose)
    implementation(libs.coil.network.okhttp)
    implementation(libs.coil.svg)

    implementation(platform(libs.firebase.bom))
    implementation(libs.firebase.messaging)
    implementation(libs.firebase.analytics)

    implementation(libs.billing.ktx)
    implementation(libs.play.review)
    implementation(libs.maplibre.android.sdk)
    implementation(libs.androidx.glance.appwidget)
    implementation(libs.androidx.glance.material3)

    testImplementation(libs.junit)
    testImplementation(libs.kotlinx.coroutines.test)
    testImplementation(libs.turbine)
    testImplementation(libs.robolectric)
    testImplementation(libs.androidx.test.core)
}
