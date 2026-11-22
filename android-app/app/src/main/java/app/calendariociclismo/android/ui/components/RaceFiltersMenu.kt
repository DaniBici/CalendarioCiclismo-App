package app.calendariociclismo.android.ui.components

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.FilterList
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LocalMinimumInteractiveComponentSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import app.calendariociclismo.android.R
import app.calendariociclismo.android.ui.theme.CCRadius
import app.calendariociclismo.android.ui.theme.CCText
import app.calendariociclismo.android.util.CxRaceFilter
import app.calendariociclismo.android.util.RoadRaceFilter

/*
 * Menú «Filtros» de Hoy, Mes, Temporada y la agenda de Ciclocross, el de
 * Fichajes: opciones con casilla por grupos, separados por un filete, y
 * «Limpiar filtros». Marcar no cierra el menú. Con algún filtro, el icono se
 * colorea (fila de Hoy) o lleva un punto de aviso (barra superior).
 */

/** Una opción: valor, texto y si está marcada. */
private data class FilterOption(val value: String, val label: String, val checked: Boolean)

/** Estilo del botón: en la fila de la fecha de Hoy, con texto; en la barra superior, solo el icono. */
enum class FiltersMenuStyle { Row, TopBar }

/** Filtros de carretera: nivel (WorldTour, Profesional, .2) y género. */
@Composable
fun RoadFiltersMenu(
    filter: RoadRaceFilter,
    onChange: (RoadRaceFilter) -> Unit,
    style: FiltersMenuStyle = FiltersMenuStyle.Row,
) {
    val levels = listOf(
        "wt" to stringResource(R.string.race_filter_wt),
        "pro" to stringResource(R.string.race_filter_pro),
        "dev" to stringResource(R.string.race_filter_dev),
    )
    val genders = listOf(
        "male" to stringResource(R.string.race_filter_male),
        "female" to stringResource(R.string.race_filter_female),
    )
    val summary = buildList {
        if (filter.levels.size < RoadRaceFilter.ALL_LEVELS.size) addAll(levels.filter { it.first in filter.levels }.map { it.second })
        if (filter.genders.size < RoadRaceFilter.ALL_GENDERS.size) addAll(genders.filter { it.first in filter.genders }.map { it.second })
    }.joinToString(" · ")
    FiltersMenu(
        groups = listOf(
            levels.map { (value, label) -> FilterOption(value, label, value in filter.levels) } to { value: String -> onChange(filter.toggleLevel(value)) },
            genders.map { (value, label) -> FilterOption(value, label, value in filter.genders) } to { value: String -> onChange(filter.toggleGender(value)) },
        ),
        isActive = filter.isActive,
        summary = summary,
        onClear = { onChange(RoadRaceFilter()) },
        style = style,
    )
}

/** Filtros de Ciclocross: Big, UCI y Nacional (sin Nacional en inglés). */
@Composable
fun CxFiltersMenu(
    filter: CxRaceFilter,
    onChange: (CxRaceFilter) -> Unit,
    style: FiltersMenuStyle = FiltersMenuStyle.Row,
) {
    val labels = mapOf(
        "big" to stringResource(R.string.race_filter_big),
        "uci" to stringResource(R.string.race_filter_uci),
        "national" to stringResource(R.string.race_filter_national),
    )
    val options = CxRaceFilter.allLevels().map { FilterOption(it, labels.getValue(it), filter.isChecked(it)) }
    FiltersMenu(
        groups = listOf(options to { value: String -> onChange(filter.toggleLevel(value)) }),
        isActive = filter.isActive,
        summary = options.filter { it.checked }.joinToString(" · ") { it.label },
        onClear = { onChange(CxRaceFilter()) },
        style = style,
    )
}

@Composable
private fun FiltersMenu(
    groups: List<Pair<List<FilterOption>, (String) -> Unit>>,
    isActive: Boolean,
    summary: String,
    onClear: () -> Unit,
    style: FiltersMenuStyle,
) {
    var expanded by remember { mutableStateOf(false) }
    val title = stringResource(R.string.race_filters_title)
    val state = if (isActive) stringResource(R.string.race_filters_active_a11y, summary) else ""
    Box(modifier = if (style == FiltersMenuStyle.Row) Modifier.padding(start = 4.dp) else Modifier) {
        when (style) {
            FiltersMenuStyle.TopBar -> IconButton(
                onClick = { expanded = true },
                modifier = Modifier.semantics { stateDescription = state },
            ) {
                BadgedBox(badge = { if (isActive) Badge() }) {
                    Icon(Icons.Filled.FilterList, contentDescription = title)
                }
            }
            FiltersMenuStyle.Row -> CompositionLocalProvider(LocalMinimumInteractiveComponentSize provides 0.dp) {
                TextButton(
                    onClick = { expanded = true },
                    // 32 dp, como «Ordenar»: la fila de la fecha no se estira.
                    modifier = Modifier.heightIn(min = 32.dp).semantics {
                        contentDescription = title
                        stateDescription = state
                    },
                    shape = RoundedCornerShape(CCRadius.Control),
                    colors = ButtonDefaults.textButtonColors(
                        contentColor = if (isActive) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
                    ),
                    contentPadding = PaddingValues(horizontal = 8.dp, vertical = 4.dp),
                ) {
                    Icon(Icons.Filled.FilterList, contentDescription = null, modifier = Modifier.size(16.dp))
                    Spacer(Modifier.width(4.dp))
                    Text(text = title, style = CCText.S13, fontWeight = FontWeight.SemiBold, maxLines = 1)
                }
            }
        }
        DropdownMenu(
            expanded = expanded,
            onDismissRequest = { expanded = false },
            shape = RoundedCornerShape(CCRadius.Control),
        ) {
            groups.forEachIndexed { index, (options, onToggle) ->
                if (index > 0) HorizontalDivider()
                options.forEach { option ->
                    DropdownMenuItem(
                        text = { Text(option.label) },
                        leadingIcon = { Checkbox(checked = option.checked, onCheckedChange = null) },
                        onClick = { onToggle(option.value) },
                    )
                }
            }
            HorizontalDivider()
            DropdownMenuItem(
                text = { Text(stringResource(R.string.race_filters_clear)) },
                leadingIcon = { Icon(Icons.Filled.Close, contentDescription = null) },
                enabled = isActive,
                onClick = {
                    onClear()
                    expanded = false
                },
            )
        }
    }
}
