package app.calendariociclismo.android.ui.calendar

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.navigation.NavController
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

    when (subview) {
        "season" -> SeasonScreen(navController, onSwitchView = onSwitchView)
        "month" -> MonthScreen(navController, onSwitchView = onSwitchView)
        else -> Unit // cargando la pref (un frame)
    }
}
