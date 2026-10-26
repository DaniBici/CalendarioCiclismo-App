package app.calendariociclismo.android.ui.components

import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.calendariociclismo.android.R
import app.calendariociclismo.android.ui.theme.CCRadius
import app.calendariociclismo.android.util.Haptics
import app.calendariociclismo.android.util.LocaleHolder
import app.calendariociclismo.android.util.rememberHaptics

private val GoogleSansMedium = FontFamily(
    Font(R.font.google_sans_medium, weight = FontWeight.Medium),
)

/** Símbolos de Calendario Ciclismo sin fondo ni tratamiento de botón. */
@Composable
fun CCHeaderMark(
    modifier: Modifier = Modifier,
    width: Dp = 46.dp,
) {
    Image(
        painter = painterResource(R.drawable.ic_cc_header),
        contentDescription = null,
        modifier = modifier
            .width(width)
            .height(width * 32f / 74f),
    )
}

/** Firma completa de la cabecera de Hoy, equivalente a la marca de la web. */
@Composable
fun CCHeaderBrand(
    modifier: Modifier = Modifier,
    title: String = "Calendario Ciclismo",
    markWidth: Dp = 60.dp,
    /** Sin título, solo los símbolos: deja sitio al conmutador «CX | Ruta». */
    showsTitle: Boolean = true,
) {
    Row(
        modifier = modifier,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        CCHeaderMark(width = markWidth)
        if (showsTitle) {
            Text(
                text = title,
                color = MaterialTheme.colorScheme.onSurface,
                fontFamily = GoogleSansMedium,
                fontWeight = FontWeight.Medium,
                fontSize = 20.sp,
                lineHeight = 26.sp,
                maxLines = 1,
                overflow = TextOverflow.Clip,
            )
        }
    }
}

/**
 * Disciplina que muestra la pestaña Ciclocross mientras Hoy de carretera está
 * oculta ([app.calendariociclismo.android.util.RoadTodayAvailability]): su
 * agenda o Hoy de carretera.
 */
enum class HomeDiscipline { CYCLOCROSS, ROAD }

/**
 * Conmutador «CX | Ruta» de la cabecera, a la izquierda de Ajustes: control
 * segmentado nativo con los colores de Ajustes ([ccSegmentedColors]).
 * Mientras existe, la firma de la cabecera muestra solo los símbolos. Espejo
 * de `HomeDisciplineSwitch` en iOS y de `js/components/discipline-switch.js`.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeDisciplineSwitch(
    selection: HomeDiscipline,
    onSelect: (HomeDiscipline) -> Unit,
    modifier: Modifier = Modifier,
) {
    val haptic = rememberHaptics()
    val options = listOf(
        Triple(HomeDiscipline.CYCLOCROSS, "CX", LocaleHolder.t("Ciclocross", "Cyclocross")),
        Triple(HomeDiscipline.ROAD, LocaleHolder.t("Ruta", "Road"), LocaleHolder.t("Carretera", "Road")),
    )
    SingleChoiceSegmentedButtonRow(modifier = modifier) {
        options.forEachIndexed { index, (value, label, name) ->
            SegmentedButton(
                colors = ccSegmentedColors(),
                selected = value == selection,
                onClick = {
                    if (value != selection) {
                        haptic(Haptics.Event.Selection)
                        onSelect(value)
                    }
                },
                shape = SegmentedButtonDefaults.itemShape(
                    index = index,
                    count = options.size,
                    baseShape = RoundedCornerShape(CCRadius.Control),
                ),
                // Sin la marca de verificación del segmento activo: la
                // selección la indica el relleno, como en iOS.
                icon = {},
            ) {
                Text(label, modifier = Modifier.semantics { contentDescription = name })
            }
        }
    }
}
