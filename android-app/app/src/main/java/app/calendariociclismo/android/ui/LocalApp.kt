package app.calendariociclismo.android.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.ui.platform.LocalContext
import app.calendariociclismo.android.CalendarioCiclismoApp

/**
 * Accede al contenedor DI (Application) desde cualquier composable.
 * Uso: `val app = rememberApp(); val vm = remember { TodayViewModel(app.repository) }`.
 */
@Composable
@ReadOnlyComposable
fun rememberApp(): CalendarioCiclismoApp {
    val ctx = LocalContext.current.applicationContext
    return ctx as CalendarioCiclismoApp
}
