package app.calendariociclismo.android.ui.components

import androidx.compose.foundation.layout.*
import androidx.compose.animation.core.*
import androidx.compose.runtime.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.outlined.SportsScore
import androidx.compose.material3.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.unit.sp
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

@Composable
fun RowScope.RaceCardIdentity(logoUrl: String?, title: @Composable () -> Unit, details: @Composable ColumnScope.() -> Unit, countryCode: String? = null, stackedFlag: Boolean = false, logoPlaceholder: Boolean = false) {
    if (stackedFlag) Column(Modifier.width(36.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(3.dp)) {
        // Sin logo no se reserva el hueco de 32 dp: la bandera sube a la parte
        // superior de la card, junto a la primera línea del título (paridad iOS).
        if (logoUrl != null || logoPlaceholder) Box(Modifier.size(32.dp)) { RaceLogo(logoUrl, size = 32.dp, placeholder = logoPlaceholder) }
        Box(Modifier.height(16.dp), contentAlignment = Alignment.Center) { CountryFlag(countryCode, outlined = true) }
    } else RaceLogo(logoUrl, size = 36.dp, placeholder = logoPlaceholder)
    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) { title(); details() }
}

@Composable
fun WaitingResultsIndicator() {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
        Icon(Icons.Outlined.SportsScore, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(20.dp))
        WaitingDots()
    }
}

@Composable
private fun WaitingDots() {
    val animationsEnabled = android.animation.ValueAnimator.areAnimatorsEnabled()
    val transition = rememberInfiniteTransition(label = "waitingResults")
    val alpha by transition.animateFloat(
        initialValue = if (animationsEnabled) 0.35f else 1f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(
            animation = tween(650, easing = LinearEasing),
            repeatMode = androidx.compose.animation.core.RepeatMode.Reverse,
        ),
        label = "waitingResultsAlpha",
    )
    Text(
        "•••",
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        fontSize = 16.sp,
        modifier = Modifier.graphicsLayer { this.alpha = alpha },
    )
}

@Composable
fun RaceCardChevron() {
    Icon(Icons.Filled.ChevronRight, contentDescription = null,
        tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f), modifier = Modifier.size(20.dp))
}

/** «12 rondas», «6 etapas»: el recuento completo (número y nombre) en negrita. */
fun boldCountText(text: String): androidx.compose.ui.text.AnnotatedString =
    androidx.compose.ui.text.buildAnnotatedString {
        pushStyle(androidx.compose.ui.text.SpanStyle(fontWeight = androidx.compose.ui.text.font.FontWeight.Bold))
        append(text)
        pop()
    }

@Composable
fun RaceCompetitionIdentity(name: String, logoUrl: String?, countryCode: String?, hideFlag: Boolean = false, showFemale: Boolean = false, logoPlaceholder: Boolean = false, subtitle: (@Composable () -> Unit)? = null, onBack: () -> Unit) {
    // Todo arriba aunque el nombre ocupe varias líneas, como en Hoy de Ciclocross.
    // La flecha, el logo con la bandera debajo y el bloque de texto comparten el centro
    // vertical: la flecha y el texto viven en cajas de la altura de la columna del logo
    // (44 + 4 + 15 con bandera); con más líneas, el texto crece hacia abajo.
    val showsLogo = !logoUrl.isNullOrBlank() || logoPlaceholder
    val showsFlag = !hideFlag && !countryCode.isNullOrBlank()
    val leadingHeight = (if (showsLogo) 44.dp else 0.dp) + (if (showsLogo && showsFlag) 4.dp else 0.dp) + (if (showsFlag) 15.dp else 0.dp)
    Row(verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Box(Modifier.height(leadingHeight.coerceAtLeast(44.dp)), contentAlignment = Alignment.Center) {
            IconButton(onClick = onBack, modifier = Modifier.size(32.dp)) {
                Icon(Icons.AutoMirrored.Filled.ArrowBack, androidx.compose.ui.res.stringResource(app.calendariociclismo.android.R.string.action_back), Modifier.size(18.dp))
            }
        }
        // Logo con la bandera debajo, como las tarjetas de Hoy: con letra grande la
        // bandera no resta ancho al nombre.
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(4.dp)) {
            RaceLogo(url = logoUrl, size = 44.dp, placeholder = logoPlaceholder)
            if (!hideFlag) CountryFlag(countryCode)
        }
        Box(Modifier.weight(1f).heightIn(min = leadingHeight.coerceAtLeast(44.dp)), contentAlignment = Alignment.CenterStart) {
          // `subtitle`: línea bajo el nombre (rondas de un torneo de ciclocross; categoría, etapas y fechas de una carrera).
          Column {
            // El símbolo femenino va al final del mismo texto: no resta un hueco aparte al nombre.
            // En color secundario, como en Hoy, Últimos resultados, iOS y la web.
            val femaleColor = MaterialTheme.colorScheme.onSurfaceVariant
            val femaleSize = MaterialTheme.typography.labelMedium.fontSize
            val femaleDescription = if (showFemale) androidx.compose.ui.res.stringResource(app.calendariociclismo.android.R.string.season_female_indicator_cd) else null
            Text(
                text = androidx.compose.ui.text.buildAnnotatedString {
                    append(name)
                    if (showFemale) {
                        append(" ")
                        pushStyle(androidx.compose.ui.text.SpanStyle(color = femaleColor, fontSize = femaleSize))
                        append("♀")
                        pop()
                    }
                },
                style = MaterialTheme.typography.titleLarge,
                fontWeight = androidx.compose.ui.text.font.FontWeight.Medium,
                maxLines = 3,
                overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis,
                modifier = Modifier.semantics { femaleDescription?.let { contentDescription = "$name, $it" } },
            )
            subtitle?.invoke()
          }
        }
    }
}
