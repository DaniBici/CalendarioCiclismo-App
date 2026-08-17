package app.calendariociclismo.android.ui.navigation

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.CalendarToday
import androidx.compose.material.icons.filled.EmojiEvents
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.SyncAlt
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.graphics.vector.ImageVector
import app.calendariociclismo.android.R
import androidx.navigation.NavDestination.Companion.hierarchy
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.navArgument
import app.calendariociclismo.android.ui.calendar.CalendarScreen
import app.calendariociclismo.android.ui.championships.ChampionshipsScreen
import app.calendariociclismo.android.ui.race.RaceScreen
import app.calendariociclismo.android.ui.resultsfeed.ResultsFeedScreen
import app.calendariociclismo.android.ui.settings.FollowedRacesScreen
import app.calendariociclismo.android.ui.settings.FollowedStagesScreen
import app.calendariociclismo.android.ui.settings.SettingsScreen

import app.calendariociclismo.android.ui.stage.StageScreen
import app.calendariociclismo.android.ui.stage.ElevationProfileScreen
import app.calendariociclismo.android.ui.map.RouteMapScreen
import app.calendariociclismo.android.ui.results.ResultsScreen
import app.calendariociclismo.android.ui.startlist.StartlistScreen
import app.calendariociclismo.android.ui.startorder.StartOrderScreen
import app.calendariociclismo.android.ui.transfers.TransfersScreen
import app.calendariociclismo.android.ui.transfers.TransfersTeamScreen
import app.calendariociclismo.android.ui.rememberApp
import app.calendariociclismo.android.data.premium.PremiumService
import app.calendariociclismo.android.ui.today.TodayScreen
import app.calendariociclismo.android.util.Haptics
import app.calendariociclismo.android.util.rememberHaptics

/**
 * Scaffold principal con bottom bar de 5 pestañas + NavHost.
 * Pestañas 3.1: Hoy / Resultados / Calendario (Mes+Temporada fusionadas) /
 * Buscar / Ajustes — paridad con iOS.
 */
@Composable
fun AppNavHost(navController: NavHostController) {
    val backStackEntry by navController.currentBackStackEntryAsState()
    val currentRoute = backStackEntry?.destination?.route
    val haptic = rememberHaptics()
    val app = rememberApp()
    val isSubscribed by app.premium.isSubscribed.collectAsState()
    val legacyPremiumActive by app.premium.isLegacyPremiumActive.collectAsState()
    var showContributionPrompt by remember { mutableStateOf(false) }

    // Registrar pantalla visible en Firebase Analytics.
    // today, results_feed, calendar (month/season), transfers se loggean desde
    // sus pantallas con parámetros. race_detail, stage_detail, elevation_profile
    // también se loggean desde sus pantallas. Mantener paridad con iOS.
    LaunchedEffect(currentRoute) {
        if (currentRoute == null) return@LaunchedEffect

        val screenName = when {
            currentRoute == Routes.TODAY -> return@LaunchedEffect
            currentRoute == Routes.RESULTS_FEED -> return@LaunchedEffect
            currentRoute == Routes.CALENDAR -> return@LaunchedEffect
            currentRoute == Routes.TRANSFERS -> return@LaunchedEffect
            currentRoute == Routes.SETTINGS -> "settings"
            currentRoute.startsWith("race/") -> return@LaunchedEffect
            currentRoute.startsWith("stage/") -> return@LaunchedEffect
            currentRoute.startsWith("elevation_profile/") -> return@LaunchedEffect
            // El mapa del recorrido loggea "route_map" desde su pantalla.
            currentRoute.startsWith("route_map/") -> return@LaunchedEffect
            // La ficha de corredor loggea "rider_profile" desde su pantalla.
            currentRoute.startsWith("rider/") -> return@LaunchedEffect
            else -> currentRoute
        }

        app.analytics.logScreenView(screenName)
    }

    LaunchedEffect(currentRoute, isSubscribed, legacyPremiumActive) {
        val route = currentRoute ?: return@LaunchedEffect
        val contentRoute = route in Routes.MAIN_TABS || route.startsWith("race/") ||
            route.startsWith("stage/") || route.startsWith("elevation_profile/") ||
            route.startsWith("route_map/") || route.startsWith("startlist/") ||
            route.startsWith("start_order/") || route.startsWith("results/") ||
            route.startsWith("transfers_team/")
        if (!contentRoute) return@LaunchedEffect
        if (app.preferences.recordContributionContentView(
                route == Routes.TODAY,
                isSubscribed || legacyPremiumActive,
            )
        ) {
            showContributionPrompt = true
            app.analytics.logEvent("contribution_prompt_view")
        }
    }

    // Scaffold exterior solo se encarga de la bottom bar; cada pantalla tiene
    // su propio Scaffold con TopAppBar y gestiona sus insets superiores. Por
    // eso pasamos `contentWindowInsets = WindowInsets(0)` y consumimos el
    // padding que nos da el Scaffold, para que no se sume dos veces el inset
    // del status bar.
    Scaffold(
        contentWindowInsets = WindowInsets(0),
        bottomBar = {
            if (currentRoute in Routes.MAIN_TABS) {
                AppBottomBar(currentRoute = currentRoute, onSelect = { dest ->
                    haptic(Haptics.Event.Navigation)
                    navController.navigate(dest) {
                        popUpTo(navController.graph.findStartDestination().id) { saveState = true }
                        launchSingleTop = true
                        restoreState = true
                    }
                })
            }
        }
    ) { padding ->
        NavHost(
            navController = navController,
            startDestination = Routes.TODAY,
            modifier = Modifier
                .padding(padding)
                .consumeWindowInsets(padding),
        ) {
            composable(Routes.TODAY) { TodayScreen(navController) }
            composable(Routes.RESULTS_FEED) { ResultsFeedScreen(navController) }
            composable(Routes.CALENDAR) { CalendarScreen(navController) }
            composable(Routes.TRANSFERS) { TransfersScreen(navController, showBackArrow = false) }
            composable(Routes.TRANSFERS_HIGHLIGHT) { TransfersScreen(navController, showBackArrow = true) }
            composable(Routes.SETTINGS) { SettingsScreen(navController) }

            composable(
                route = Routes.TRANSFERS_TEAM,
                arguments = listOf(navArgument("teamId") { type = NavType.StringType }),
            ) { entry ->
                TransfersTeamScreen(
                    teamId = entry.arguments?.getString("teamId").orEmpty(),
                    navController = navController,
                )
            }

            composable(
                route = Routes.RACE,
                arguments = listOf(navArgument("raceId") { type = NavType.StringType }),
            ) { entry ->
                RaceScreen(
                    raceId = entry.arguments?.getString("raceId").orEmpty(),
                    navController = navController,
                )
            }
            composable(
                route = Routes.STAGE,
                arguments = listOf(
                    navArgument("stageId") { type = NavType.StringType },
                    navArgument("raceId") { type = NavType.StringType; nullable = true; defaultValue = null },
                ),
            ) { entry ->
                StageScreen(
                    stageId = entry.arguments?.getString("stageId").orEmpty(),
                    raceId = entry.arguments?.getString("raceId"),
                    navController = navController,
                )
            }

            composable(
                route = "elevation_profile/{rdId}",
                arguments = listOf(navArgument("rdId") { type = NavType.StringType }),
            ) { entry ->
                ElevationProfileScreen(
                    rdId = entry.arguments?.getString("rdId").orEmpty(),
                    navController = navController,
                )
            }

            composable(
                route = Routes.ROUTE_MAP,
                arguments = listOf(navArgument("rdId") { type = NavType.StringType }),
            ) { entry ->
                RouteMapScreen(
                    rdId = entry.arguments?.getString("rdId").orEmpty(),
                    navController = navController,
                )
            }

            composable(
                route = Routes.STARTLIST,
                arguments = listOf(navArgument("raceId") { type = NavType.StringType }),
            ) { entry ->
                StartlistScreen(
                    raceId = entry.arguments?.getString("raceId").orEmpty(),
                    navController = navController,
                    app = app,
                    context = LocalContext.current,
                )
            }

            composable(
                route = Routes.START_ORDER,
                arguments = listOf(navArgument("raceDayId") { type = NavType.StringType }),
            ) { entry ->
                StartOrderScreen(
                    raceDayId = entry.arguments?.getString("raceDayId").orEmpty(),
                    navController = navController,
                )
            }

            composable(
                route = Routes.RESULTS,
                arguments = listOf(
                    navArgument("raceId") { type = NavType.StringType },
                    navArgument("stage") { type = NavType.StringType; nullable = true; defaultValue = null },
                    navArgument("sfx") { type = NavType.StringType; nullable = true; defaultValue = null },
                    navArgument("class") { type = NavType.StringType; nullable = true; defaultValue = null },
                ),
            ) { entry ->
                ResultsScreen(
                    raceId = entry.arguments?.getString("raceId").orEmpty(),
                    initialStageNumber = entry.arguments?.getString("stage")?.toIntOrNull(),
                    initialStageSuffix = entry.arguments?.getString("sfx"),
                    initialClassKind = entry.arguments?.getString("class"),
                    navController = navController,
                )
            }

            composable(route = Routes.FOLLOWED_RACES) {
                FollowedRacesScreen(navController = navController)
            }

            composable(route = Routes.FOLLOWED_STAGES) {
                FollowedStagesScreen(navController = navController)
            }

            composable(route = Routes.CHAMPIONSHIPS) {
                ChampionshipsScreen(navController = navController)
            }
        }
    }

    if (showContributionPrompt) {
        AlertDialog(
            onDismissRequest = {
                showContributionPrompt = false
                app.analytics.logEvent("contribution_prompt_action")
            },
            title = { Text(stringResource(R.string.contribution_prompt_title)) },
            text = { Text(stringResource(R.string.contribution_prompt_body)) },
            confirmButton = {
                TextButton(onClick = {
                    showContributionPrompt = false
                    app.analytics.logEvent("contribution_prompt_action")
                    app.premium.presentPaywall(PremiumService.PaywallSource.GENERAL)
                }) { Text(stringResource(R.string.contribution_prompt_open)) }
            },
            dismissButton = {
                TextButton(onClick = {
                    showContributionPrompt = false
                    app.analytics.logEvent("contribution_prompt_action")
                }) { Text(stringResource(R.string.contribution_prompt_later)) }
            },
        )
        LaunchedEffect(Unit) { app.preferences.recordContributionPromptDecision() }
    }

}

/**
 * `labelRes` se resuelve via `stringResource(...)` en cada render —
 * cambia automáticamente al idioma activo cuando el usuario lo modifica.
 */
private data class TabItem(val route: String, val labelRes: Int, val icon: ImageVector)

private val tabs = listOf(
    TabItem(Routes.TODAY, R.string.tab_today, Icons.Filled.CalendarToday),
    TabItem(Routes.RESULTS_FEED, R.string.tab_results, Icons.Filled.EmojiEvents),
    TabItem(Routes.TRANSFERS, R.string.tab_transfers, Icons.Filled.SyncAlt),
    TabItem(Routes.CALENDAR, R.string.tab_calendar, Icons.Filled.CalendarMonth),
    TabItem(Routes.SETTINGS, R.string.tab_settings, Icons.Filled.Settings),
)

/**
 * Barra inferior con el lenguaje del cintillo: superficie del tema con un
 * hairline superior fino (sin la sombra/tono por defecto de M3), y el ítem
 * activo marcado con una cápsula azul de marca al 15% bajo el icono — el mismo
 * gesto suave que los chips de filtro y el día seleccionado.
 */
@Composable
private fun AppBottomBar(currentRoute: String?, onSelect: (String) -> Unit) {
    val primary = MaterialTheme.colorScheme.primary
    Surface(
        color = MaterialTheme.colorScheme.background,
        contentColor = MaterialTheme.colorScheme.onSurface,
    ) {
        Column {
            // Hairline de definición superior (sustituye la sombra de M3).
            HorizontalDivider(
                thickness = 0.5.dp,
                color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.08f),
            )
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .navigationBarsPadding()
                    .padding(horizontal = 8.dp, vertical = 8.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                tabs.forEach { tab ->
                    val selected = currentRoute == tab.route ||
                        (currentRoute != null && tab.route == currentRoute.split("/").firstOrNull())
                    val label = stringResource(tab.labelRes)
                    val tint = if (selected) primary else MaterialTheme.colorScheme.onSurfaceVariant
                    Column(
                        modifier = Modifier
                            .weight(1f)
                            .clip(RoundedCornerShape(16.dp))
                            .clickable(role = Role.Tab) { if (!selected) onSelect(tab.route) }
                            .semantics { this.selected = selected }
                            .padding(vertical = 4.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(2.dp),
                    ) {
                        // Cápsula azul suave bajo el icono cuando está activo.
                        Box(
                            modifier = Modifier
                                .clip(RoundedCornerShape(50))
                                .background(
                                    if (selected) primary.copy(alpha = 0.15f) else Color.Transparent
                                )
                                .padding(horizontal = 16.dp, vertical = 3.dp),
                            contentAlignment = Alignment.Center,
                        ) {
                            Icon(
                                tab.icon,
                                contentDescription = label,
                                tint = tint,
                                modifier = Modifier.size(22.dp),
                            )
                        }
                        Text(
                            text = label,
                            style = MaterialTheme.typography.labelSmall,
                            fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal,
                            color = tint,
                            maxLines = 1,
                        )
                    }
                }
            }
        }
    }
}
