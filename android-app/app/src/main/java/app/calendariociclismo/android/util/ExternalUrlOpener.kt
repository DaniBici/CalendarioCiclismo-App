package app.calendariociclismo.android.util

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import androidx.browser.customtabs.CustomTabsIntent
import androidx.core.net.toUri

/**
 * Abre los hosts con app preferida en esa app si está instalada. Cuando el
 * sistema solo dispone de navegadores, mantiene el enlace dentro de Calendario
 * Ciclismo mediante Custom Tabs.
 */
fun openExternalUrl(context: Context, url: String) {
    val uri = url.toUri()
    if (RaceLogic.prefersNativeApp(url) && openInNativeApp(context, uri)) return
    runCatching {
        CustomTabsIntent.Builder().setShowTitle(true).build().launchUrl(context, uri)
    }
}

/**
 * Apertura de emisiones y enlaces externos de las fichas (carretera y
 * ciclocross): sin red avisa mediante `onOffline`; con red, app nativa
 * (YouTube, HBO Max, X) o Custom Tabs.
 */
fun openExternalLink(context: Context, url: String, onOffline: () -> Unit) {
    if (!NetworkMonitor.isOnline(context)) {
        onOffline()
        return
    }
    openExternalUrl(context, url)
}

private fun openInNativeApp(context: Context, uri: Uri): Boolean {
    val intent = Intent(Intent.ACTION_VIEW, uri).apply {
        addCategory(Intent.CATEGORY_BROWSABLE)
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    }

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        intent.addFlags(Intent.FLAG_ACTIVITY_REQUIRE_NON_BROWSER)
        return try {
            context.startActivity(intent)
            true
        } catch (_: ActivityNotFoundException) {
            false
        }
    }

    // En Android 8–10 la visibilidad de paquetes no está restringida: se
    // selecciona un manejador del enlace que no resuelva una URL web genérica.
    val packageManager = context.packageManager
    val genericWebIntent = Intent(Intent.ACTION_VIEW, Uri.parse("https://example.com")).apply {
        addCategory(Intent.CATEGORY_BROWSABLE)
    }
    val browserPackages = packageManager
        .queryIntentActivities(genericWebIntent, 0)
        .mapTo(mutableSetOf()) { it.activityInfo.packageName }
    val nativeHandler = packageManager
        .queryIntentActivities(intent, 0)
        .firstOrNull { it.activityInfo.packageName !in browserPackages }
        ?: return false

    return runCatching {
        context.startActivity(intent.setPackage(nativeHandler.activityInfo.packageName))
        true
    }.getOrDefault(false)
}
