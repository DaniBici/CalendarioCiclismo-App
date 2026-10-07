package app.calendariociclismo.android.ui.components

import android.content.Context
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ChatBubbleOutline
import androidx.compose.material.icons.filled.Tv
import androidx.compose.material.icons.filled.TvOff
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import app.calendariociclismo.android.util.openExternalUrl
import app.calendariociclismo.android.R
import app.calendariociclismo.android.data.model.Broadcast
import app.calendariociclismo.android.ui.theme.CCText
import app.calendariociclismo.android.ui.theme.tvStatusBadgeColor
import app.calendariociclismo.android.util.DateFormatting
import app.calendariociclismo.android.util.LocaleHolder
import app.calendariociclismo.android.util.RaceLogic
import app.calendariociclismo.android.util.RegionDetector
import kotlinx.coroutines.delay

/**
 * Badge de estado de TV con hora de emisión si está disponible.
 * Clicable cuando hay URL de emisión o de live texto. La URL se elige filtrando
 * primero por la región del usuario y respetando estrictamente el sortOrder del admin.
 *
 * Port de `ios-app/.../Views/Components/TVBadge.swift`, con la misma lógica
 * de prioridades: live_text → none → unavailable_es → pending → broadcasts
 * con hora → confirmed.
 */
@Composable
fun TVBadge(
    tvStatus: String?,
    broadcasts: List<Broadcast>,
    neutralStartTimeUtc: String? = null,
    liveTextUrl: String? = null,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current

    // Todo el badge (label, icono, "hay TV", hora de referencia y enlace) se calcula
    // sobre los broadcasts visibles para la región del usuario, NO sobre la lista
    // cruda: si no, un usuario de España vería "TV 14:00" de una emisión solo de
    // Bélgica aunque el enlace estuviera (correctamente) suprimido. La web ya
    // pre-filtra los broadcasts antes de pintar el badge.
    val regionBroadcasts = RaceLogic.filterBroadcastsByRegion(broadcasts, RegionDetector.allowedBroadcastGroups())
    val hasBroadcasts = regionBroadcasts.isNotEmpty()
    // HABÍA emisiones pero NINGUNA accesible en la región del usuario (todas filtradas)
    // → no mostramos el badge "TV" genérico que vendría de tvStatus='confirmed'. (Sin
    // emisiones en absoluto, el badge sigue saliendo de tvStatus: cobertura sin canal aún.)
    val regionBlocked = broadcasts.isNotEmpty() && regionBroadcasts.isEmpty()

    val isLiveText = !liveTextUrl.isNullOrEmpty() && run {
        val s = tvStatus.orEmpty()
        s == "none" || s == "unavailable_es" || s == "pending" || (s.isEmpty() && !hasBroadcasts)
    }

    // Reloj del badge. `System.currentTimeMillis()` no provoca recomposición: sin este
    // estado, un badge compuesto antes de la hora de emisión no pasaba a «Live» al
    // alcanzarla. Instantes en que cambia el estado: inicio de cada emisión accesible
    // (→ «Live», enlace en directo) y salida neutralizada (→ chip «Live texto»).
    val boundariesMs = (regionBroadcasts.mapNotNull { it.startTimeUtc } + listOfNotNull(neutralStartTimeUtc))
        .mapNotNull { DateFormatting.timestampToSeconds(it) }
        .map { (it * 1000).toLong() }
    var nowMs by remember { mutableLongStateOf(System.currentTimeMillis()) }
    val lifecycleOwner = LocalLifecycleOwner.current
    LaunchedEffect(lifecycleOwner, boundariesMs) {
        // Avanza en cada frontera futura (tope de 60 s ante cambios de reloj o sueño
        // profundo) y al volver a primer plano. Termina sin fronteras pendientes.
        lifecycleOwner.lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
            nowMs = System.currentTimeMillis()
            while (true) {
                val next = boundariesMs.filter { it > nowMs }.minOrNull() ?: break
                delay((next - System.currentTimeMillis()).coerceIn(0L, 60_000L) + 50L)
                nowMs = System.currentTimeMillis()
            }
        }
    }
    val nowSec = nowMs / 1000.0
    val raceStarted = neutralStartTimeUtc
        ?.let { DateFormatting.timestampToSeconds(it) }
        ?.let { it <= nowSec } ?: false

    // Broadcast seleccionado para el enlace: región del usuario. Una emisión YA EN
    // DIRECTO (su hora de inicio ya pasó) gana SIEMPRE a una que aún no ha empezado,
    // aunque esta última sea de mayor tier (p. ej. Eurosport ya emitiendo vs RTVE por
    // empezar → enlaza a Eurosport, lo accesible AHORA). A igualdad de estado manda el
    // tier (YouTube > otras redes sociales > RTVE.es > resto; Eurosport / HBO Max son
    // "una cadena más") y luego el sortOrder. Sin ninguna en directo se conserva el
    // tier puro. Espejo iOS/web.
    val isBroadcastLive: (Broadcast) -> Boolean = { b ->
        b.startTimeUtc?.let { DateFormatting.timestampToSeconds(it) }?.let { it <= nowSec } ?: false
    }
    val selectedBroadcast: Broadcast? = if (isLiveText) null else {
        regionBroadcasts
            .filter { !it.url.isNullOrEmpty() }
            .sortedWith(
                compareBy(
                    { if (isBroadcastLive(it)) 0 else 1 },
                    { RaceLogic.broadcastLinkPriority(it.url) },
                    { it.sortOrder },
                )
            )
            .firstOrNull()
    }

    // Hora de referencia del badge = la emisión accesible que ANTES empieza (no la del
    // enlace): si una emisión global (ALL) empieza antes que las de tu grupo, su hora
    // manda. El enlace (tap) sigue por prioridad de tier vía selectedBroadcast.
    val refBroadcastSec = regionBroadcasts
        .mapNotNull { it.startTimeUtc?.let { ts -> DateFormatting.timestampToSeconds(ts) } }
        .minOrNull()
    val broadcastStarted = refBroadcastSec != null && refBroadcastSec <= nowSec
    val showLive = tvStatus == "confirmed_time" && broadcastStarted

    // Mostrar "Live texto" JUNTO al badge de TV: la carrera ya empezó pero la emisión de
    // referencia aún no ha comenzado (hora futura). Paridad con la web (`liveTextAlongside`).
    val showLiveTextAlongside = !isLiveText &&
        !liveTextUrl.isNullOrEmpty() &&
        raceStarted &&
        refBroadcastSec != null &&
        refBroadcastSec > nowSec

    // Caso sin TV con live texto: el chip de live texto SUSTITUYE al badge de TV.
    if (isLiveText) {
        LiveTextChip(
            liveTextUrl = liveTextUrl,
            raceStarted = raceStarted,
            context = context,
            modifier = modifier,
        )
        return
    }

    val label = buildLabel(
        tvStatus = tvStatus,
        broadcasts = regionBroadcasts,
        neutralStartTimeUtc = neutralStartTimeUtc,
        showLive = showLive,
        selectedBroadcast = selectedBroadcast,
        regionBlocked = regionBlocked,
    ) ?: return

    val colors = tvStatusBadgeColor(
        status = tvStatus,
        hasBroadcasts = hasBroadcasts,
        isTvLive = showLive,
    )
    val icon = when {
        hasBroadcasts || tvStatus == "confirmed" || tvStatus == "pending" -> Icons.Filled.Tv
        else -> Icons.Filled.TvOff
    }

    // URL a abrir al pulsar: la del broadcast seleccionado.
    val tappableUrl: String? = selectedBroadcast?.url

    CCBadgeSurface(
        colors = colors,
        onClick = tappableUrl?.let { url -> { openTvUrl(context, url) } },
        modifier = modifier,
    ) {
        Icon(
            imageVector = icon,
            contentDescription = null,
            tint = colors.foreground,
            modifier = Modifier.size(12.dp),
        )
        Text(
            text = label,
            style = CCText.S12,
            fontWeight = FontWeight.SemiBold,
            color = colors.foreground,
        )
    }

    // Chip de "Live texto" como hermano del badge de TV. El FlowRow padre lo separa con el
    // mismo spacing (4.dp) que el resto de badges.
    if (showLiveTextAlongside) {
        LiveTextChip(
            liveTextUrl = liveTextUrl,
            raceStarted = raceStarted,
            context = context,
        )
    }
}

/**
 * Chip independiente de "Live texto" (icono burbuja + enlace). Verde si la carrera ya empezó,
 * azul ("pre") si aún no. Se usa tanto cuando sustituye al badge de TV (sin TV) como cuando
 * acompaña al badge de TV (carrera empezada y TV aún en reposo).
 */
@Composable
private fun LiveTextChip(
    liveTextUrl: String?,
    raceStarted: Boolean,
    context: Context,
    modifier: Modifier = Modifier,
) {
    val colors = tvStatusBadgeColor(
        status = null,
        hasBroadcasts = false,
        isLiveText = raceStarted,
        isLiveTextPre = !raceStarted,
    )
    CCBadgeSurface(
        colors = colors,
        onClick = liveTextUrl?.takeUnless { it.isEmpty() }?.let { url -> { openTvUrl(context, url) } },
        modifier = modifier,
    ) {
        Icon(
            imageVector = Icons.Filled.ChatBubbleOutline,
            contentDescription = null,
            tint = colors.foreground,
            modifier = Modifier.size(12.dp),
        )
        Text(
            text = stringResource(R.string.tv_badge_live_text),
            style = CCText.S12,
            fontWeight = FontWeight.SemiBold,
            color = colors.foreground,
        )
    }
}

@Composable
private fun buildLabel(
    tvStatus: String?,
    broadcasts: List<Broadcast>,
    neutralStartTimeUtc: String?,
    showLive: Boolean,
    selectedBroadcast: Broadcast?,
    regionBlocked: Boolean = false,
): String? {
    // Retransmisión en vivo: la hora de inicio ya ha pasado.
    if (showLive) return stringResource(R.string.tv_badge_live)

    // Estados "sin TV" se priorizan sobre los broadcasts (misma lógica que web/iOS).
    when (tvStatus) {
        "none" -> return stringResource(R.string.tv_badge_no_tv)
        "unavailable_es" -> {
            // Solo aplica a usuarios en España. En EN (Premium) la app sirve
            // a europeos sin restricción geográfica → ocultar el badge.
            if (LocaleHolder.current.language == "en") return null
            return stringResource(R.string.tv_badge_no_tv_spain)
        }
        "pending" -> return stringResource(R.string.tv_badge_pending)
    }

    // Hora del badge = la emisión accesible que ANTES empieza (independiente del
    // enlace): si una emisión global (ALL) empieza antes que las de tu grupo, su hora
    // manda. El enlace (tap) sigue por prioridad de tier vía selectedBroadcast.
    val first = broadcasts
        .mapNotNull { b ->
            val ts = b.startTimeUtc ?: return@mapNotNull null
            val seconds = DateFormatting.timestampToSeconds(ts) ?: return@mapNotNull null
            b to seconds
        }
        .minByOrNull { it.second }
        ?.first

    if (first != null) {
        val broadcastTs = first.startTimeUtc
        if (broadcastTs != null && neutralStartTimeUtc != null) {
            val neutralSec = DateFormatting.timestampToSeconds(neutralStartTimeUtc)
            val broadcastSec = DateFormatting.timestampToSeconds(broadcastTs)
            if (neutralSec != null && broadcastSec != null && broadcastSec <= neutralSec) {
                return stringResource(R.string.tv_badge_full)
            }
        }
        // La web muestra solo la hora: mantener la misma etiqueta en las apps.
        first.startTimeLocal?.let { return it }
    }
    if (broadcasts.isNotEmpty()) return stringResource(R.string.tv_badge_tv)
    // TV confirmada pero toda fuera de la región del usuario → sin badge.
    if (regionBlocked) return null
    if (tvStatus == "confirmed") return stringResource(R.string.tv_badge_tv)
    return null
}

private fun openTvUrl(context: Context, url: String) {
    openExternalUrl(context, url)
}
