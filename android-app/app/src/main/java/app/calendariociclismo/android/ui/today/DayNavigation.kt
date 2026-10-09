package app.calendariociclismo.android.ui.today

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.drag
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.material.icons.filled.ChevronLeft
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.outlined.EventBusy
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.positionChange
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import app.calendariociclismo.android.R
import app.calendariociclismo.android.ui.theme.CCRadius
import app.calendariociclismo.android.ui.theme.CCText
import app.calendariociclismo.android.util.DateFormatting
import app.calendariociclismo.android.util.LocaleHolder
import java.time.format.DateTimeFormatter
import kotlin.math.abs
import kotlinx.coroutines.flow.first

/**
 * Navegación por días compartida por Hoy en carretera y la agenda de
 * ciclocross: barra de fechas, gesto horizontal, transición y estado vacío.
 */

/** Días a cada lado del seleccionado en la tira de la barra de fechas. */
internal const val DATE_BAR_RADIUS = 45

/** Desliza el contenido fuera, ejecuta [action] y desliza el nuevo. */
internal suspend fun animateDayNavigation(
    offsetX: Animatable<Float, *>,
    widthPx: Float,
    forward: Boolean,
    setAnimating: (Boolean) -> Unit,
    action: suspend () -> Unit,
) {
    if (widthPx <= 0f) { action(); return }
    setAnimating(true)
    val dir = if (forward) -1f else 1f
    offsetX.animateTo(dir * widthPx, tween(150))
    action()
    offsetX.snapTo(-dir * widthPx)
    offsetX.animateTo(0f, tween(200))
    setAnimating(false)
}

/**
 * Deslizamiento horizontal entre días: la dirección se decide tras 30 px con
 * margen 1,5× sobre la vertical y el cambio exige 80 px reales, de modo que
 * una deriva horizontal durante un scroll vertical no cambia de día.
 * [canNavigate] recibe `true` hacia delante; [onNavigate] se invoca con el
 * sentido del gesto.
 */
internal fun Modifier.daySwipeNavigation(
    key: Any?,
    canNavigate: (forward: Boolean) -> Boolean,
    onNavigate: (forward: Boolean) -> Unit,
): Modifier = pointerInput(key) {
    awaitPointerEventScope {
        while (true) {
            val down = awaitFirstDown(requireUnconsumed = false)
            var totalX = 0f
            var totalY = 0f
            var decided = false
            var isHorizontal = false

            drag(down.id) { change ->
                totalX += change.positionChange().x
                totalY += change.positionChange().y
                if (!decided && (abs(totalX) > 30f || abs(totalY) > 30f)) {
                    decided = true
                    isHorizontal = abs(totalX) > abs(totalY) * 1.5f
                }
                if (isHorizontal) change.consume()
            }

            val forward = totalX < 0
            if (isHorizontal && abs(totalX) > 80f && canNavigate(forward)) onNavigate(forward)
        }
    }
}

/**
 * Fila única situada bajo el cintillo: flecha anterior, carrusel de fechas y
 * flecha siguiente. Fuera de la fecha actual inserta «Hoy» antes de los días.
 * [dateKeys] es la tira ya acotada al rango navegable.
 */
@Composable
internal fun DateBarWithControls(
    selectedDateKey: String,
    isToday: Boolean,
    dateKeys: List<String>,
    canGoPrevious: Boolean,
    canGoNext: Boolean,
    onSelect: (String) -> Unit,
    onPrevious: () -> Unit,
    onToday: () -> Unit,
    onNext: () -> Unit,
) {
    val selectedIndex = remember(selectedDateKey, dateKeys) {
        dateKeys.indexOf(selectedDateKey).coerceAtLeast(0)
    }
    val density = LocalDensity.current
    val listState = rememberLazyListState()
    val animationsEnabled = android.animation.ValueAnimator.areAnimatorsEnabled()
    LaunchedEffect(selectedDateKey) {
        snapshotFlow { listState.layoutInfo.viewportSize.width }
            .first { it > 0 }
        val viewportWidth = listState.layoutInfo.viewportSize.width
        val itemHalfWidthPx = with(density) { 24.dp.roundToPx() }
        val offset = -(viewportWidth / 2 - itemHalfWidthPx)
        if (animationsEnabled) {
            listState.animateScrollToItem(index = selectedIndex, scrollOffset = offset)
        } else {
            listState.scrollToItem(index = selectedIndex, scrollOffset = offset)
        }
    }

    Row(
        modifier = Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surface),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        IconButton(onClick = onPrevious, enabled = canGoPrevious) {
            Icon(Icons.Filled.ChevronLeft, contentDescription = stringResource(R.string.today_prev_day_cd))
        }

        if (!isToday) {
            FilledTonalButton(
                onClick = onToday,
                modifier = Modifier.height(48.dp),
                shape = RoundedCornerShape(CCRadius.Surface),
                contentPadding = PaddingValues(horizontal = 10.dp),
            ) {
                Text(
                    text = stringResource(R.string.today_button_today),
                    style = CCText.S14,
                    fontWeight = FontWeight.SemiBold,
                )
            }
            Spacer(Modifier.width(8.dp))
        }

        LazyRow(
            state = listState,
            modifier = Modifier.weight(1f),
            contentPadding = PaddingValues(horizontal = 4.dp, vertical = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            items(dateKeys, key = { it }) { dateKey ->
                DateBarItem(
                    dateKey = dateKey,
                    isSelected = dateKey == selectedDateKey,
                    onClick = { onSelect(dateKey) },
                )
            }
        }

        IconButton(onClick = onNext, enabled = canGoNext) {
            Icon(Icons.Filled.ChevronRight, contentDescription = stringResource(R.string.today_next_day_cd))
        }
    }
}

/**
 * Día de la tira: abreviatura del día (mayúscula inicial, sin punto) sobre el
 * número, un único formato en todos los anchos. Solo el día seleccionado lleva
 * el acento (selección); sin otros adornos. `Surface` seleccionable nativo.
 */
@Composable
private fun DateBarItem(
    dateKey: String,
    isSelected: Boolean,
    onClick: () -> Unit,
) {
    val localDate = remember(dateKey) { DateFormatting.parseLocalDate(dateKey) }
    val day = localDate?.dayOfMonth?.toString() ?: "?"
    val weekday = remember(dateKey, LocaleHolder.current) {
        localDate?.let {
            val locale = LocaleHolder.current
            val short = DateTimeFormatter.ofPattern("EEE", locale)
                .format(it)
                .replace(".", "")
                .take(3)
            short.replaceFirstChar { c -> c.titlecase(locale) }
        }.orEmpty()
    }

    val primary = MaterialTheme.colorScheme.primary
    val foreground = if (isSelected) primary else MaterialTheme.colorScheme.onSurface
    val weekdayColor = if (isSelected) primary else MaterialTheme.colorScheme.onSurfaceVariant
    val cellLabel = "$weekday $day"

    Surface(
        selected = isSelected,
        onClick = onClick,
        modifier = Modifier
            .width(48.dp)
            .height(56.dp)
            .semantics { contentDescription = cellLabel },
        shape = RoundedCornerShape(CCRadius.Surface),
        color = if (isSelected) primary.copy(alpha = 0.15f) else Color.Transparent,
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            Text(
                text = weekday,
                style = CCText.S12,
                fontWeight = if (isSelected) FontWeight.Bold else FontWeight.SemiBold,
                color = weekdayColor,
            )
            Spacer(Modifier.height(2.dp))
            Text(
                text = day,
                style = CCText.S16,
                fontWeight = if (isSelected) FontWeight.Bold else FontWeight.SemiBold,
                color = foreground,
            )
        }
    }
}

/** Estado vacío de un día, con acceso al siguiente día con carreras si existe. */
@Composable
internal fun DayEmptyState(
    title: String,
    body: String,
    nextLabel: String,
    nextRaceDate: String? = null,
    onNextRaceDay: () -> Unit = {},
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState()),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Icon(
            imageVector = Icons.Outlined.EventBusy,
            contentDescription = null,
            modifier = Modifier.size(52.dp),
            tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.35f),
        )
        Spacer(Modifier.height(12.dp))
        Text(
            text = title,
            style = MaterialTheme.typography.titleMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.height(4.dp))
        Text(
            text = body,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f),
        )
        if (nextRaceDate != null) {
            Spacer(Modifier.height(16.dp))
            TextButton(onClick = onNextRaceDay) {
                Text(nextLabel)
                Spacer(Modifier.width(4.dp))
                Icon(
                    imageVector = Icons.AutoMirrored.Filled.ArrowForward,
                    contentDescription = null,
                    modifier = Modifier.size(16.dp),
                )
            }
        }
    }
}
