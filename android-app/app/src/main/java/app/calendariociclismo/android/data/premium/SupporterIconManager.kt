package app.calendariociclismo.android.data.premium

import android.content.ComponentName
import android.content.Context
import android.content.pm.PackageManager

/** Activa exactamente uno de los alias de launcher declarados en el manifest. */
object SupporterIconManager {
    private const val DEFAULT_ALIAS = "app.calendariociclismo.android.LauncherDefault"
    private const val FOUNDER_ALIAS = "app.calendariociclismo.android.LauncherFounder"
    private const val FRIEND_ALIAS = "app.calendariociclismo.android.LauncherFriend"

    fun apply(context: Context, icon: PremiumService.SupporterIcon) {
        val selected = when (icon) {
            PremiumService.SupporterIcon.DEFAULT -> DEFAULT_ALIAS
            PremiumService.SupporterIcon.FOUNDER -> FOUNDER_ALIAS
            PremiumService.SupporterIcon.FRIEND -> FRIEND_ALIAS
        }
        context.packageManager.setComponentEnabledSetting(
            ComponentName(context, selected),
            PackageManager.COMPONENT_ENABLED_STATE_ENABLED,
            PackageManager.DONT_KILL_APP,
        )
        listOf(DEFAULT_ALIAS, FOUNDER_ALIAS, FRIEND_ALIAS).filterNot { it == selected }.forEach { alias ->
            context.packageManager.setComponentEnabledSetting(
                ComponentName(context, alias),
                PackageManager.COMPONENT_ENABLED_STATE_DISABLED,
                PackageManager.DONT_KILL_APP,
            )
        }
    }
}
