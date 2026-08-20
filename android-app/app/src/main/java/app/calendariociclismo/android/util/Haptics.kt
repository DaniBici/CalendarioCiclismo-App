package app.calendariociclismo.android.util

import android.content.Context
import android.os.Build
import android.view.HapticFeedbackConstants
import android.view.View
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalView

/**
 * Servicio centralizado de feedback haptico.
 *
 * Expone un vocabulario semantico de eventos ([Event]) en lugar de que
 * cada pantalla elija constantes de vibración. Así se mantiene una
 * identidad háptica consistente en toda la app (mismo enfoque que la
 * versión iOS con `UIFeedbackGenerator`).
 *
 * Respeta:
 * - Una preferencia del usuario (`haptics_enabled` en SharedPreferences,
 *   por defecto `true`). Se gestiona desde Ajustes.
 * - Los ajustes globales del sistema: [View.performHapticFeedback] no
 *   vibra si el usuario ha desactivado "Vibración al tocar" en
 *   Ajustes del sistema.
 */
object Haptics {

    /**
     * Eventos semánticos. Cada caso se mapea internamente al tipo de
     * constante de haptics más apropiado.
     */
    enum class Event {
        /** Navegación entre pantallas o días. Impacto ligero. */
        Navigation,
        /** Cambio de selección en un control discreto (filtro, chip). */
        Selection,
        /** Cruce de un límite al arrastrar. Impacto muy ligero. */
        Boundary,
        /** Toggle de un ajuste. Impacto suave. */
        Toggle,
        /** Acción primaria con compromiso (suscribirse, confirmar). */
        PrimaryAction,
        /** Confirmación de éxito tras una operación. */
        Success,
        /** Aviso de precaución previo a una acción destructiva. */
        Warning,
        /** Error irrecuperable. */
        Error,
    }

    // ── Preferencia de usuario ──────────────────────────────────

    private const val PREFS_NAME = "cc_haptics"
    private const val KEY_ENABLED = "haptics_enabled"

    /** Lee si el usuario tiene hápticos habilitados (por defecto `true`). */
    fun isEnabled(context: Context): Boolean {
        return context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .getBoolean(KEY_ENABLED, true)
    }

    /** Persiste el valor del toggle. Llamar desde la pantalla de Ajustes. */
    fun setEnabled(context: Context, value: Boolean) {
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putBoolean(KEY_ENABLED, value)
            .apply()
    }

    // ── Reproducción ────────────────────────────────────────────

    /**
     * Dispara el feedback háptico correspondiente al evento.
     * Es un no-op si la preferencia del usuario lo tiene desactivado
     * o si el sistema ha deshabilitado hápticos globalmente.
     */
    fun play(view: View, event: Event) {
        if (!isEnabled(view.context)) return

        val constant = when (event) {
            Event.Navigation, Event.Boundary ->
                HapticFeedbackConstants.CLOCK_TICK
            Event.Selection ->
                HapticFeedbackConstants.CONTEXT_CLICK
            Event.Toggle ->
                if (Build.VERSION.SDK_INT >= 34) {
                    HapticFeedbackConstants.SEGMENT_FREQUENT_TICK
                } else {
                    HapticFeedbackConstants.CLOCK_TICK
                }
            Event.PrimaryAction ->
                HapticFeedbackConstants.VIRTUAL_KEY
            Event.Success ->
                if (Build.VERSION.SDK_INT >= 30) {
                    HapticFeedbackConstants.CONFIRM
                } else {
                    HapticFeedbackConstants.VIRTUAL_KEY
                }
            Event.Warning ->
                HapticFeedbackConstants.LONG_PRESS
            Event.Error ->
                if (Build.VERSION.SDK_INT >= 30) {
                    HapticFeedbackConstants.REJECT
                } else {
                    HapticFeedbackConstants.LONG_PRESS
                }
        }

        view.performHapticFeedback(constant)
    }
}

/**
 * Proporciona una lambda `(Haptics.Event) -> Unit` lista para usar en
 * cualquier composable. Captura la [View] actual para que se pueda
 * invocar desde callbacks `onClick`, coroutines, etc.
 *
 * Uso:
 * ```
 * val haptic = rememberHaptics()
 * Button(onClick = { haptic(Haptics.Event.Navigation) }) { … }
 * ```
 */
@Composable
fun rememberHaptics(): (Haptics.Event) -> Unit {
    val view = LocalView.current
    return remember(view) { { event: Haptics.Event -> Haptics.play(view, event) } }
}
