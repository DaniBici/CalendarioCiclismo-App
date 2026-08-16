package app.calendariociclismo.android.data.ads

import app.calendariociclismo.android.BuildConfig

/**
 * Punto único de configuración de AdMob (FASE B). Centraliza el App ID y los
 * Ad Unit IDs con un flag test/producción para no tener que tocar varias
 * pantallas cuando se cree la unidad real.
 *
 * Espejo del enum `AdsConfig` de iOS (`Services/AdsConfig.swift`).
 *
 * **Principio rector (`docs/memory/premium.md`):** todo lo de anuncios cuelga de
 * `PremiumService.shouldShowAds`; NUNCA de `featuresUnlocked`. Esta config solo
 * provee identificadores — el gate de si se inicializa/renderiza vive en la capa
 * que la consume.
 */
object AdsConfig {

    /** App ID de AdMob (Android). También declarado en AndroidManifest. */
    const val APP_ID = "ca-app-pub-7131748907832450~2001481990"

    /**
     * En Debug servimos SIEMPRE unidades de test de Google (evita impresiones
     * inválidas y posibles baneos de la cuenta durante el desarrollo). En
     * Release se usan las unidades reales.
     */
    private val USE_TEST_ADS = BuildConfig.DEBUG

    /** Unidad de test oficial de Google para banner adaptativo (Android). */
    private const val TEST_BANNER_UNIT_ID = "ca-app-pub-3940256099942544/6300978111"

    /**
     * Unidad real de banner (Android), creada en AdMob (bloque "Banner Android -
     * inline"). En Release se sirve esta; en Debug se fuerza la de test.
     */
    private const val PROD_BANNER_UNIT_ID = "ca-app-pub-7131748907832450/8172741311"

    /** Ad Unit ID del banner según el flag test/prod. */
    val bannerUnitId: String
        get() = if (USE_TEST_ADS || PROD_BANNER_UNIT_ID.isEmpty()) {
            TEST_BANNER_UNIT_ID
        } else {
            PROD_BANNER_UNIT_ID
        }
}
