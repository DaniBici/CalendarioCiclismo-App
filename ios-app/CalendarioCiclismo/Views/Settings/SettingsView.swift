import SwiftUI

/// Pantalla de ajustes: calendario iCal, notificaciones, privacidad.
/// Accesible desde el botón de engranaje en la vista principal.
struct SettingsView: View {
    @State private var manager = NotificationManager.shared
    @State private var offlineManager = OfflineManager.shared
    @State private var analyticsService = AnalyticsService.shared
    @State private var themeService = ThemeService.shared
    @State private var localeService = LocaleService.shared
    @State private var categoryService = NotificationCategoryService.shared
    @State private var premium = PremiumService.shared
    @State private var showDeleteConfirmation = false
    @State private var showDeleteResult = false
    @State private var deleteSuccess = false
    @State private var showOfflineDisableConfirmation = false
    @State private var cacheSize: String = ""
    /// Estado local del toggle de hápticos. Inicializado desde `Haptics.isEnabled`
    /// en `onAppear` y persistido en `UserDefaults` a través del propio servicio.
    @State private var hapticsEnabled: Bool = Haptics.isEnabled

    private let privacyPolicyURL = URL(string: "https://www.calendariociclismo.app/privacidad.html")
        ?? URL(string: "https://calendariociclismo.app")!
    private var supportStoryURL: URL {
        URL(string: LocaleService.isEnglish
            ? "https://www.calendariociclismo.app/en/support/"
            : "https://www.calendariociclismo.app/apoyar/")!
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 28) {
                // — Sección: apoyo voluntario — primera opción del panel
                premiumSection

                // — Sección: Calendario iCal —
                calendarSection

                // — Sección: Notificaciones —
                notificationsSection

                // — Sección: Modo sin conexión —
                offlineSection

                // — Sección: Experiencia —
                experienceSection

                // — Sección: Idioma —
                languageSection

                // — Sección: Apariencia —
                appearanceSection

                // — Sección: Privacidad —
                privacySection

            }
            .padding(.bottom, 24)
        }
        .background(AppTheme.background.ignoresSafeArea())
        .navigationTitle(localeService.t("Ajustes", "Settings"))
        .navigationBarTitleDisplayMode(.inline)
        .accessibilityIdentifier("settings_view")
        .task {
            await manager.checkCurrentStatus()
            cacheSize = await CacheManager.shared.formattedSize()
        }
        .onAppear {
            AccessibilityAnnouncement.announce(localeService.t("Ajustes: calendario, notificaciones y privacidad", "Settings: calendar, notifications and privacy"))
        }
        .alert(localeService.t("Desactivar modo offline", "Disable offline mode"), isPresented: $showOfflineDisableConfirmation) {
            Button(localeService.t("Cancelar", "Cancel"), role: .cancel) {}
            Button(localeService.t("Desactivar", "Disable"), role: .destructive) {
                Task {
                    await offlineManager.disable()
                    cacheSize = await CacheManager.shared.formattedSize()
                    Haptics.play(.success)
                    AccessibilityAnnouncement.announce(localeService.t("Modo sin conexión desactivado y datos eliminados", "Offline mode disabled and data deleted"))
                }
            }
        } message: {
            Text(localeService.t("Se eliminará toda la información descargada para uso sin conexión. Podrás volver a activarlo en cualquier momento.", "All downloaded data for offline use will be deleted. You can re-enable it at any time."))
        }
        .alert(localeService.t("Eliminar datos", "Delete data"), isPresented: $showDeleteConfirmation) {
            Button(localeService.t("Cancelar", "Cancel"), role: .cancel) {}
            Button(localeService.t("Eliminar", "Delete"), role: .destructive) {
                Task {
                    deleteSuccess = await manager.deleteAllData()
                    Haptics.play(deleteSuccess ? .success : .error)
                    showDeleteResult = true
                    AccessibilityAnnouncement.announce(
                        deleteSuccess
                            ? localeService.t("Datos eliminados correctamente", "Data deleted successfully")
                            : localeService.t("Error al eliminar los datos", "Error deleting data")
                    )
                }
            }
        } message: {
            Text(localeService.t("Se eliminará permanentemente tu token de notificaciones de nuestro servidor. Las notificaciones se desactivarán.", "Your notification token will be permanently deleted from our server. Notifications will be disabled."))
        }
        .alert(localeService.t(deleteSuccess ? "Datos eliminados" : "Error", deleteSuccess ? "Data deleted" : "Error"), isPresented: $showDeleteResult) {
            Button(localeService.t("Aceptar", "OK"), role: .cancel) {}
        } message: {
            Text(localeService.t(
                deleteSuccess
                    ? "Tus datos han sido eliminados correctamente del servidor."
                    : "No se pudieron eliminar los datos. Comprueba tu conexión e inténtalo de nuevo.",
                deleteSuccess
                    ? "Your data has been successfully deleted from the server."
                    : "Data could not be deleted. Check your connection and try again."
            ))
        }
    }

    // MARK: - Calendario iCal

    @ViewBuilder
    private var calendarSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            sectionHeader(icon: "calendar.badge.plus", title: localeService.t("Calendario iCal", "iCal Calendar"))

            Text(localeService.t("Añade las carreras directamente a la app Calendario de tu iPhone. Se actualiza automáticamente.", "Add races directly to your iPhone Calendar app. Updates automatically."))
                .ccFont(.s14)
                .foregroundStyle(.secondary)
                .padding(.horizontal)
                .accessibilityIdentifier("calendar_section_description")

            CalendarFeedList()
                .padding(.horizontal)

            // Footer info
            VStack(alignment: .leading, spacing: 8) {
                notificationBullet(icon: "arrow.triangle.2.circlepath", text: localeService.t("Los calendarios se actualizan cada 6 horas", "Calendars update every 6 hours"))
                notificationBullet(icon: "info.circle", text: localeService.t("Para desuscribirte, ve a Ajustes → Calendario → Cuentas", "To unsubscribe, go to Settings → Calendar → Accounts"))
            }
            .padding(.horizontal)
        }
    }

    // MARK: - Notificaciones

    @ViewBuilder
    private var notificationsSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            sectionHeader(icon: "bell.badge", title: localeService.t("Notificaciones", "Notifications"))

            Text(localeService.t("Recibe avisos sobre grandes actualizaciones de contenido y jornadas señaladas del calendario.", "Receive alerts about major content updates and highlighted calendar days."))
                .ccFont(.s14)
                .foregroundStyle(.secondary)
                .padding(.horizontal)

            VStack(spacing: 12) {
                notificationToggleCard
                statusInfo
            }
            .padding(.horizontal)

            if manager.isSubscribed {
                notificationCategoriesCard
                    .padding(.horizontal)

                // Seguimiento de carreras liberado al plan gratuito.
                if premium.featuresUnlocked {
                    raceFollowCard
                        .padding(.horizontal)
                }
            }
        }
    }

    /// Tarjeta con los 4 tipos de notificación. `general` siempre activa
    /// (no se puede desactivar — baseline gratuito). El resto son Premium
    /// y aparecen deshabilitadas en Fases 1-5.
    private var notificationCategoriesCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(localeService.t("Tipos de notificación", "Notification types"))
                .ccFont(.s13, weight: .semibold)
                .foregroundStyle(.secondary)
                .padding(.horizontal, 4)
                .padding(.top, 2)

            VStack(spacing: 0) {
                ForEach(NotificationCategoryService.NotificationCategory.allCases) { option in
                    notificationCategoryRow(option)
                    if option != NotificationCategoryService.NotificationCategory.allCases.last {
                        Divider()
                            .padding(.leading, 52)
                    }
                }
            }
            .padding(12)
            .ccCardSurface()
            .accessibilityElement(children: .contain)
            .accessibilityLabel("Tipos de notificación")
        }
    }

    private func notificationCategoryRow(_ option: NotificationCategoryService.NotificationCategory) -> some View {
        let isEnabled = categoryService.isEnabled(option)
        // Todas las categorías (race_start/tv_start/results) se liberaron al plan
        // gratuito: ya no hay candado. `.general` sigue siendo baseline gratuito
        // que no se puede desactivar (no degradar lo gratis).
        let isLockedOn = option == .general

        return HStack(spacing: 12) {
            Group {
                if let icon = option.icon {
                    Image(systemName: icon)
                        .font(.body)
                } else {
                    Image("CyclocrossEmblem")
                        .resizable()
                        .scaledToFit()
                        .frame(width: 18, height: 11)
                }
            }
                .foregroundStyle(isEnabled ? Color.primary : Color.secondary)
                .frame(width: 28, height: 28)
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 2) {
                Text(LocalizedStringKey(option.labelKey))
                    .ccFont(.s14, weight: isEnabled ? .semibold : .regular)
                    .foregroundStyle(.primary)
                Text(LocalizedStringKey(option.descriptionKey))
                    .ccFont(.s12)
                    .foregroundStyle(.tertiary)
            }
            .accessibilityHidden(true)

            Spacer(minLength: 0)

            Toggle(LocalizedStringKey(option.labelKey), isOn: Binding(
                get: { isEnabled },
                set: { newValue in
                    guard !isLockedOn else { return }
                    categoryService.setEnabled(option, newValue)
                    Haptics.play(.toggle)
                    // Re-envía el conjunto actualizado al server.
                    Task { await manager.healSubscriptionIfNeeded() }
                }
            ))
            .labelsHidden()
            .tint(Color.accentColor)
            .disabled(isLockedOn)
        }
        .padding(.vertical, 6)
        .padding(.horizontal, 4)
        .contentShape(Rectangle())
        .accessibilityLabel(Text(LocalizedStringKey(option.labelKey)))
        .accessibilityValue(isEnabled ? "Activada" : "Desactivada")
        .accessibilityHint(isLockedOn ? "Siempre activa" : "Pulsa dos veces para alternar")
        .accessibilityAddTraits(isEnabled ? [.isSelected] : [])
        .accessibilityIdentifier("notification_category_\(option.rawValue)")
    }

    // MARK: - Carreras seguidas (tercer nivel notificaciones)

    @State private var raceFollow = RaceFollowService.shared

    private var raceFollowCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(localeService.t("Carreras y jornadas", "Races and stages"))
                .ccFont(.s13, weight: .semibold)
                .foregroundStyle(.secondary)
                .padding(.horizontal, 4)
                .padding(.top, 2)

            VStack(spacing: 0) {
                // Selector de modo
                Picker("Modo", selection: Binding(
                    get: { raceFollow.followMode },
                    set: { raceFollow.setMode($0) }
                )) {
                    Text("Todas").tag(RaceFollowService.FollowMode.followAll)
                    Text("Seleccionadas").tag(RaceFollowService.FollowMode.followRaces)
                    Text("Por filtros").tag(RaceFollowService.FollowMode.followFilters)
                }
                .pickerStyle(.segmented)
                .padding(12)

                Divider()
                    .padding(.horizontal, 12)

                // Contenido según modo
                switch raceFollow.followMode {
                case .followAll:
                    HStack {
                        Image(systemName: "bell.fill")
                            .foregroundStyle(.secondary)
                            .accessibilityHidden(true)
                        Text("Recibes notificaciones de todas las carreras")
                            .ccFont(.s14)
                            .foregroundStyle(.secondary)
                    }
                    .padding(12)

                case .followRaces:
                    NavigationLink(destination: FollowedRacesView()) {
                        HStack {
                            Image(systemName: "heart.fill")
                                .foregroundStyle(.secondary)
                                .accessibilityHidden(true)
                            if raceFollow.followedRaceIds.isEmpty {
                                Text("Sin carreras seguidas")
                                    .ccFont(.s14)
                                    .foregroundStyle(.secondary)
                            } else {
                                Text("\(raceFollow.followedRaceIds.count) \(raceFollow.followedRaceIds.count == 1 ? "carrera seguida" : "carreras seguidas")")
                                    .ccFont(.s14)
                            }
                            Spacer()
                            Image(systemName: "chevron.right")
                                .font(.caption)
                                .foregroundStyle(.tertiary)
                        }
                        .padding(12)
                    }
                    .foregroundStyle(.primary)

                case .followFilters:
                    VStack(spacing: 0) {
                        ForEach(RaceFollowService.GroupFilter.allCases) { filter in
                            raceGroupFilterRow(filter)
                            if filter != RaceFollowService.GroupFilter.allCases.last {
                                Divider()
                                    .padding(.leading, 52)
                            }
                        }
                    }
                    .padding(.horizontal, 4)
                    .padding(.vertical, 4)
                }
            }
            .ccCardSurface()

            // Jornadas seguidas — siempre visible (independiente del modo de carreras)
            NavigationLink(destination: FollowedStagesView()) {
                HStack {
                    Image(systemName: "calendar.badge.clock")
                        .foregroundStyle(.secondary)
                        .accessibilityHidden(true)
                    if raceFollow.followedStageIds.isEmpty {
                        Text("Sin jornadas seguidas")
                            .ccFont(.s14)
                            .foregroundStyle(.secondary)
                    } else {
                        Text("\(raceFollow.followedStageIds.count) \(raceFollow.followedStageIds.count == 1 ? "jornada seguida" : "jornadas seguidas")")
                            .ccFont(.s14)
                    }
                    Spacer()
                    Image(systemName: "chevron.right")
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                }
                .padding(12)
            }
            .foregroundStyle(.primary)
            .ccCardSurface()

            // Carreras de ciclocross seguidas — independiente del modo de carretera
            NavigationLink(destination: FollowedCxRacesView()) {
                HStack {
                    Image("CyclocrossEmblem")
                        .resizable()
                        .scaledToFit()
                        .frame(width: 18, height: 11)
                        .foregroundStyle(.secondary)
                        .accessibilityHidden(true)
                    if raceFollow.followedCxRaceIds.isEmpty {
                        Text("Sin carreras de ciclocross seguidas")
                            .ccFont(.s14)
                            .foregroundStyle(.secondary)
                    } else {
                        Text("\(raceFollow.followedCxRaceIds.count) \(raceFollow.followedCxRaceIds.count == 1 ? "carrera de ciclocross seguida" : "carreras de ciclocross seguidas")")
                            .ccFont(.s14)
                    }
                    Spacer()
                    Image(systemName: "chevron.right")
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                }
                .padding(12)
            }
            .foregroundStyle(.primary)
            .ccCardSurface()
        }
    }

    private func raceGroupFilterRow(_ filter: RaceFollowService.GroupFilter) -> some View {
        let isActive = raceFollow.activeFilters.contains(filter)
        return HStack(spacing: 12) {
            Image(systemName: filter.icon)
                .font(.body)
                .foregroundStyle(isActive ? Color.primary : Color.secondary)
                .frame(width: 28, height: 28)
                .accessibilityHidden(true)

            Text(filter.labelKey)
                .ccFont(.s14)

            Spacer(minLength: 0)

            Toggle(filter.labelKey, isOn: Binding(
                get: { isActive },
                set: { raceFollow.setFilter(filter, $0); Haptics.play(.toggle) }
            ))
            .labelsHidden()
            .tint(Color.accentColor)
        }
        .padding(.vertical, 6)
        .padding(.horizontal, 4)
    }

    // MARK: - Modo sin conexión

    @ViewBuilder
    private var offlineSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            sectionHeader(icon: "icloud.and.arrow.down", title: localeService.t("Modo sin conexión", "Offline mode"))

            Text(localeService.t("Descarga automáticamente los datos de las próximas semanas para consultar el calendario sin conexión.", "Automatically downloads data for the next few weeks so you can browse the calendar offline."))
                .ccFont(.s14)
                .foregroundStyle(.secondary)
                .padding(.horizontal)

            VStack(spacing: 12) {
                // Toggle card
                offlineToggleCard

                // Info de sincronización (solo si está activo)
                if offlineManager.isEnabled {
                    offlineSyncInfo
                }
            }
            .padding(.horizontal)

            // Info bullets
            VStack(alignment: .leading, spacing: 8) {
                offlineBullet(icon: "calendar.day.timeline.leading", text: localeService.t("Agenda de los próximos 14 días", "Schedule for the next 14 days"))
                offlineBullet(icon: "calendar", text: localeService.t("Mes actual y siguiente en vista de Mes", "Current and next month in Month view"))
                offlineBullet(icon: "list.bullet", text: localeService.t("Todas las carreras en vista de Temporada", "All races in Season view"))
                offlineBullet(icon: "arrow.triangle.2.circlepath", text: localeService.t("Se actualiza automáticamente una vez al día", "Updates automatically once a day"))
            }
            .padding(.horizontal)
        }
    }

    private var offlineToggleCard: some View {
        HStack(spacing: 12) {
            Image(systemName: offlineManager.isEnabled ? "checkmark.icloud.fill" : "icloud.slash")
                .font(.title3)
                .foregroundStyle(offlineManager.isEnabled ? Color.primary : Color.secondary)
                .frame(width: 36, height: 36)
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 2) {
                Text(localeService.t("Modo sin conexión", "Offline mode"))
                    .ccFont(.s14, weight: .semibold)

                Text(offlineManager.isEnabled
                     ? localeService.t("Datos disponibles offline", "Data available offline")
                     : localeService.t("Activa para descargar datos", "Enable to download data"))
                    .ccFont(.s12)
                    .foregroundStyle(.secondary)
            }
            .accessibilityHidden(true)

            Spacer(minLength: 0)

            Toggle(localeService.t("Modo sin conexión", "Offline mode"), isOn: Binding(
                get: { offlineManager.isEnabled },
                set: { newValue in
                    if newValue {
                        Task {
                            await offlineManager.enable()
                            cacheSize = await CacheManager.shared.formattedSize()
                            Haptics.play(.success)
                            AccessibilityAnnouncement.announce(localeService.t("Modo sin conexión activado, descargando datos", "Offline mode enabled, downloading data"))
                        }
                    } else {
                        Haptics.play(.warning)
                        showOfflineDisableConfirmation = true
                    }
                }
            ))
            .labelsHidden()
            .tint(Color.accentColor)
            .accessibilityLabel(localeService.t("Modo sin conexión", "Offline mode"))
            .accessibilityValue(offlineManager.isEnabled ? localeService.t("Activado", "Enabled") : localeService.t("Desactivado", "Disabled"))
            .accessibilityHint(offlineManager.isEnabled
                               ? localeService.t("Pulsa dos veces para desactivar y borrar los datos descargados", "Double tap to disable and delete downloaded data")
                               : localeService.t("Pulsa dos veces para activar y descargar datos para uso offline", "Double tap to enable and download data for offline use"))
            .accessibilityInputLabels([localeService.t("Modo sin conexión", "Offline mode"), "Offline", localeService.t("Sin conexión", "No connection")])
            .accessibilityIdentifier(AccessibilityID.offlineToggle)
        }
        .padding(16)
        .ccCardSurface()
    }

    @ViewBuilder
    private var offlineSyncInfo: some View {
        VStack(spacing: 8) {
            // Estado de sincronización
            if offlineManager.isSyncing {
                HStack(spacing: 8) {
                    ProgressView()
                        .scaleEffect(0.8)
                    Text(offlineManager.syncStatusText ?? localeService.t("Sincronizando…", "Syncing…"))
                        .ccFont(.s12)
                        .foregroundStyle(.secondary)
                    Spacer()
                }
                .padding(12)
                .ccCardSurface()
                .accessibilityElement(children: .combine)
                .accessibilityLabel(localeService.t("Sincronización en curso", "Sync in progress"))
            } else {
                // Última sincronización + tamaño
                HStack(spacing: 12) {
                    VStack(alignment: .leading, spacing: 4) {
                        if let label = offlineManager.lastSyncLabel {
                            HStack(spacing: 4) {
                                Image(systemName: "clock")
                                    .font(.caption2)
                                    .accessibilityHidden(true)
                                Text(localeService.t("Última actualización: \(label)", "Last update: \(label)"))
                                    .ccFont(.s12)
                            }
                            .foregroundStyle(.secondary)
                        }

                        if !cacheSize.isEmpty {
                            HStack(spacing: 4) {
                                Image(systemName: "internaldrive")
                                    .font(.caption2)
                                    .accessibilityHidden(true)
                                Text(localeService.t("Espacio utilizado: \(cacheSize)", "Storage used: \(cacheSize)"))
                                    .ccFont(.s12)
                            }
                            .foregroundStyle(.secondary)
                        }
                    }

                    Spacer()

                    // Botón de sincronización manual
                    Button {
                        Task {
                            await offlineManager.performSync()
                            cacheSize = await CacheManager.shared.formattedSize()
                            Haptics.play(.success)
                            AccessibilityAnnouncement.announce("Datos actualizados")
                        }
                    } label: {
                        Image(systemName: "arrow.clockwise")
                    }
                    .buttonStyle(.bordered)
                    .tint(.primary)
                    .accessibilityLabel(localeService.t("Actualizar datos offline", "Update offline data"))
                    .accessibilityHint(localeService.t("Fuerza una sincronización de los datos sin conexión", "Forces a sync of offline data"))
                    .accessibilityIdentifier(AccessibilityID.offlineSyncButton)
                }
                .padding(12)
                .ccCardSurface()
                .accessibilityElement(children: .combine)
                .accessibilityLabel(localeService.t("Información de sincronización offline\(offlineManager.lastSyncLabel.map { ", última actualización \($0)" } ?? "")\(!cacheSize.isEmpty ? ", espacio utilizado \(cacheSize)" : "")", "Offline sync info\(offlineManager.lastSyncLabel.map { ", last update \($0)" } ?? "")\(!cacheSize.isEmpty ? ", storage used \(cacheSize)" : "")"))
            }
        }
    }

    private func offlineBullet(icon: String, text: String) -> some View {
        HStack(spacing: 10) {
            Image(systemName: icon)
                .font(.caption)
                .foregroundStyle(.secondary)
                .frame(width: 20)
                .accessibilityHidden(true)
            Text(text)
                .ccFont(.s12)
                .foregroundStyle(.secondary)
        }
        .accessibilityElement(children: .combine)
    }

    // MARK: - Experiencia

    @ViewBuilder
    private var experienceSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            sectionHeader(icon: "hand.tap", title: localeService.t("Experiencia", "Experience"))

            Text(localeService.t("Ajustes de interacción que solo afectan a esta app.", "Interaction settings that only affect this app."))
                .ccFont(.s14)
                .foregroundStyle(.secondary)
                .padding(.horizontal)

            hapticsToggleCard
                .padding(.horizontal)

            VStack(alignment: .leading, spacing: 8) {
                notificationBullet(
                    icon: "gearshape",
                    text: localeService.t("Si desactivas los retornos en Ajustes → Sonidos, no se sentirán aunque estén activos aquí", "If you disable haptics in Settings → Sounds, they won't be felt even if enabled here")
                )
            }
            .padding(.horizontal)
        }
    }

    // MARK: - Idioma

    @ViewBuilder
    private var languageSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            sectionHeader(icon: "globe", title: localeService.t("Idioma", "Language"))

            Text(localeService.t("Elige el idioma de la aplicación.", "Choose the app language."))
                .ccFont(.s14)
                .foregroundStyle(.secondary)
                .padding(.horizontal)

            languageSelectorCard
                .padding(.horizontal)
        }
    }

    private var languageSelectorCard: some View {
        Picker(localeService.t("Idioma", "Language"), selection: Binding(
            get: { localeService.current },
            set: { option in
                guard option != localeService.current else { return }
                localeService.setLocale(option)
                Haptics.play(.selection)
                AccessibilityAnnouncement.announce("Idioma: \(option.label)")
                Task { await manager.healSubscriptionIfNeeded() }
            }
        )) {
            ForEach(LocaleService.AppLocale.allCases) { option in
                Text(option.label).tag(option)
            }
        }
        .pickerStyle(.segmented)
        .accessibilityIdentifier("language_picker")
    }

    // MARK: - Apariencia

    @ViewBuilder
    private var appearanceSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            sectionHeader(icon: "paintbrush", title: localeService.t("Apariencia", "Appearance"))

            Text(localeService.t("Elige cómo se muestra la app: siempre en claro, siempre en oscuro, o siguiendo el ajuste del sistema.", "Choose how the app looks: always light, always dark, or following the system setting."))
                .ccFont(.s14)
                .foregroundStyle(.secondary)
                .padding(.horizontal)

            themeSelectorCard
                .padding(.horizontal)
        }
    }

    private var themeSelectorCard: some View {
        Picker(localeService.t("Tema", "Theme"), selection: Binding(
            get: { themeService.preference },
            set: { option in
                guard option != themeService.preference else { return }
                themeService.setPreference(option)
                Haptics.play(.selection)
                AccessibilityAnnouncement.announce("Tema: \(option.label)")
            }
        )) {
            ForEach(ThemeService.ThemePreference.allCases) { option in
                Text(option.label).tag(option)
            }
        }
        .pickerStyle(.segmented)
        .accessibilityIdentifier("theme_picker")
    }

    private var hapticsToggleCard: some View {
        HStack(spacing: 12) {
            Image(systemName: hapticsEnabled ? "hand.tap.fill" : "hand.tap")
                .font(.title3)
                .foregroundStyle(hapticsEnabled ? Color.primary : Color.secondary)
                .frame(width: 36, height: 36)
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 2) {
                Text(localeService.t("Retornos hápticos", "Haptic feedback"))
                    .ccFont(.s14, weight: .semibold)

                Text(hapticsEnabled
                     ? localeService.t("Feedback al tocar y navegar", "Feedback when tapping and navigating")
                     : localeService.t("Silenciados en esta app", "Silenced in this app"))
                    .ccFont(.s12)
                    .foregroundStyle(.secondary)
            }
            .accessibilityHidden(true)

            Spacer(minLength: 0)

            Toggle(localeService.t("Retornos hápticos", "Haptic feedback"), isOn: Binding(
                get: { hapticsEnabled },
                set: { newValue in
                    // Persistimos primero, y sólo después disparamos el retorno
                    // para que el usuario "sienta" el nuevo estado (si lo acaba
                    // de activar) o ya no lo sienta (si lo acaba de desactivar).
                    Haptics.setEnabled(newValue)
                    hapticsEnabled = newValue
                    Haptics.play(.toggle)
                }
            ))
            .labelsHidden()
            .tint(Color.accentColor)
            .accessibilityLabel(localeService.t("Retornos hápticos", "Haptic feedback"))
            .accessibilityValue(hapticsEnabled ? localeService.t("Activados", "Enabled") : localeService.t("Desactivados", "Disabled"))
            .accessibilityHint(hapticsEnabled
                               ? localeService.t("Pulsa dos veces para desactivar los retornos de vibración", "Double tap to disable haptic feedback")
                               : localeService.t("Pulsa dos veces para activar los retornos de vibración", "Double tap to enable haptic feedback"))
            .accessibilityInputLabels([localeService.t("Hápticos", "Haptics"), localeService.t("Vibración", "Vibration"), localeService.t("Retornos", "Feedback")])
            .accessibilityIdentifier(AccessibilityID.hapticsToggle)
        }
        .padding(16)
        .ccCardSurface()
    }

    private var analyticsToggleCard: some View {
        HStack(spacing: 12) {
            Image(systemName: analyticsService.isEnabled ? "chart.bar.fill" : "chart.bar")
                .font(.title3)
                .foregroundStyle(analyticsService.isEnabled ? Color.primary : Color.secondary)
                .frame(width: 36, height: 36)
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 2) {
                Text(localeService.t("Estadísticas de uso", "Usage statistics"))
                    .ccFont(.s14, weight: .semibold)

                Text(analyticsService.isEnabled
                     ? localeService.t("Ayudas a mejorar la app", "You help improve the app")
                     : localeService.t("Datos anónimos desactivados", "Anonymous data disabled"))
                    .ccFont(.s12)
                    .foregroundStyle(.secondary)
            }
            .accessibilityHidden(true)

            Spacer(minLength: 0)

            Toggle(localeService.t("Estadísticas de uso", "Usage statistics"), isOn: Binding(
                get: { analyticsService.isEnabled },
                set: { newValue in
                    analyticsService.setEnabled(newValue)
                    Haptics.play(.toggle)
                }
            ))
            .labelsHidden()
            .tint(Color.accentColor)
            .accessibilityLabel(localeService.t("Estadísticas de uso", "Usage statistics"))
            .accessibilityValue(analyticsService.isEnabled ? localeService.t("Activadas", "Enabled") : localeService.t("Desactivadas", "Disabled"))
            .accessibilityHint(analyticsService.isEnabled
                               ? localeService.t("Pulsa dos veces para dejar de compartir datos anónimos de uso", "Double tap to stop sharing anonymous usage data")
                               : localeService.t("Pulsa dos veces para compartir datos anónimos que ayuden a mejorar la app", "Double tap to share anonymous data that helps improve the app"))
            .accessibilityInputLabels([localeService.t("Estadísticas", "Statistics"), "Analytics", localeService.t("Uso", "Usage")])
            .accessibilityIdentifier("analytics_toggle")
        }
        .padding(16)
        .ccCardSurface()
    }

    // MARK: - Sostenimiento

    @ViewBuilder
    private var premiumSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                supportSectionIcon
                Text(localeService.t("Apoyar Calendario Ciclismo", "Support Calendario Ciclismo"))
                    .ccFont(.s20, weight: .bold)
            }
            .padding(.horizontal)
            .accessibilityAddTraits(.isHeader)

            if premium.isSubscribed {
                premiumActiveCard
                    .padding(.horizontal)
            } else if premium.isFounder {
                founderCard
                    .padding(.horizontal)
                premiumCTACard
                    .padding(.horizontal)
            } else {
                premiumCTACard
                    .padding(.horizontal)
                redeemCodeRow
                    .padding(.horizontal)
            }

            if premium.isFounder || premium.isSubscribed {
                supporterIconChooser
                    .padding(.horizontal)
            }

            Text(localeService.t(
                "Todas las funciones son gratuitas. Las aportaciones ayudan a cubrir servidores, herramientas y mantenimiento.",
                "Every feature is free. Contributions help cover servers, tools and maintenance."
            ))
            .ccFont(.s12)
            .foregroundStyle(.secondary)
            .padding(.horizontal)

            supportStoryLink
                .padding(.horizontal)

            #if DEBUG
            premiumDebugCard
                .padding(.horizontal)
            #endif
        }
    }

    private var supportStoryLink: some View {
        Link(destination: supportStoryURL) {
            HStack(spacing: 10) {
                Image(systemName: "info.circle")
                    .foregroundStyle(.secondary)
                    .accessibilityHidden(true)
                Text(localeService.t(
                    "Por qué ahora es gratis y sin anuncios",
                    "Why it is now free and ad-free"
                ))
                .ccFont(.s14)
                Spacer(minLength: 0)
                Image(systemName: "arrow.up.right")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
                    .accessibilityHidden(true)
            }
            .padding(14)
            .ccCardSurface()
        }
        .buttonStyle(.plain)
        .accessibilityHint(localeService.t(
            "Abre la explicación pública del cambio",
            "Opens the public explanation of the change"
        ))
    }

    private var premiumCTACard: some View {
        Button {
            premium.presentSupport()
        } label: {
            HStack(spacing: 12) {
                Image("SupportIconFriend")
                    .resizable()
                    .scaledToFit()
                    .frame(width: 36, height: 36)
                    .clipShape(RoundedRectangle(cornerRadius: AppTheme.Radius.surface))
                    .accessibilityHidden(true)

                VStack(alignment: .leading, spacing: 2) {
                    Text(localeService.t("Hazte Amigo de Calendario Ciclismo", "Become a Friend of Calendario Ciclismo"))
                        .ccFont(.s14, weight: .semibold)
                    Text(localeService.t("Una aportación voluntaria para sostener un proyecto abierto y gratuito.", "A voluntary contribution to sustain an open and free project."))
                        .ccFont(.s12)
                        .foregroundStyle(.secondary)
                }
                .accessibilityHidden(true)

                Spacer(minLength: 0)

                Image(systemName: "chevron.right")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
                    .accessibilityHidden(true)
            }
            .padding(16)
            .ccCardSurface()
        }
        .buttonStyle(.plain)
        .accessibilityLabel(localeService.t("Hacerme amigo", "Become a Friend"))
        .accessibilityHint(localeService.t("Abre las opciones voluntarias de sostenimiento", "Opens the voluntary support options"))
    }

    /// Fila de "Canjear código" para quien no es Amigo ni Fundador. Sin esta
    /// entrada, un código promocional exigiría abrir antes la hoja de apoyo.
    private var redeemCodeRow: some View {
        Button {
            Haptics.play(.selection)
            premium.presentCodeRedemption()
        } label: {
            HStack(spacing: 12) {
                Image(systemName: "ticket")
                    .font(.body)
                    .foregroundStyle(.secondary)
                    .frame(width: 36, height: 36)
                    .background(Color(.tertiarySystemBackground))
                    .clipShape(RoundedRectangle(cornerRadius: AppTheme.Radius.surface))
                    .accessibilityHidden(true)

                Text(localeService.t("Canjear código", "Redeem code"))
                    .ccFont(.s14)
                    .foregroundStyle(.primary)

                Spacer(minLength: 0)

                Image(systemName: "chevron.right")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
                    .accessibilityHidden(true)
            }
            .padding(16)
            .ccCardSurface()
        }
        .buttonStyle(.plain)
        .accessibilityLabel(localeService.t("Canjear código", "Redeem code"))
        .accessibilityHint(localeService.t("Introduce un código de oferta o promoción", "Enter an offer or promo code"))
    }

    private var premiumActiveCard: some View {
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                Image("SupportIconFriend")
                    .resizable()
                    .scaledToFit()
                    .frame(width: 36, height: 36)
                    .clipShape(RoundedRectangle(cornerRadius: AppTheme.Radius.surface))
                    .accessibilityHidden(true)

                VStack(alignment: .leading, spacing: 2) {
                    Text(localeService.t("Amigo activo", "Friend active"))
                        .ccFont(.s14, weight: .semibold)
                    Text(localeService.t("Gracias por ayudar a sostener el proyecto.", "Thank you for helping sustain the project."))
                        .ccFont(.s12)
                        .foregroundStyle(.secondary)
                }
                Spacer(minLength: 0)
            }
            .padding(16)

            Divider()

            Button {
                premium.cancelSubscription()
            } label: {
                HStack {
                    Text(localeService.t("Gestionar suscripción", "Manage subscription"))
                        .ccFont(.s14)
                    Spacer()
                    Image(systemName: "arrow.up.right.square")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                .padding(16)
            }
            .buttonStyle(.plain)
            .accessibilityHint(localeService.t("Abre la pantalla del sistema para gestionar la suscripción", "Opens the system screen to manage your subscription"))

            Divider()

            Button {
                Haptics.play(.selection)
                premium.presentCodeRedemption()
            } label: {
                HStack {
                    Text(localeService.t("Canjear código", "Redeem code"))
                        .ccFont(.s14)
                    Spacer()
                    Image(systemName: "ticket")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                .padding(16)
            }
            .buttonStyle(.plain)
            .accessibilityHint(localeService.t("Introduce un código de oferta o promoción", "Enter an offer or promo code"))
        }
        .ccCardSurface()
    }

    private var founderCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label(localeService.t("Fundador", "Founder"), systemImage: "medal.fill")
                .ccFont(.s16, weight: .semibold)
                .foregroundStyle(.orange)
            Text(localeService.t(
                "Tu Premium anterior no se convertirá en otra suscripción. Conservas para siempre el icono Fundador.",
                "Your previous Premium plan will not become another subscription. You keep the Founder icon permanently."
            ))
            .ccFont(.s12)
            .foregroundStyle(.secondary)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .ccCardSurface()
    }

    private var supportSectionIcon: some View {
        Image("OriginalAppIcon")
            .resizable()
            .scaledToFit()
            .frame(width: 28, height: 28)
            .clipShape(RoundedRectangle(cornerRadius: AppTheme.Radius.control, style: .continuous))
            .accessibilityHidden(true)
    }

    private var supporterIconChooser: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(localeService.t("Icono de la aplicación", "App icon"))
                .ccFont(.s14, weight: .semibold)
            HStack(spacing: 8) {
                iconChoice(.standard, label: localeService.t("Original", "Original"), imageName: "OriginalAppIcon")
                if premium.isFounder {
                    iconChoice(.founder, label: localeService.t("Fundador", "Founder"), imageName: "SupportIconFounder")
                }
                if premium.isSubscribed {
                    iconChoice(.friend, label: localeService.t("Amigo", "Friend"), imageName: "SupportIconFriend")
                }
            }
        }
        .padding(16)
        .ccCardSurface()
    }

    private func iconChoice(
        _ icon: PremiumService.SupporterIcon,
        label: String,
        imageName: String
    ) -> some View {
        Button {
            premium.setSupporterIcon(icon)
        } label: {
            VStack(spacing: 5) {
                Image(imageName)
                    .resizable()
                    .scaledToFit()
                    .frame(width: 42, height: 42)
                    .clipShape(RoundedRectangle(cornerRadius: AppTheme.Radius.surface))
                    .overlay {
                        RoundedRectangle(cornerRadius: AppTheme.Radius.surface)
                            .stroke(Color.primary.opacity(0.12), lineWidth: 0.5)
                    }
                Text(label)
                    .ccFont(.s12)
                if premium.supporterIcon == icon {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            .frame(maxWidth: .infinity)
        }
        .buttonStyle(.plain)
    }

    #if DEBUG
    /// Solo en builds Debug. Permite forzar el flag Premium para validar
    /// la UI sin tener una compra real. NO se compila en Release.
    private var premiumDebugCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("DEBUG")
                .ccFont(.s12, weight: .bold)
                .foregroundStyle(.orange)
                .padding(.horizontal, 6)
                .padding(.vertical, 2)
                .background(Color.orange.opacity(0.15))
                .clipShape(RoundedRectangle(cornerRadius: AppTheme.Radius.control))

            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Forzar membresía Amigo")
                        .ccFont(.s14, weight: .semibold)
                    Text("Toggle solo visible en builds Debug.")
                        .ccFont(.s12)
                        .foregroundStyle(.secondary)
                }
                Spacer(minLength: 0)
                Toggle("Forzar Amigo", isOn: Binding(
                    get: { premium.isSubscribed },
                    set: { premium._debugSetSubscribed($0) }
                ))
                .labelsHidden()
                .tint(.orange)
            }
        }
        .padding(16)
        .ccCardSurface()
    }
    #endif

    // MARK: - Privacidad

    @ViewBuilder
    private var privacySection: some View {
        VStack(alignment: .leading, spacing: 12) {
            sectionHeader(icon: "lock.shield", title: localeService.t("Privacidad", "Privacy"))

            VStack(spacing: 8) {
                // Toggle de estadísticas de uso
                analyticsToggleCard
                    .padding(.bottom, 4)

                // Enlace a política de privacidad
                Link(destination: privacyPolicyURL) {
                    HStack(spacing: 12) {
                        Image(systemName: "doc.text")
                            .font(.body)
                            .foregroundStyle(.secondary)
                            .frame(width: 28, height: 28)
                            .accessibilityHidden(true)

                        Text(localeService.t("Política de privacidad", "Privacy policy"))
                            .ccFont(.s14)
                            .foregroundStyle(.primary)

                        Spacer(minLength: 0)

                        Image(systemName: "arrow.up.right")
                            .font(.caption)
                            .foregroundStyle(.tertiary)
                            .accessibilityHidden(true)
                    }
                    .padding(14)
                    .ccCardSurface()
                }
                .accessibilityLabel(localeService.t("Política de privacidad", "Privacy policy"))
                .accessibilityHint(localeService.t("Se abrirá en el navegador", "Will open in browser"))
                .accessibilityInputLabels([localeService.t("Política de privacidad", "Privacy policy"), localeService.t("Privacidad", "Privacy")])
                .accessibilityIdentifier("privacy_policy_link")

                // Botón de eliminación de datos
                Button {
                    Haptics.play(.warning)
                    showDeleteConfirmation = true
                } label: {
                    HStack(spacing: 12) {
                        Image(systemName: "trash")
                            .font(.body)
                            .foregroundStyle(.red)
                            .frame(width: 28, height: 28)
                            .accessibilityHidden(true)

                        VStack(alignment: .leading, spacing: 2) {
                            Text(localeService.t("Eliminar mis datos", "Delete my data"))
                                .ccFont(.s14)
                                .foregroundStyle(.red)
                            Text(localeService.t("Borra tu token de notificaciones del servidor", "Deletes your notification token from the server"))
                                .ccFont(.s12)
                                .foregroundStyle(.secondary)
                        }

                        Spacer(minLength: 0)
                    }
                    .padding(14)
                    .ccCardSurface()
                }
                .accessibilityLabel(localeService.t("Eliminar mis datos", "Delete my data"))
                .accessibilityHint(localeService.t("Borra permanentemente tu token de notificaciones del servidor", "Permanently deletes your notification token from the server"))
                .accessibilityInputLabels([localeService.t("Eliminar mis datos", "Delete my data"), localeService.t("Borrar datos", "Delete data"), localeService.t("Eliminar", "Delete")])
                .accessibilityIdentifier("delete_data_button")
            }
            .padding(.horizontal)
        }
    }

    // MARK: - Helpers

    private func sectionHeader(icon: String, title: String) -> some View {
        HStack(spacing: 8) {
            Image(systemName: icon)
                .font(.title3)
                .foregroundStyle(.secondary)
                .accessibilityHidden(true)
            Text(title)
                .ccFont(.s20, weight: .bold)
        }
        .padding(.horizontal)
        .accessibilityAddTraits(.isHeader)
    }

    private var notificationToggleCard: some View {
        HStack(spacing: 12) {
            Image(systemName: manager.isSubscribed ? "bell.fill" : "bell.slash")
                .font(.title3)
                .foregroundStyle(manager.isSubscribed ? Color.primary : Color.secondary)
                .frame(width: 36, height: 36)
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 2) {
                Text(localeService.t("Notificaciones push", "Push notifications"))
                    .ccFont(.s14, weight: .semibold)

                Text(manager.isSubscribed
                     ? localeService.t("Recibirás avisos importantes", "You will receive important alerts")
                     : localeService.t("Activa para recibir avisos", "Enable to receive alerts"))
                    .ccFont(.s12)
                    .foregroundStyle(.secondary)
            }
            .accessibilityHidden(true)

            Spacer(minLength: 0)

            Toggle(localeService.t("Notificaciones push", "Push notifications"), isOn: Binding(
                get: { manager.isSubscribed },
                set: { newValue in
                    Task {
                        if newValue {
                            await manager.subscribe()
                            Haptics.play(.success)
                            AccessibilityAnnouncement.announce(localeService.t("Notificaciones activadas", "Notifications enabled"))
                        } else {
                            await manager.unsubscribe()
                            Haptics.play(.toggle)
                            AccessibilityAnnouncement.announce(localeService.t("Notificaciones desactivadas", "Notifications disabled"))
                        }
                    }
                }
            ))
            .labelsHidden()
            .tint(Color.accentColor)
            .accessibilityLabel(localeService.t("Notificaciones push", "Push notifications"))
            .accessibilityValue(manager.isSubscribed ? localeService.t("Activadas", "Enabled") : localeService.t("Desactivadas", "Disabled"))
            .accessibilityHint(manager.isSubscribed
                               ? localeService.t("Pulsa dos veces para desactivar las notificaciones", "Double tap to disable notifications")
                               : localeService.t("Pulsa dos veces para activar las notificaciones", "Double tap to enable notifications"))
            .accessibilityInputLabels([localeService.t("Notificaciones push", "Push notifications"), localeService.t("Notificaciones", "Notifications"), localeService.t("Avisos", "Alerts")])
            .accessibilityIdentifier(AccessibilityID.notificationsToggle)
        }
        .padding(16)
        .ccCardSurface()
    }

    @ViewBuilder
    private var statusInfo: some View {
        switch manager.authorizationStatus {
        case .denied:
            HStack(spacing: 8) {
                Image(systemName: "exclamationmark.triangle")
                    .font(.caption)
                    .foregroundStyle(.orange)
                    .accessibilityHidden(true)
                Text(localeService.t("Las notificaciones están bloqueadas en Ajustes del sistema. Actívalas en Ajustes → Notificaciones → Calendario Ciclismo.", "Notifications are blocked in system Settings. Enable them in Settings → Notifications → Calendario Ciclismo."))
                    .ccFont(.s12)
                    .foregroundStyle(.secondary)
            }
            .padding(.horizontal, 4)
            .accessibilityElement(children: .combine)
            .accessibilityLabel(localeService.t("Aviso: las notificaciones están bloqueadas en Ajustes del sistema. Actívalas en Ajustes, Notificaciones, Calendario Ciclismo.", "Warning: notifications are blocked in system Settings. Enable them in Settings, Notifications, Calendario Ciclismo."))
            .accessibilityIdentifier(AccessibilityID.notificationsDeniedWarning)
        default:
            EmptyView()
        }
    }

    private func notificationBullet(icon: String, text: String) -> some View {
        HStack(spacing: 10) {
            Image(systemName: icon)
                .font(.caption)
                .foregroundStyle(.secondary)
                .frame(width: 20)
                .accessibilityHidden(true)
            Text(text)
                .ccFont(.s12)
                .foregroundStyle(.secondary)
        }
        .accessibilityElement(children: .combine)
    }
}


// MARK: - Calendar Feed List (extracted from SubscribeView)

/// Los 6 calendarios iCal disponibles para suscripción.
private struct CalendarFeed: Identifiable {
    let id: String
    let label: String
    let description: String
    let icon: String

    func webcalURL(year: Int) -> URL? {
        let file = id == "todo" ? "\(year).ics" : "\(year)-\(id).ics"
        // `webcal://` es el único esquema que iOS Calendar reconoce para
        // suscripciones (webcals:// es solo macOS y silencia la apertura en iOS).
        // iOS lo convierte a http:// al refrescar → necesita que Cloudflare NO
        // redirija HTTP→HTTPS en feed.calendariociclismo.app.
        return URL(string: "webcal://feed.calendariociclismo.app/feed/\(file)")
    }
}

private struct CalendarFeedList: View {
    @Environment(\.openURL) private var openURL
    @State private var subscribedFeed: String?

    private var year: Int { RaceLogic.calendarYear() }

    private var localizedFeeds: [CalendarFeed] {
        [
            CalendarFeed(id: "todo", label: LocaleService.t("Todo", "All"), description: LocaleService.t("Todas las categorías, ambos géneros", "All categories, both genders"), icon: "calendar"),
            CalendarFeed(id: "pro", label: "Pro", description: LocaleService.t("Todas las categorías hasta .1", "All categories up to .1"), icon: "star"),
            CalendarFeed(id: "wt", label: "WorldTour", description: LocaleService.t("UCI WorldTour masculino (1.UWT / 2.UWT)", "UCI WorldTour men's (1.UWT / 2.UWT)"), icon: "globe.europe.africa"),
            CalendarFeed(id: "wwt", label: "WWT", description: LocaleService.t("UCI WorldTour femenino (1.WWT / 2.WWT)", "UCI WorldTour women's (1.WWT / 2.WWT)"), icon: "globe.europe.africa.fill"),
            CalendarFeed(id: "masc", label: LocaleService.t("Masculino", "Men's"), description: LocaleService.t("Todas las pruebas hasta .1", "All events up to .1"), icon: "figure.outdoor.cycle"),
            CalendarFeed(id: "fem", label: LocaleService.t("Femenino", "Women's"), description: LocaleService.t("Todas las pruebas hasta .1 y también .2 europeas", "All events up to .1 and also European .2"), icon: "figure.outdoor.cycle"),
        ]
    }

    var body: some View {
        VStack(spacing: 8) {
            ForEach(localizedFeeds) { feed in
                FeedCard(
                    feed: feed,
                    year: year,
                    isSubscribed: subscribedFeed == feed.id,
                    onSubscribe: { subscribeTo(feed) }
                )
            }
        }
    }

    private func subscribeTo(_ feed: CalendarFeed) {
        guard let url = feed.webcalURL(year: year) else { return }
        Haptics.play(.primaryAction)
        subscribedFeed = feed.id
        openURL(url)
    }
}

/// Tarjeta individual de un feed de calendario.
private struct FeedCard: View {
    let feed: CalendarFeed
    let year: Int
    let isSubscribed: Bool
    let onSubscribe: () -> Void

    var body: some View {
        Button(action: onSubscribe) {
            HStack(spacing: 12) {
                Image(systemName: feed.icon)
                    .font(.title3)
                    .foregroundStyle(.secondary)
                    .frame(width: 36, height: 36)
                    .accessibilityHidden(true)

                VStack(alignment: .leading, spacing: 2) {
                    Text(feed.label)
                        .ccFont(.s14, weight: .semibold)
                        .foregroundStyle(.primary)

                    Text(feed.description)
                        .ccFont(.s12)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }

                Spacer(minLength: 0)

                Label(
                    isSubscribed ? LocaleService.t("Añadido", "Added") : LocaleService.t("Añadir", "Add"),
                    systemImage: isSubscribed ? "checkmark" : "plus"
                )
                .ccFont(.s12, weight: .semibold)
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
                .background(isSubscribed ? AppTheme.green.opacity(0.15) : AppTheme.neutralFill)
                .foregroundStyle(isSubscribed ? AppTheme.green : Color.primary)
                .clipShape(RoundedRectangle(cornerRadius: AppTheme.Radius.control))
            }
            .padding(12)
            .ccCardSurface()
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(LocaleService.t("Calendario", "Calendar")) \(feed.label), \(feed.description)")
        .accessibilityValue(isSubscribed ? LocaleService.t("Añadido", "Added") : LocaleService.t("No añadido", "Not added"))
        .accessibilityHint(isSubscribed ? LocaleService.t("Ya estás suscrito", "Already subscribed") : LocaleService.t("Pulsa dos veces para suscribirte", "Double tap to subscribe"))
        .accessibilityAddTraits(isSubscribed ? [.isSelected] : [])
        .accessibilityIdentifier(AccessibilityID.feedCard(feed.id))
        .accessibilityInputLabels(["\(LocaleService.t("Suscribirse a", "Subscribe to")) \(feed.label)", feed.label, "\(LocaleService.t("Calendario", "Calendar")) \(feed.label)"])
    }
}
