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
fun RowScope.RaceCardIdentity(logoUrl: String?, title: @Composable () -> Unit, details: @Composable ColumnScope.() -> Unit, countryCode: String? = null, stackedFlag: Boolean = false) {
    if (stackedFlag) Column(Modifier.width(36.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(3.dp)) {
        // Sin logo no se reserva el hueco de 32 dp: la bandera sube a la parte
        // superior de la card, junto a la primera línea del título (paridad iOS).
        if (logoUrl != null) Box(Modifier.size(32.dp)) { RaceLogo(logoUrl, size = 32.dp) }
        Box(Modifier.height(16.dp), contentAlignment = Alignment.Center) { CountryFlag(countryCode) }
    } else RaceLogo(logoUrl, size = 36.dp)
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

@Composable
fun RaceCompetitionIdentity(name: String, logoUrl: String?, countryCode: String?, hideFlag: Boolean = false, showFemale: Boolean = false, onBack: () -> Unit) {
    // Todo arriba aunque el nombre ocupe varias líneas, como en Hoy de Ciclocross.
    Row(verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        IconButton(onClick = onBack, modifier = Modifier.size(32.dp)) {
            Icon(Icons.AutoMirrored.Filled.ArrowBack, androidx.compose.ui.res.stringResource(app.calendariociclismo.android.R.string.action_back), Modifier.size(18.dp))
        }
        RaceLogo(url = logoUrl, size = 44.dp)
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                if (!hideFlag) CountryFlag(countryCode, modifier = Modifier.padding(top = 7.dp))
                Text(name, style = MaterialTheme.typography.titleLarge, fontWeight = androidx.compose.ui.text.font.FontWeight.Medium, maxLines = 3,
                    overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                if (showFemale) {
                    val femaleDescription = androidx.compose.ui.res.stringResource(app.calendariociclismo.android.R.string.season_female_indicator_cd)
                    Text("♀", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.tertiary,
                        modifier = Modifier.semantics { contentDescription = femaleDescription })
                }
            }
        }
    }
}
