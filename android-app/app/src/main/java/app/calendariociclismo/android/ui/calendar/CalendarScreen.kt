package app.calendariociclismo.android.ui.calendar

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.navigation.NavController
import app.calendariociclismo.android.ui.adaptive.AdaptiveLayoutPolicy
import app.calendariociclismo.android.ui.adaptive.rememberAdaptiveLayoutInfo
import app.calendariociclismo.android.ui.month.MonthScreen
import app.calendariociclismo.android.ui.rememberApp
import app.calendariociclismo.android.ui.season.SeasonScreen
import kotlinx.coroutines.launch

/**
 * Pestaña "Calendario" (apps 3.1) — fusión de las antiguas pestañas Mes y
 * Temporada en una sola, con un toggle en el TopAppBar de cada subvista.
 *
 * La subvista activa ("month" | "season") se recuerda en
 * `AppPreferences.calendarSubview` para que la pestaña reabra donde el usuario
 * la dejó. El toggle alterna el estado local al instante (sin esperar a
 * DataStore) y persiste en segundo plano.
 */
@Composable
fun CalendarScreen(navController: NavController) {
    val app = rememberApp()
    val scope = rememberCoroutineScope()
    val adaptiveInfo = rememberAdaptiveLayoutInfo()

    // null = pref aún sin leer (la primera lectura de DataStore es asíncrona);
    // no renderizamos nada ese frame para no parpadear la subvista equivocada.
    var subview by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(Unit) {
        if (subview == null) subview = app.preferences.snapshotCalendarSubview()
    }

    val onSwitchView: () -> Unit = {
        val next = if (subview == "season") "month" else "season"
        subview = next
        scope.launch { app.preferences.setCalendarSubview(next) }
    }

    BoxWithConstraints(Modifier.fillMaxSize()) {
        val wide = AdaptiveLayoutPolicy.usesWideDetail(maxWidth.value, adaptiveInfo)
        when {
            subview == null -> Unit // cargando la pref (un frame)
            wide -> Row(
                modifier = Modifier.fillMaxSize(),
                horizontalArrangement = Arrangement.spacedBy(adaptiveInfo.paneSpacing),
            ) {
                MonthScreen(navController, modifier = Modifier.weight(0.62f))
                SeasonScreen(navController, embedded = true, modifier = Modifier.weight(0.38f))
            }
            subview == "season" -> SeasonScreen(navController, onSwitchView = onSwitchView)
            else -> MonthScreen(navController, onSwitchView = onSwitchView)
        }
    }
}
