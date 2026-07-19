package app.calendariociclismo.android.ui.ads

import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import com.google.android.gms.ads.AdRequest
import com.google.android.gms.ads.AdSize
import com.google.android.gms.ads.AdView
import app.calendariociclismo.android.data.ads.AdsConfig
import app.calendariociclismo.android.ui.rememberApp

/**
 * Banner adaptativo (anchored adaptive) de AdMob, envuelto en Compose vía
 * [AndroidView] — primer uso de interop View↔Compose en el proyecto.
 *
 * Espejo de `BannerAdView.swift` (iOS). El alto lo decide el propio formato
 * adaptativo según el ancho disponible, así que no se fija aquí.
 *
 * **Gate (defensa en profundidad):** además del gate en la pantalla que lo
 * monta, este componable lee `shouldShowAds` y no renderiza nada si el usuario
 * está suscrito. El SDK además solo se inicializa cuando `shouldShowAds` (ver
 * [app.calendariociclismo.android.data.ads.AdsConsentManager]); si por lo que
 * fuera se intentara cargar sin init, `loadAd` sería un no-op silencioso.
 */
@Composable
fun AdBanner(modifier: Modifier = Modifier) {
    val app = rememberApp()
    val shouldShowAds by app.premium.shouldShowAds.collectAsState()
    if (!shouldShowAds) return

    val context = LocalContext.current

    BoxWithConstraints(modifier = modifier.fillMaxWidth()) {
        // Ancho real disponible del banner (descontando el padding que aplique
        // la pantalla), en dp enteros — lo que pide el tamaño adaptativo.
        val adWidthDp = maxWidth.value.toInt().coerceAtLeast(1)

        // El AdView se crea una sola vez por ancho; recrearlo en cada
        // recomposición provocaría recargas y parpadeos.
        val adView = remember(adWidthDp) {
            AdView(context).apply {
                adUnitId = AdsConfig.bannerUnitId
                setAdSize(
                    AdSize.getCurrentOrientationAnchoredAdaptiveBannerAdSize(context, adWidthDp),
                )
                loadAd(AdRequest.Builder().build())
            }
        }

        // Liberar el AdView al salir de composición (o al recrearse por cambio
        // de ancho) para evitar fugas del WebView interno.
        DisposableEffect(adView) {
            onDispose { adView.destroy() }
        }

        AndroidView(
            factory = { adView },
            modifier = Modifier.fillMaxWidth(),
        )
    }
}
