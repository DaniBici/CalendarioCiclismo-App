package app.calendariociclismo.android.ui.stage

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.LocalRippleConfiguration
import androidx.compose.material3.RippleConfiguration
import androidx.compose.material3.TextButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Stable
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.calendariociclismo.android.ui.components.CCCard
import app.calendariociclismo.android.ui.theme.CCRadius
import app.calendariociclismo.android.ui.theme.CCText
import kotlin.math.abs

/**
 * Paneles de la jornada (Perfil, Puntos clave, Televisión, Descripción):
 * superficie de tarjeta, cabecera de altura común con el título a 16
 * seminegrita y acciones de texto a la derecha, separada del contenido por un
 * filete. Espejo de `.stage-profile-heading` en `css/app.css`.
 */
@Composable
internal fun StagePanel(
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit,
) {
    CCCard(modifier = modifier.fillMaxWidth()) {
        Column(Modifier.fillMaxWidth(), content = content)
    }
}

/** Altura mínima común de las cabeceras de panel (48 px en la web). */
internal val PanelHeaderMinHeight = 48.dp

@Composable
internal fun PanelHeader(
    title: String,
    modifier: Modifier = Modifier,
    titleExtra: @Composable RowScope.() -> Unit = {},
    actions: @Composable RowScope.() -> Unit = {},
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .heightIn(min = PanelHeaderMinHeight)
            .padding(start = 16.dp, end = 8.dp, top = 4.dp, bottom = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        PanelTitle(title)
        titleExtra()
        Row(
            modifier = Modifier.weight(1f),
            horizontalArrangement = Arrangement.End,
            verticalAlignment = Alignment.CenterVertically,
            content = actions,
        )
    }
    PanelDivider()
}

@Composable
internal fun PanelTitle(text: String, modifier: Modifier = Modifier) {
    Text(
        text = text,
        style = CCText.S16,
        fontWeight = FontWeight.SemiBold,
        color = MaterialTheme.colorScheme.onSurface,
        maxLines = 2,
        overflow = TextOverflow.Ellipsis,
        modifier = modifier.semantics { heading() },
    )
}

@Composable
internal fun PanelDivider(modifier: Modifier = Modifier) {
    HorizontalDivider(modifier = modifier, color = MaterialTheme.colorScheme.outlineVariant)
}

/**
 * Acción de texto de panel («Ver todos», «Todas», «Ver», «Quitar»,
 * «Interactivo/Oficial»): `TextButton` nativo a 13 seminegrita en acento, sin
 * caja ni fondo, con la pulsación neutra común. En un selector, la opción
 * inactiva va en gris y la activa en acento y negrita.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun PanelTextAction(
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    selected: Boolean? = null,
    color: Color = MaterialTheme.colorScheme.primary,
    leadingIcon: ImageVector? = null,
    contentPadding: PaddingValues = PaddingValues(horizontal = 8.dp, vertical = 6.dp),
) {
    val textColor = when (selected) {
        false -> MaterialTheme.colorScheme.onSurfaceVariant
        else -> color
    }
    val weight = when (selected) {
        true -> FontWeight.Bold
        false -> FontWeight.Medium
        null -> FontWeight.SemiBold
    }
    CompositionLocalProvider(
        LocalRippleConfiguration provides RippleConfiguration(color = MaterialTheme.colorScheme.onSurface),
    ) {
        TextButton(
            onClick = onClick,
            modifier = modifier.then(
                if (selected != null) Modifier.semantics { this.selected = selected } else Modifier,
            ),
            shape = RoundedCornerShape(CCRadius.Control),
            colors = ButtonDefaults.textButtonColors(contentColor = textColor),
            contentPadding = contentPadding,
        ) {
            if (leadingIcon != null) {
                Icon(leadingIcon, contentDescription = null, modifier = Modifier.size(16.dp))
                Spacer(Modifier.width(6.dp))
            }
            Text(text = label, style = CCText.S13, fontWeight = weight, maxLines = 1)
        }
    }
}

/** Tramo seleccionado en el perfil: extremos en km y nombre del puerto, si lo hay. */
internal data class ProfileRange(val a: Double, val b: Double, val label: String?)

/**
 * Estado compartido del perfil interactivo y de Puntos clave: formato
 * (interactivo u oficial), punto fijado, punto bajo el puntero, tramo medido y
 * fila de Puntos clave pulsada. Espejo del estado de `js/stage/profile.js`.
 */
@Stable
internal class ProfileSelection(official: Boolean = false) {
    var official by mutableStateOf(official)
    var pinnedKm by mutableStateOf<Double?>(null)
    var hoverKm by mutableStateOf<Double?>(null)
    var range by mutableStateOf<ProfileRange?>(null)
    var markedRowKm by mutableStateOf<Double?>(null)

    /** Punto que se muestra: el del puntero o, sin él, el fijado. Oculto bajo un tramo. */
    val pointKm: Double?
        get() = if (range != null) null else hoverKm ?: pinnedKm

    fun clearAll() {
        range = null
        pinnedKm = null
        hoverKm = null
        markedRowKm = null
    }

    fun pin(km: Double) {
        range = null
        hoverKm = null
        markedRowKm = null
        pinnedKm = km
    }

    fun measure(a: Double, b: Double, label: String? = null) {
        markedRowKm = null
        range = ProfileRange(a, b, label)
    }

    /**
     * Fila de Puntos clave marcada: la pulsada o, sin ella, las que quedan a
     * ±1 km del punto señalado en el perfil.
     */
    fun isMarked(km: Double): Boolean = markedRowKm?.let { it == km }
        ?: (pointKm?.let { abs(km - it) <= 1.0 } == true)
}
