package app.calendariociclismo.android.ui.navigation

import android.app.Activity
import androidx.activity.compose.BackHandler
import android.os.Bundle
import androidx.compose.foundation.background
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.CalendarToday
import androidx.compose.material.icons.filled.EmojiEvents
import androidx.compose.material.icons.filled.SyncAlt
import app.calendariociclismo.android.ui.cyclocross.CyclocrossScreen
import app.calendariociclismo.android.ui.cyclocross.CxRaceScreen
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.NavigationRailItemDefaults
import androidx.compose.material3.adaptive.currentWindowAdaptiveInfo
import androidx.compose.material3.adaptive.navigationsuite.NavigationSuiteDefaults
import androidx.compose.material3.adaptive.navigationsuite.NavigationSuiteScaffoldDefaults
import androidx.compose.material3.adaptive.navigationsuite.NavigationSuiteType
import androidx.compose.material3.adaptive.navigationsuite.NavigationSuiteScaffold
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.material3.adaptive.navigationsuite.rememberNavigationSuiteScaffoldState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.rememberVectorPainter
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
import app.calendariociclismo.android.ui.settings.FollowedCxRacesScreen
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
import app.calendariociclismo.android.ui.today.HighlightsBannerState
import app.calendariociclismo.android.ui.today.TodayScreen
import app.calendariociclismo.android.util.Haptics
import app.calendariociclismo.android.util.RoadTodayAvailability
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import app.calendariociclismo.android.util.rememberHaptics
import com.google.android.play.core.review.ReviewManagerFactory
import kotlinx.coroutines.tasks.await

/**
 * Navegación principal adaptativa: barra inferior en móvil y rail en ventanas
 * amplias. Ajustes se abre desde la cabecera de Hoy o, mientras Hoy está
 * oculta ([RoadTodayAvailability]), desde la de Ciclocross, en paridad con iOS.
 */
@Composable
fun AppNavHost(navController: NavHostController) {
    val backStackEntry by navController.currentBackStackEntryAsState()
    val currentRoute = backStackEntry?.destination?.route
    val haptic = rememberHaptics()
    val app = rememberApp()
    val context = LocalContext.current
    val isSubscribed by app.premium.isSubscribed.collectAsState()
    val legacyPremiumActive by app.premium.isLegacyPremiumActive.collectAsState()
    var showContributionPrompt by remember { mutableStateOf(false) }
    // Hoy de carretera: se evalúa al arrancar y al volver a primer plano.
    var todayVisible by remember { mutableStateOf(RoadTodayAvailability.isVisible()) }
    val lifecycleOwner = LocalLifecycleOwner.current
    LaunchedEffect(lifecycleOwner) {
        lifecycleOwner.lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
            todayVisible = RoadTodayAvailability.isVisible()
        }
    }
    // Con Hoy oculta, la pestaña Ciclocross muestra Hoy de carretera tras
    // elegir «Ruta» en su conmutador. No se conserva entre aperturas.
    var showsRoadToday by rememberSaveable { mutableStateOf(false) }
    val mainTabs = Routes.mainTabs(todayVisible)
    val homeRoute = Routes.home(todayVisible)
    // El destino inicial se fija al crear el grafo: cambiarlo reiniciaría la
    // pila de navegación al reanudar.
    val startRoute = remember { homeRoute }
    // Con Hoy oculta, la pestaña Ciclocross se rotula Hoy, con su icono:
    // alberga la agenda de Ciclocross y, desde el conmutador, Hoy de carretera.
    val tabs = mainTabs.map { route ->
        if (!todayVisible && route == Routes.CYCLOCROSS) HomeTab
        else allTabs.first { it.route == route }
    }

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
            // La ficha y la página de torneo de ciclocross loggean "cx_race" y
            // "cx_tournament" desde su pantalla, con el nombre; aquí solo
            // llegaría la plantilla de la ruta, sin identidad.
            currentRoute.startsWith("cx_race/") -> return@LaunchedEffect
            currentRoute.startsWith("cx_tournament/") -> return@LaunchedEffect
            else -> currentRoute
        }

        app.analytics.logScreenView(screenName)
    }

    LaunchedEffect(currentRoute, isSubscribed, legacyPremiumActive) {
        val route = currentRoute ?: return@LaunchedEffect
        val contentRoute = route in mainTabs || route.startsWith("race/") ||
            route.startsWith("stage/") || route.startsWith("elevation_profile/") ||
            route.startsWith("route_map/") || route.startsWith("startlist/") ||
            route.startsWith("start_order/") || route.startsWith("results/") ||
            route.startsWith("transfers_team/")
        if (!contentRoute) return@LaunchedEffect
        val meaningfulAction = route.startsWith("race/") || route.startsWith("stage/") ||
            route.startsWith("elevation_profile/") || route.startsWith("route_map/") ||
            route.startsWith("startlist/") || route.startsWith("start_order/") ||
            route.startsWith("results/") || route.startsWith("transfers_team/")
        if (app.preferences.recordContributionContentView(
                route == homeRoute,
                isSubscribed || legacyPremiumActive,
                meaningfulAction,
            )
        ) {
            showContributionPrompt = true
            app.analytics.logEvent("contribution_prompt_view")
        }
        if (app.preferences.recordReviewContentView(route == homeRoute, meaningfulAction)) {
            val activity = context as? Activity ?: return@LaunchedEffect
            app.preferences.markReviewRequested()
            runCatching {
                val manager = ReviewManagerFactory.create(context)
                val reviewInfo = manager.requestReviewFlow().await()
                manager.launchReviewFlow(activity, reviewInfo).await()
            }.onFailure { error ->
                app.analytics.logEvent("review_prompt_error", Bundle().apply {
                    putString("reason", error::class.simpleName)
                })
            }
        }
    }

    val showPrimaryNavigation = currentRoute in mainTabs
    val navigationSuiteState = rememberNavigationSuiteScaffoldState()
    val tabLabels = tabs.map { stringResource(it.labelRes) }
    LaunchedEffect(showPrimaryNavigation) {
        if (showPrimaryNavigation) navigationSuiteState.show() else navigationSuiteState.hide()
    }

    // La suite cambia automáticamente entre barra inferior y rail lateral según
    // la ventana disponible. Las rutas de detalle —incluidos dorsales y orden de
    // salida— siguen siendo destinos jerárquicos y ocultan la navegación primaria.
    // Barra inferior y rail sobre la superficie de las tarjetas (blanca en
    // claro, tono de tarjeta en oscuro). Pestaña activa en acento, sin la
    // píldora indicadora de Material.
    val colors = MaterialTheme.colorScheme
    val itemColors = NavigationSuiteDefaults.itemColors(
        navigationBarItemColors = NavigationBarItemDefaults.colors(
            selectedIconColor = colors.primary,
            selectedTextColor = colors.primary,
            indicatorColor = Color.Transparent,
            unselectedIconColor = colors.onSurfaceVariant,
            unselectedTextColor = colors.onSurfaceVariant,
        ),
        navigationRailItemColors = NavigationRailItemDefaults.colors(
            selectedIconColor = colors.primary,
            selectedTextColor = colors.primary,
            indicatorColor = Color.Transparent,
            unselectedIconColor = colors.onSurfaceVariant,
            unselectedTextColor = colors.onSurfaceVariant,
        ),
    )
    val navigationSuiteColors = NavigationSuiteDefaults.colors(
        navigationBarContainerColor = colors.surface,
        navigationRailContainerColor = colors.surface,
    )
    val layoutType = NavigationSuiteScaffoldDefaults.calculateFromAdaptiveInfo(currentWindowAdaptiveInfo())
    val bottomBar = layoutType == NavigationSuiteType.NavigationBar
    fun isSelected(tab: TabItem) = currentRoute == tab.route ||
        (currentRoute != null && tab.route == currentRoute.split("/").firstOrNull())
    val onTabClick: (TabItem) -> Unit = { tab ->
        if (!isSelected(tab)) {
            haptic(Haptics.Event.Navigation)
            navController.navigate(tab.route) {
                popUpTo(navController.graph.findStartDestination().id) { saveState = true }
                launchSingleTop = true
                restoreState = true
            }
        }
    }
    val tabIcon: @Composable (TabItem, String) -> Unit = { tab, label ->
        Icon(
            painter = tab.iconResource?.let { painterResource(it) }
                ?: rememberVectorPainter(requireNotNull(tab.icon)),
            contentDescription = label,
            modifier = Modifier.size(
                width = if (tab.iconResource == R.drawable.ic_cyclocross) 36.dp else 24.dp,
                height = 24.dp,
            ),
        )
    }
    val tabLabel: @Composable (String, Boolean) -> Unit = { label, selected ->
        Text(
            text = label,
            style = MaterialTheme.typography.labelSmall,
            fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal,
            maxLines = 1,
            softWrap = false,
            overflow = TextOverflow.Clip,
        )
    }
    NavigationSuiteScaffold(
        state = navigationSuiteState,
        // En móvil la barra inferior se dibuja aquí debajo (ancho acotado por
        // pestaña); la suite solo aporta el rail lateral de pantallas anchas.
        layoutType = if (bottomBar) NavigationSuiteType.None else layoutType,
        containerColor = MaterialTheme.colorScheme.background,
        navigationSuiteColors = navigationSuiteColors,
        navigationSuiteItems = {
            tabs.forEachIndexed { index, tab ->
                val selected = isSelected(tab)
                val label = tabLabels[index]
                item(
                    selected = selected,
                    onClick = { onTabClick(tab) },
                    icon = { tabIcon(tab, label) },
                    label = { tabLabel(label, selected) },
                    colors = itemColors,
                )
            }
        },
    ) {
        Column(modifier = Modifier.fillMaxSize()) {
            Box(modifier = Modifier.weight(1f).fillMaxWidth()) {
            NavHost(
                navController = navController,
                startDestination = startRoute,
                modifier = Modifier
                    .background(MaterialTheme.colorScheme.background),
            ) {
                composable(Routes.TODAY) { TodayScreen(navController) }
                composable(Routes.RESULTS_FEED) { ResultsFeedScreen(navController) }
                composable(Routes.CALENDAR) { CalendarScreen(navController) }
                composable(Routes.CYCLOCROSS) {
                    val showsRoad = !todayVisible && showsRoadToday
                    // Atrás desde Hoy de carretera vuelve a la agenda de Ciclocross.
                    BackHandler(enabled = showsRoad) { showsRoadToday = false }
                    // Cada vista conserva su estado guardado al alternar.
                    val disciplineStates = rememberSaveableStateHolder()
                    // Cintillo común (Ciclocross y carretera): un único estado
                    // para las dos vistas, de modo que alternar no lo recarga
                    // ni reinicia el carrusel.
                    val homeHighlights = remember { HighlightsBannerState(listOf("cx", "road")) }
                    disciplineStates.SaveableStateProvider(if (showsRoad) "road" else "cyclocross") {
                        if (showsRoad) {
                            TodayScreen(navController, onSelectCyclocross = { showsRoadToday = false }, highlights = homeHighlights)
                        } else {
                            CyclocrossScreen(
                                navController,
                                showSettingsShortcut = !todayVisible,
                                roadTodayVisible = todayVisible,
                                onSelectRoad = if (todayVisible) null else { { showsRoadToday = true } },
                                highlights = if (todayVisible) null else homeHighlights,
                            )
                        }
                    }
                }
                composable(Routes.CX_TOURNAMENT, arguments = listOf(
                    navArgument("tournamentId") { type = NavType.StringType },
                    navArgument("season") { type = NavType.StringType },
                    navArgument("name") { type = NavType.StringType },
                    navArgument("logo") { type = NavType.StringType; nullable = true; defaultValue = null },
                )) { entry -> CyclocrossScreen(navController, entry.arguments?.getString("tournamentId"), entry.arguments?.getString("season"), entry.arguments?.getString("name"), entry.arguments?.getString("logo")) }
                composable(Routes.CX_RACE, arguments = listOf(
                    navArgument("raceId") { type = NavType.StringType },
                    navArgument("category") { type = NavType.StringType; nullable = true; defaultValue = null },
                    navArgument("title") { type = NavType.StringType; nullable = true; defaultValue = null },
                )) { entry -> CxRaceScreen(navController, entry.arguments?.getString("raceId").orEmpty(), entry.arguments?.getString("category"), entry.arguments?.getString("title")) }
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
                        navArgument("title") { type = NavType.StringType; nullable = true; defaultValue = null },
                    ),
                ) { entry ->
                    StageScreen(
                        stageId = entry.arguments?.getString("stageId").orEmpty(),
                        raceId = entry.arguments?.getString("raceId"),
                        titleHint = entry.arguments?.getString("title"),
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

                composable(route = Routes.FOLLOWED_CX_RACES) {
                    FollowedCxRacesScreen(navController = navController)
                }

                composable(route = Routes.CHAMPIONSHIPS) {
                    ChampionshipsScreen(navController = navController)
                }
            }
            }
            // Con cuatro pestañas la barra de Material las repartía por todo el
            // ancho y quedaban muy separadas: cada pestaña ocupa como máximo
            // BottomBarItemMaxWidth y el conjunto se centra sobre la superficie.
            AnimatedVisibility(visible = bottomBar && showPrimaryNavigation) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(colors.surface),
                    contentAlignment = Alignment.TopCenter,
                ) {
                    NavigationBar(
                        modifier = Modifier.widthIn(max = BottomBarItemMaxWidth * tabs.size),
                        containerColor = Color.Transparent,
                    ) {
                        tabs.forEachIndexed { index, tab ->
                            val selected = isSelected(tab)
                            val label = tabLabels[index]
                            NavigationBarItem(
                                selected = selected,
                                onClick = { onTabClick(tab) },
                                icon = { tabIcon(tab, label) },
                                label = { tabLabel(label, selected) },
                                colors = itemColors.navigationBarItemColors,
                            )
                        }
                    }
                }
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
                    app.premium.presentSupport()
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
private data class TabItem(
    val route: String,
    val labelRes: Int,
    val icon: ImageVector? = null,
    val iconResource: Int? = null,
)

private val BottomBarItemMaxWidth = 80.dp

private val allTabs = listOf(
    TabItem(Routes.TODAY, R.string.tab_today, Icons.Filled.CalendarToday),
    TabItem(Routes.RESULTS_FEED, R.string.tab_results, Icons.Filled.EmojiEvents),
    TabItem(Routes.TRANSFERS, R.string.tab_transfers, Icons.Filled.SyncAlt),
    TabItem(Routes.CYCLOCROSS, R.string.tab_cyclocross, iconResource = R.drawable.ic_cyclocross),
    TabItem(Routes.CALENDAR, R.string.tab_calendar, Icons.Filled.CalendarMonth),
)

/** Pestaña Ciclocross rotulada Hoy mientras Hoy de carretera está oculta. */
private val HomeTab = TabItem(Routes.CYCLOCROSS, R.string.tab_today, Icons.Filled.CalendarToday)
