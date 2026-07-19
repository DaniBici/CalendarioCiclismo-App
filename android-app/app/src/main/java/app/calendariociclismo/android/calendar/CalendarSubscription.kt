package app.calendariociclismo.android.calendar

import android.content.Context
import android.content.Intent
import android.net.Uri
import app.calendariociclismo.android.R
import java.time.LocalDate

/**
 * Helper para suscribirse a los feeds iCal del calendario desde Android.
 *
 * Estrategia:
 *   - Android no soporta `webcal://` nativamente (iOS sí), así que abrimos
 *     Google Calendar web con el parámetro `?cid=<url codificada>` que
 *     añade la URL como "calendario por URL" en la cuenta del usuario.
 *     Esto equivale al flujo "Otros calendarios → Añadir por URL".
 *   - Si Google Calendar no está disponible, intentamos abrir la URL .ics
 *     directamente (el sistema ofrece apps que puedan manejarla).
 *
 * Los 6 feeds son los mismos que en iOS (`SettingsView.swift:516-523`):
 *   todo, pro, wt, wwt, masc, fem.
 */
object CalendarSubscription {

    private const val FEED_HOST = "feed.calendariociclismo.app"
    private const val FEED_PATH = "/feed"

    enum class Feed(val id: String, val labelRes: Int, val descriptionRes: Int) {
        TODO("todo", R.string.feed_label_todo, R.string.feed_desc_todo),
        PRO("pro", R.string.feed_label_pro, R.string.feed_desc_pro),
        WT("wt", R.string.feed_label_wt, R.string.feed_desc_wt),
        WWT("wwt", R.string.feed_label_wwt, R.string.feed_desc_wwt),
        MASC("masc", R.string.feed_label_masc, R.string.feed_desc_masc),
        FEM("fem", R.string.feed_label_fem, R.string.feed_desc_fem),
    }

    /** Etiqueta corta localizada. */
    fun Feed.label(context: Context): String = context.getString(labelRes)

    /** Descripción localizada. */
    fun Feed.description(context: Context): String = context.getString(descriptionRes)

    /** Devuelve la URL https del .ics para un feed y año. */
    fun httpsUrl(feed: Feed, year: Int = LocalDate.now().year): String {
        val file = if (feed.id == "todo") "$year.ics" else "$year-${feed.id}.ics"
        return "https://$FEED_HOST$FEED_PATH/$file"
    }

    /**
     * Construye un intent que añade la suscripción en Google Calendar.
     *
     * Google Calendar web acepta:
     *   `https://www.google.com/calendar/r?cid=<url-encoded-https-ics>`
     * que abre el diálogo "¿Añadir calendario?". Es el único método
     * estable en Android sin permisos extra (`WRITE_CALENDAR` se evita).
     */
    fun subscribeIntent(feed: Feed, year: Int = LocalDate.now().year): Intent {
        val ics = httpsUrl(feed, year)
        val encoded = Uri.encode(ics)
        val gCal = "https://www.google.com/calendar/r?cid=$encoded"
        return Intent(Intent.ACTION_VIEW, Uri.parse(gCal)).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
    }

    /**
     * Intent de respaldo: abre la URL .ics directamente (cualquier app de
     * calendario registrada para `text/calendar` la interceptará).
     */
    fun fallbackIntent(feed: Feed, year: Int = LocalDate.now().year): Intent {
        return Intent(Intent.ACTION_VIEW, Uri.parse(httpsUrl(feed, year))).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
    }

    /** Lanza el flujo de suscripción con fallback automático. */
    fun subscribe(context: Context, feed: Feed, year: Int = LocalDate.now().year) {
        val primary = subscribeIntent(feed, year)
        runCatching { context.startActivity(primary) }
            .onFailure {
                runCatching { context.startActivity(fallbackIntent(feed, year)) }
            }
    }
}
