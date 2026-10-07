package app.calendariociclismo.android.ui.month

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.PushPin
import androidx.compose.material.icons.outlined.PushPin
import androidx.compose.material3.AssistChip
import androidx.compose.material3.AssistChipDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import app.calendariociclismo.android.R
import app.calendariociclismo.android.ui.theme.CCRadius
import app.calendariociclismo.android.ui.theme.CCText

/**
 * Chips del Calendario (Mes, Temporada), Campeonatos y la agenda de
 * Ciclocross, sobre los componentes de Material 3. Espejo de
 * `CalendarFilterChipLabel`, `CalendarMonthChipLabel` y `CalendarSelectorLabel`
 * de iOS (`CalendarTabView.swift`).
 */

/**
 * Filtro de categoría (`.tcat-btn`): inactivo sobre la superficie de tarjeta
 * con texto secundario; activo con el acento al 15 % y texto de acento.
 * Chincheta del filtro predeterminado a la derecha.
 */
@Composable
fun CalendarFilterChip(
    label: String,
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    pinFilled: Boolean = false,
    pinOutline: Boolean = false,
) {
    val primary = MaterialTheme.colorScheme.primary
    FilterChip(
        selected = selected,
        onClick = onClick,
        label = {
            Text(
                text = label,
                style = CCText.S13,
                fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Medium,
            )
        },
        trailingIcon = when {
            pinFilled -> {
                { Icon(Icons.Filled.PushPin, contentDescription = null, tint = primary, modifier = Modifier.size(12.dp)) }
            }
            pinOutline -> {
                { Icon(Icons.Outlined.PushPin, contentDescription = null, tint = primary.copy(alpha = 0.55f), modifier = Modifier.size(12.dp)) }
            }
            else -> null
        },
        shape = RoundedCornerShape(CCRadius.Control),
        colors = FilterChipDefaults.filterChipColors(
            containerColor = MaterialTheme.colorScheme.surface,
            labelColor = MaterialTheme.colorScheme.onSurfaceVariant,
            selectedContainerColor = primary.copy(alpha = 0.15f),
            selectedLabelColor = primary,
        ),
        border = null,
        modifier = modifier,
    )
}

/** Mes del selector (`.cal-month-chip`): sin fondo en reposo; el activo con el acento al 15 %. */
@Composable
fun CalendarMonthChip(
    label: String,
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val primary = MaterialTheme.colorScheme.primary
    FilterChip(
        selected = selected,
        onClick = onClick,
        label = {
            Text(
                text = label,
                style = CCText.S14,
                fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Medium,
            )
        },
        shape = RoundedCornerShape(CCRadius.Control),
        colors = FilterChipDefaults.filterChipColors(
            containerColor = Color.Transparent,
            labelColor = MaterialTheme.colorScheme.onSurface,
            selectedContainerColor = primary.copy(alpha = 0.15f),
            selectedLabelColor = primary,
        ),
        border = null,
        modifier = modifier,
    )
}

/** Selector de año o país (`.temporada-select`): superficie de tarjeta y texto principal, sin acento. */
@Composable
fun CalendarSelectorChip(
    icon: ImageVector,
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    AssistChip(
        onClick = onClick,
        label = { Text(text = label, style = CCText.S13, fontWeight = FontWeight.SemiBold) },
        leadingIcon = { Icon(icon, contentDescription = null, modifier = Modifier.size(16.dp)) },
        shape = RoundedCornerShape(CCRadius.Control),
        colors = AssistChipDefaults.assistChipColors(
            containerColor = MaterialTheme.colorScheme.surface,
            labelColor = MaterialTheme.colorScheme.onSurface,
            leadingIconContentColor = MaterialTheme.colorScheme.onSurface,
        ),
        border = null,
        modifier = modifier,
    )
}

/**
 * Marca de la fila sintética de Campeonatos Nacionales: globo terráqueo
 * (Twemoji 1F30D, CC-BY 4.0, el mismo asset que iOS) en gris, en el hueco del
 * logotipo.
 */
@Composable
fun CalendarChampionshipsMark(modifier: Modifier = Modifier) {
    Box(modifier = modifier.size(28.dp), contentAlignment = Alignment.Center) {
        Icon(
            painter = painterResource(R.drawable.ic_globe_europe_africa),
            contentDescription = null,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.size(20.dp),
        )
    }
}
