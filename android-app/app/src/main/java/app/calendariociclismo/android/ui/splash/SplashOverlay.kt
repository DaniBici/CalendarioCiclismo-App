package app.calendariociclismo.android.ui.splash

import android.provider.Settings
import androidx.compose.animation.core.EaseIn
import androidx.compose.animation.core.EaseOut
import androidx.compose.animation.core.tween
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.calendariociclismo.android.R
import app.calendariociclismo.android.ui.components.AnimatedRouteProfile
import kotlinx.coroutines.delay

/**
 * Overlay de splash que replica el diseño de iOS:
 * fondo azul (#1A73E8), icono centrado, nombre + eslogan debajo.
 *
 * Animaciones:
 *   - El texto aparece con fade-in (0.25 s, easeOut).
 *   - Al cerrar: scale 1.0 → 1.6 + fade-out (0.4 s, easeIn).
 *
 * Se respeta `Settings.Global.ANIMATOR_DURATION_SCALE == 0` (el equivalente
 * Android de "reduce motion" en iOS).
 */
@Composable
fun SplashOverlay(
    dismissing: Boolean,
    onDismissed: () -> Unit,
) {
    val context = LocalContext.current
    val reduceMotion = remember {
        Settings.Global.getFloat(
            context.contentResolver,
            Settings.Global.ANIMATOR_DURATION_SCALE,
            1f,
        ) == 0f
    }

    // ── Texto: fade-in al aparecer ──
    var textVisible by remember { mutableStateOf(reduceMotion) }
    LaunchedEffect(Unit) { textVisible = true }

    val textAlpha by animateFloatAsState(
        targetValue = if (textVisible) 1f else 0f,
        animationSpec = tween(
            durationMillis = if (reduceMotion) 0 else 250,
            easing = EaseOut,
        ),
        label = "textAlpha",
    )

    // ── Cierre: scale up + fade out ──
    val scale by animateFloatAsState(
        targetValue = if (dismissing) 1.6f else 1f,
        animationSpec = tween(
            durationMillis = if (reduceMotion) 0 else 400,
            easing = EaseIn,
        ),
        label = "splashScale",
    )
    val alpha by animateFloatAsState(
        targetValue = if (dismissing) 0f else 1f,
        animationSpec = tween(
            durationMillis = if (reduceMotion) 0 else 400,
            easing = EaseIn,
        ),
        label = "splashAlpha",
    )

    // Callback tras la animación de cierre (0.4 s, igual que iOS).
    LaunchedEffect(dismissing) {
        if (dismissing) {
            if (reduceMotion) {
                onDismissed()
            } else {
                delay(400)
                onDismissed()
            }
        }
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .scale(scale)
            .alpha(alpha)
            .background(BrandBlue),
        contentAlignment = Alignment.Center,
    ) {
        // El perfil arranca tras el primer frame nativo: conserva el logo del
        // splash del sistema y prolonga su identidad dentro de Compose.
        AnimatedRouteProfile(
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .fillMaxWidth()
                .height(230.dp),
            lineColor = Color.White,
            fillColor = Color.White.copy(alpha = 0.15f),
            riderColor = Color.White,
        )

        // Icono centrado (mismo foreground que el adaptive icon).
        Image(
            painter = painterResource(R.drawable.ic_launcher_foreground),
            contentDescription = null,
            modifier = Modifier.size(120.dp),
        )

        // Texto debajo del icono, desplazado desde el centro.
        // iOS usa offset(y: 66) — 50 (mitad logo) + 6 (spacing) + ~10 (texto).
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            modifier = Modifier
                .offset(y = 66.dp)
                .alpha(textAlpha),
        ) {
            Text(
                text = stringResource(R.string.splash_app_name),
                fontSize = 22.sp,
                fontWeight = FontWeight.Bold,
                color = Color.White,
            )
            Spacer(modifier = Modifier.height(6.dp))
            Text(
                text = stringResource(R.string.splash_tagline),
                fontSize = 16.sp,
                color = Color.White.copy(alpha = 0.8f),
            )
        }
    }
}

private val BrandBlue = Color(0xFF1A73E8)
