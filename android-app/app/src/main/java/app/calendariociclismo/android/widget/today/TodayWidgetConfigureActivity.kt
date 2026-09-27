package app.calendariociclismo.android.widget.today

import android.appwidget.AppWidgetManager
import android.content.Context
import android.content.Intent
import android.content.res.Configuration
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import androidx.glance.appwidget.GlanceAppWidgetManager
import androidx.glance.appwidget.state.getAppWidgetState
import androidx.glance.appwidget.state.updateAppWidgetState
import androidx.glance.state.PreferencesGlanceStateDefinition
import androidx.lifecycle.lifecycleScope
import app.calendariociclismo.android.R
import app.calendariociclismo.android.data.prefs.AppPreferences
import app.calendariociclismo.android.ui.theme.CalendarioCiclismoTheme
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import java.util.Locale

/**
 * Configuración de cada instancia del widget: alcance (filtro de la app,
 * todas, seguidas) y disciplina (carretera, ciclocross o ambas). También se
 * abre al reconfigurar el widget desde el launcher (Android 12+).
 */
class TodayWidgetConfigureActivity : ComponentActivity() {

    private var appWidgetId = AppWidgetManager.INVALID_APPWIDGET_ID

    override fun attachBaseContext(newBase: Context) {
        // Idioma de la app, no el del sistema.
        val tag = runCatching { runBlocking { AppPreferences(newBase).snapshotAppLocale().tag } }.getOrDefault("es")
        val config = Configuration(newBase.resources.configuration).apply {
            setLocale(if (tag == "en") Locale.UK else Locale.forLanguageTag("es-ES"))
        }
        super.attachBaseContext(newBase.createConfigurationContext(config))
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        appWidgetId = intent?.extras?.getInt(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID)
            ?: AppWidgetManager.INVALID_APPWIDGET_ID
        // Si el usuario sale sin guardar, el launcher descarta el widget nuevo.
        setResult(RESULT_CANCELED, resultIntent())
        if (appWidgetId == AppWidgetManager.INVALID_APPWIDGET_ID) {
            finish()
            return
        }

        lifecycleScope.launch {
            val manager = GlanceAppWidgetManager(this@TodayWidgetConfigureActivity)
            val glanceId = runCatching { manager.getGlanceIdBy(appWidgetId) }.getOrNull()
            val initial = glanceId
                ?.let { WidgetConfig.from(getAppWidgetState(this@TodayWidgetConfigureActivity, PreferencesGlanceStateDefinition, it)) }
                ?: WidgetConfig.DEFAULT
            setContent {
                CalendarioCiclismoTheme {
                    ConfigureScreen(initial) { config -> save(config) }
                }
            }
        }
    }

    private fun save(config: WidgetConfig) {
        lifecycleScope.launch {
            val context = this@TodayWidgetConfigureActivity
            runCatching {
                val glanceId = GlanceAppWidgetManager(context).getGlanceIdBy(appWidgetId)
                updateAppWidgetState(context, glanceId) { prefs ->
                    prefs[WidgetConfig.KEY_SCOPE] = config.scope.id
                    prefs[WidgetConfig.KEY_DISCIPLINE] = config.discipline.id
                }
                TodayCyclingWidget().update(context, glanceId)
            }
            TodayWidgetScheduler.schedulePeriodic(context)
            TodayWidgetScheduler.refreshNow(context)
            setResult(RESULT_OK, resultIntent())
            finish()
        }
    }

    private fun resultIntent() = Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId)
}

@Composable
private fun ConfigureScreen(initial: WidgetConfig, onSave: (WidgetConfig) -> Unit) {
    var scope by remember { mutableStateOf(initial.scope) }
    var discipline by remember { mutableStateOf(initial.discipline) }
    Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .safeDrawingPadding()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp, vertical = 16.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Text(stringResource(R.string.widget_config_title), style = MaterialTheme.typography.headlineSmall)
            Spacer(Modifier.height(16.dp))
            SectionTitle(stringResource(R.string.widget_config_scope))
            Choice(stringResource(R.string.widget_scope_app_filter), stringResource(R.string.widget_scope_app_filter_desc),
                scope == WidgetScope.APP_FILTER) { scope = WidgetScope.APP_FILTER }
            Choice(stringResource(R.string.widget_scope_all), null, scope == WidgetScope.ALL) { scope = WidgetScope.ALL }
            Choice(stringResource(R.string.widget_scope_followed), stringResource(R.string.widget_scope_followed_desc),
                scope == WidgetScope.FOLLOWED) { scope = WidgetScope.FOLLOWED }
            Spacer(Modifier.height(16.dp))
            SectionTitle(stringResource(R.string.widget_config_discipline))
            Choice(stringResource(R.string.widget_discipline_both), null, discipline == WidgetDiscipline.BOTH) { discipline = WidgetDiscipline.BOTH }
            Choice(stringResource(R.string.widget_discipline_road), null, discipline == WidgetDiscipline.ROAD) { discipline = WidgetDiscipline.ROAD }
            Choice(stringResource(R.string.widget_discipline_cx), null, discipline == WidgetDiscipline.CYCLOCROSS) { discipline = WidgetDiscipline.CYCLOCROSS }
            Spacer(Modifier.height(24.dp))
            Button(onClick = { onSave(WidgetConfig(scope, discipline)) }, modifier = Modifier.fillMaxWidth()) {
                Text(stringResource(R.string.widget_config_save))
            }
        }
    }
}

@Composable
private fun SectionTitle(text: String) {
    Text(text, style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.primary)
}

@Composable
private fun Choice(title: String, subtitle: String?, selected: Boolean, onClick: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .selectable(selected = selected, onClick = onClick, role = Role.RadioButton)
            .padding(vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        RadioButton(selected = selected, onClick = null)
        Column(modifier = Modifier.padding(start = 12.dp)) {
            Text(title, style = MaterialTheme.typography.bodyLarge)
            if (subtitle != null) {
                Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}
