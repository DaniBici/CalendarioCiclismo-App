import SwiftUI

/// Pantalla de ajustes: calendario iCal, notificaciones, privacidad.
/// Accesible desde el botón de engranaje en la vista principal.
struct SettingsView: View {
    @State private var manager = NotificationManager.shared
    @State private var offlineManager = OfflineManager.shared
    @State private var analyticsService = AnalyticsService.shared
    @State private var themeService = ThemeService.shared
    @State private var localeService = LocaleService.shared
    @State private var regionService = RegionService.shared
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

                // — Sección: Región —
                regionSection

                // — Sección: Apariencia —
                appearanceSection

                // — Sección: Privacidad —
                privacySection

            }
            .padding(.bottom, 24)
        }
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
                .font(.subheadline)
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
                .font(.subheadline)
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
            Text("Tipos de notificación")
                .font(.caption)
                .fontWeight(.semibold)
                .foregroundStyle(.secondary)
                .textCase(.uppercase)
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
            Image(systemName: option.icon)
                .font(.body)
                .foregroundStyle(isEnabled ? .white : Color.accentColor)
                .frame(width: 28, height: 28)
                .background(
                    (isEnabled ? Color.accentColor : Color.accentColor.opacity(0.12))
                )
                .clipShape(RoundedRectangle(cornerRadius: 8))
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 2) {
                Text(LocalizedStringKey(option.labelKey))
                    .font(.subheadline)
                    .fontWeight(isEnabled ? .semibold : .regular)
                    .foregroundStyle(.primary)
                Text(LocalizedStringKey(option.descriptionKey))
                    .font(.caption)
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
            Text("Carreras y jornadas")
                .font(.caption)
                .fontWeight(.semibold)
                .foregroundStyle(.secondary)
                .textCase(.uppercase)
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
                            .foregroundStyle(Color.accentColor)
                            .accessibilityHidden(true)
                        Text("Recibes notificaciones de todas las carreras")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                    .padding(12)

                case .followRaces:
                    NavigationLink(destination: FollowedRacesView()) {
                        HStack {
                            Image(systemName: "heart.fill")
                                .foregroundStyle(Color.accentColor)
                                .accessibilityHidden(true)
                            if raceFollow.followedRaceIds.isEmpty {
                                Text("Sin carreras seguidas")
                                    .font(.subheadline)
                                    .foregroundStyle(.secondary)
                            } else {
                                Text("\(raceFollow.followedRaceIds.count) \(raceFollow.followedRaceIds.count == 1 ? "carrera seguida" : "carreras seguidas")")
                                    .font(.subheadline)
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
                        .foregroundStyle(Color.accentColor)
                        .accessibilityHidden(true)
                    if raceFollow.followedStageIds.isEmpty {
                        Text("Sin jornadas seguidas")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    } else {
                        Text("\(raceFollow.followedStageIds.count) \(raceFollow.followedStageIds.count == 1 ? "jornada seguida" : "jornadas seguidas")")
                            .font(.subheadline)
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
                .foregroundStyle(isActive ? .white : Color.accentColor)
                .frame(width: 28, height: 28)
                .background(isActive ? Color.accentColor : Color.accentColor.opacity(0.12))
                .clipShape(RoundedRectangle(cornerRadius: 8))
                .accessibilityHidden(true)

            Text(filter.labelKey)
                .font(.subheadline)

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
                .font(.subheadline)
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
                .foregroundStyle(offlineManager.isEnabled ? Color.accentColor : .secondary)
                .frame(width: 36, height: 36)
                .background(
                    (offlineManager.isEnabled ? Color.accentColor : Color.gray)
                        .opacity(0.1)
                )
                .clipShape(RoundedRectangle(cornerRadius: 8))
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 2) {
                Text(localeService.t("Modo sin conexión", "Offline mode"))
                    .font(.subheadline)
                    .fontWeight(.semibold)

                Text(offlineManager.isEnabled
                     ? localeService.t("Datos disponibles offline", "Data available offline")
                     : localeService.t("Activa para descargar datos", "Enable to download data"))
                    .font(.caption)
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
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Spacer()
                }
                .padding(12)
                .background(AppTheme.cardBackground)
                .clipShape(RoundedRectangle(cornerRadius: 10))
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
                                    .font(.caption)
                            }
                            .foregroundStyle(.secondary)
                        }

                        if !cacheSize.isEmpty {
                            HStack(spacing: 4) {
                                Image(systemName: "internaldrive")
                                    .font(.caption2)
                                    .accessibilityHidden(true)
                                Text(localeService.t("Espacio utilizado: \(cacheSize)", "Storage used: \(cacheSize)"))
                                    .font(.caption)
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
                            .font(.caption)
                            .foregroundStyle(Color.accentColor)
                            .padding(8)
                            .background(Color.accentColor.opacity(0.1))
                            .clipShape(Circle())
                    }
                    .accessibilityLabel(localeService.t("Actualizar datos offline", "Update offline data"))
                    .accessibilityHint(localeService.t("Fuerza una sincronización de los datos sin conexión", "Forces a sync of offline data"))
                    .accessibilityIdentifier(AccessibilityID.offlineSyncButton)
                }
                .padding(12)
                .background(AppTheme.cardBackground)
                .clipShape(RoundedRectangle(cornerRadius: 10))
                .accessibilityElement(children: .combine)
                .accessibilityLabel(localeService.t("Información de sincronización offline\(offlineManager.lastSyncLabel.map { ", última actualización \($0)" } ?? "")\(!cacheSize.isEmpty ? ", espacio utilizado \(cacheSize)" : "")", "Offline sync info\(offlineManager.lastSyncLabel.map { ", last update \($0)" } ?? "")\(!cacheSize.isEmpty ? ", storage used \(cacheSize)" : "")"))
            }
        }
    }

    private func offlineBullet(icon: String, text: String) -> some View {
        HStack(spacing: 10) {
            Image(systemName: icon)
                .font(.caption)
                .foregroundStyle(Color.accentColor)
                .frame(width: 20)
                .accessibilityHidden(true)
            Text(text)
                .font(.caption)
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
                .font(.subheadline)
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
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .padding(.horizontal)

            languageSelectorCard
                .padding(.horizontal)
        }
    }

    private var languageSelectorCard: some View {
        VStack(spacing: 8) {
            ForEach(LocaleService.AppLocale.allCases) { option in
                languageOptionRow(option)
            }
        }
        .padding(12)
        .ccCardSurface()
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Selector de idioma de la app")
    }

    private func languageOptionRow(_ option: LocaleService.AppLocale) -> some View {
        let isSelected = localeService.current == option
        return Button {
            guard !isSelected else { return }
            localeService.setLocale(option)
            Haptics.play(.selection)
            AccessibilityAnnouncement.announce("Idioma: \(option.label)")
            Task { await manager.healSubscriptionIfNeeded() }
        } label: {
            HStack(spacing: 12) {
                Text(flagEmoji(for: option))
                    .font(.body)
                    .frame(width: 28, height: 28)
                    .background(Color.accentColor.opacity(isSelected ? 0.18 : 0.12))
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                    .accessibilityHidden(true)

                Text(option.label)
                    .font(.subheadline)
                    .fontWeight(isSelected ? .semibold : .regular)
                    .foregroundStyle(.primary)

                Spacer(minLength: 0)

                if isSelected {
                    Image(systemName: "checkmark")
                        .font(.caption.weight(.bold))
                        .foregroundStyle(Color.accentColor)
                        .accessibilityHidden(true)
                }
            }
            .padding(.vertical, 6)
            .padding(.horizontal, 4)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(option.label)
        .accessibilityAddTraits(isSelected ? [.isSelected, .isButton] : [.isButton])
        .accessibilityIdentifier("language_option_\(option.rawValue)")
    }

    private func flagEmoji(for locale: LocaleService.AppLocale) -> String {
        switch locale {
        case .spanish: return "🇪🇸"
        case .english: return "🇬🇧"
        }
    }

    // MARK: - Región

    @ViewBuilder
    private var regionSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            sectionHeader(icon: "globe.europe.africa", title: localeService.t("Región", "Region"))

            Text(localeService.t("Determina los canales de televisión que ves en cada jornada.", "Determines the TV channels shown for each stage."))
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .padding(.horizontal)

            regionSelectorCard
                .padding(.horizontal)
        }
    }

    private var regionSelectorCard: some View {
        VStack(spacing: 8) {
            ForEach(RegionService.RegionPreference.allCases) { option in
                regionOptionRow(option)
                // Sub-selector inline expandido bajo el bucket activo, salvo
                // SPAIN (un único grupo) y ALL (usa siempre TZ).
                if regionService.current == option
                    && option.availableCountryGroups.count > 1 {
                    countryGroupSubSelector(for: option)
                        .transition(.opacity.combined(with: .move(edge: .top)))
                }
            }
        }
        .padding(12)
        .ccCardSurface()
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Selector de región de la app")
    }

    private func regionOptionRow(_ option: RegionService.RegionPreference) -> some View {
        let isSelected = regionService.current == option
        // Todas las regiones se liberaron al plan gratuito: cualquiera es
        // seleccionable sin candado (SPAIN sigue siendo el baseline).
        return Button {
            guard !isSelected else { return }
            withAnimation(.easeInOut(duration: 0.2)) {
                regionService.setRegion(option)
            }
            Haptics.play(.selection)
        } label: {
            HStack(spacing: 12) {
                Text(option.flagEmoji)
                    .font(.body)
                    .frame(width: 28, height: 28)
                    .background(Color.accentColor.opacity(isSelected ? 0.18 : 0.12))
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                    .accessibilityHidden(true)

                VStack(alignment: .leading, spacing: 2) {
                    Text(LocalizedStringKey(option.labelKey))
                        .font(.subheadline)
                        .fontWeight(isSelected ? .semibold : .regular)
                        .foregroundStyle(.primary)
                }

                Spacer(minLength: 0)

                if isSelected {
                    Image(systemName: "checkmark")
                        .font(.caption.weight(.bold))
                        .foregroundStyle(Color.accentColor)
                        .accessibilityHidden(true)
                }
            }
            .padding(.vertical, 6)
            .padding(.horizontal, 4)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(LocalizedStringKey(option.labelKey)))
        .accessibilityAddTraits(isSelected ? [.isSelected, .isButton] : [.isButton])
        .accessibilityIdentifier("region_option_\(option.rawValue)")
    }

    @ViewBuilder
    private func countryGroupSubSelector(for bucket: RegionService.RegionPreference) -> some View {
        let groups = bucket.availableCountryGroups
        VStack(alignment: .leading, spacing: 6) {
            Text("Tu país (ajusta la hora del aviso de TV)")
                .font(.caption)
                .foregroundStyle(.secondary)
                .padding(.horizontal, 4)
                .padding(.top, 4)

            VStack(spacing: 4) {
                countryGroupRow(group: nil, isSelected: regionService.preferredCountryGroup == nil)
                ForEach(groups, id: \.self) { group in
                    countryGroupRow(group: group, isSelected: regionService.preferredCountryGroup == group)
                }
            }
        }
        .padding(8)
        .background(Color.accentColor.opacity(0.06))
        .clipShape(RoundedRectangle(cornerRadius: 10))
        .padding(.leading, 36)
        .padding(.bottom, 4)
    }

    private func countryGroupRow(group: String?, isSelected: Bool) -> some View {
        Button {
            guard !isSelected else { return }
            regionService.setPreferredCountryGroup(group)
            // Re-sincroniza el push token con el nuevo grupo fino.
            Task { await manager.healSubscriptionIfNeeded() }
            Haptics.play(.selection)
        } label: {
            HStack(spacing: 10) {
                Text(group.map { RegionService.countryGroupEmoji($0) } ?? "📍")
                    .font(.footnote)
                    .frame(width: 22, height: 22)
                    .accessibilityHidden(true)

                Text(group.map { LocalizedStringKey(RegionService.countryGroupLabel($0)) }
                     ?? LocalizedStringKey("Automático (mi zona horaria)"))
                    .font(.footnote)
                    .fontWeight(isSelected ? .semibold : .regular)
                    .foregroundStyle(.primary)

                Spacer(minLength: 0)

                if isSelected {
                    Image(systemName: "checkmark")
                        .font(.caption2.weight(.bold))
                        .foregroundStyle(Color.accentColor)
                        .accessibilityHidden(true)
                }
            }
            .padding(.vertical, 4)
            .padding(.horizontal, 6)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(isSelected ? [.isSelected, .isButton] : [.isButton])
    }

    // MARK: - Apariencia

    @ViewBuilder
    private var appearanceSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            sectionHeader(icon: "paintbrush", title: localeService.t("Apariencia", "Appearance"))

            Text(localeService.t("Elige cómo se muestra la app: siempre en claro, siempre en oscuro, o siguiendo el ajuste del sistema.", "Choose how the app looks: always light, always dark, or following the system setting."))
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .padding(.horizontal)

            themeSelectorCard
                .padding(.horizontal)
        }
    }

    private var themeSelectorCard: some View {
        VStack(spacing: 8) {
            ForEach(ThemeService.ThemePreference.allCases) { option in
                themeOptionRow(option)
            }
        }
        .padding(12)
        .ccCardSurface()
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Selector de tema de la app")
    }

    private func themeOptionRow(_ option: ThemeService.ThemePreference) -> some View {
        let isSelected = themeService.preference == option
        return Button {
            guard !isSelected else { return }
            themeService.setPreference(option)
            Haptics.play(.selection)
            AccessibilityAnnouncement.announce("Tema: \(option.label)")
        } label: {
            HStack(spacing: 12) {
                Image(systemName: option.icon)
                    .font(.body)
                    .foregroundStyle(isSelected ? .white : Color.accentColor)
                    .frame(width: 28, height: 28)
                    .background(
                        (isSelected ? Color.accentColor : Color.accentColor.opacity(0.12))
                    )
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                    .accessibilityHidden(true)

                Text(option.label)
                    .font(.subheadline)
                    .fontWeight(isSelected ? .semibold : .regular)
                    .foregroundStyle(.primary)

                Spacer(minLength: 0)

                if isSelected {
                    Image(systemName: "checkmark")
                        .font(.caption.weight(.bold))
                        .foregroundStyle(Color.accentColor)
                        .accessibilityHidden(true)
                }
            }
            .padding(.vertical, 6)
            .padding(.horizontal, 4)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(option.label)
        .accessibilityAddTraits(isSelected ? [.isSelected, .isButton] : [.isButton])
        .accessibilityHint(isSelected ? "Opción seleccionada" : "Pulsa dos veces para cambiar al tema \(option.label)")
        .accessibilityInputLabels([option.label])
        .accessibilityIdentifier("theme_option_\(option.rawValue)")
    }

    private var hapticsToggleCard: some View {
        HStack(spacing: 12) {
            Image(systemName: hapticsEnabled ? "hand.tap.fill" : "hand.tap")
                .font(.title3)
                .foregroundStyle(hapticsEnabled ? Color.accentColor : .secondary)
                .frame(width: 36, height: 36)
                .background(
                    (hapticsEnabled ? Color.accentColor : Color.gray)
                        .opacity(0.1)
                )
                .clipShape(RoundedRectangle(cornerRadius: 8))
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 2) {
                Text(localeService.t("Retornos hápticos", "Haptic feedback"))
                    .font(.subheadline)
                    .fontWeight(.semibold)

                Text(hapticsEnabled
                     ? localeService.t("Feedback al tocar y navegar", "Feedback when tapping and navigating")
                     : localeService.t("Silenciados en esta app", "Silenced in this app"))
                    .font(.caption)
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
                .foregroundStyle(analyticsService.isEnabled ? Color.accentColor : .secondary)
                .frame(width: 36, height: 36)
                .background(
                    (analyticsService.isEnabled ? Color.accentColor : Color.gray)
                        .opacity(0.1)
                )
                .clipShape(RoundedRectangle(cornerRadius: 8))
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 2) {
                Text(localeService.t("Estadísticas de uso", "Usage statistics"))
                    .font(.subheadline)
                    .fontWeight(.semibold)

                Text(analyticsService.isEnabled
                     ? localeService.t("Ayudas a mejorar la app", "You help improve the app")
                     : localeService.t("Datos anónimos desactivados", "Anonymous data disabled"))
                    .font(.caption)
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
                HStack(spacing: 3) {
                    Image(systemName: "calendar")
                        .font(.title3)
                    Image(systemName: "bicycle")
                        .font(.title3)
                }
                .foregroundStyle(LinearGradient(
                    colors: [.yellow, .orange],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                ))
                .accessibilityHidden(true)
                Text(localeService.t("Apoyar Calendario Ciclismo", "Support Calendario Ciclismo"))
                    .font(.title3)
                    .fontWeight(.bold)
            }
            .padding(.horizontal)
            .accessibilityAddTraits(.isHeader)

            if premium.isLegacyPremiumActive {
                founderCard
                    .padding(.horizontal)
            } else if premium.isSubscribed {
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
            .font(.caption)
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
                    .foregroundStyle(Color.accentColor)
                    .accessibilityHidden(true)
                Text(localeService.t(
                    "Por qué ahora es gratis y sin anuncios",
                    "Why it is now free and ad-free"
                ))
                .font(.subheadline)
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
            premium.presentPaywall(.general)
        } label: {
            HStack(spacing: 12) {
                HStack(spacing: 2) {
                    Image(systemName: "calendar")
                        .font(.caption)
                    Image(systemName: "bicycle")
                        .font(.caption)
                }
                .foregroundStyle(LinearGradient(
                    colors: [.yellow, .orange],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                ))
                .frame(width: 36, height: 36)
                .background(Color.yellow.opacity(0.12))
                .clipShape(RoundedRectangle(cornerRadius: 8))
                .accessibilityHidden(true)

                VStack(alignment: .leading, spacing: 2) {
                    Text(localeService.t("Hazte Amigo de Calendario Ciclismo", "Become a Friend of Calendario Ciclismo"))
                        .font(.subheadline)
                        .fontWeight(.semibold)
                    Text(localeService.t("Una aportación voluntaria para sostener un proyecto abierto y gratuito.", "A voluntary contribution to sustain an open and free project."))
                        .font(.caption)
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

    /// Fila de "Canjear código" mostrada también cuando el usuario NO tiene
    /// Premium. Sin esta entrada, alguien con un código promocional tendría
    /// que abrir la paywall primero — flujo poco intuitivo.
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
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                    .accessibilityHidden(true)

                Text(localeService.t("Canjear código", "Redeem code"))
                    .font(.subheadline)
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
                HStack(spacing: 2) {
                    Image(systemName: "calendar")
                        .font(.caption)
                    Image(systemName: "bicycle")
                        .font(.caption)
                }
                .foregroundStyle(LinearGradient(
                    colors: [.yellow, .orange],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                ))
                .frame(width: 36, height: 36)
                .background(Color.yellow.opacity(0.12))
                .clipShape(RoundedRectangle(cornerRadius: 8))
                .accessibilityHidden(true)

                VStack(alignment: .leading, spacing: 2) {
                    Text(localeService.t("Amigo activo", "Friend active"))
                        .font(.subheadline)
                        .fontWeight(.semibold)
                    Text(localeService.t("Gracias por ayudar a sostener el proyecto.", "Thank you for helping sustain the project."))
                        .font(.caption)
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
                        .font(.subheadline)
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
                        .font(.subheadline)
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
                .font(.headline)
                .foregroundStyle(.orange)
            Text(localeService.t(
                "Tu Premium anterior no se convertirá en otra suscripción. Conservas para siempre el icono Fundador.",
                "Your previous Premium plan will not become another subscription. You keep the Founder icon permanently."
            ))
            .font(.caption)
            .foregroundStyle(.secondary)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .ccCardSurface()
    }

    private var supporterIconChooser: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(localeService.t("Icono de la aplicación", "App icon"))
                .font(.subheadline)
                .fontWeight(.semibold)
            HStack(spacing: 8) {
                iconChoice(.standard, label: localeService.t("Original", "Original"), color: Color(red: 0.10, green: 0.45, blue: 0.91), imageName: "OriginalAppIcon")
                if premium.isFounder {
                    iconChoice(.founder, label: localeService.t("Fundador", "Founder"), color: Color(red: 0.06, green: 0.09, blue: 0.16), imageName: "SupportIconFounder")
                }
                if premium.isSubscribed {
                    iconChoice(.friend, label: localeService.t("Amigo", "Friend"), color: .white, imageName: "SupportIconFriend")
                }
            }
        }
        .padding(16)
        .ccCardSurface()
    }

    private func iconChoice(
        _ icon: PremiumService.SupporterIcon,
        label: String,
        color: Color,
        imageName: String? = nil
    ) -> some View {
        Button {
            premium.setSupporterIcon(icon)
        } label: {
            VStack(spacing: 5) {
                if let imageName {
                    Image(imageName)
                        .resizable()
                        .scaledToFit()
                        .frame(width: 42, height: 42)
                        .clipShape(RoundedRectangle(cornerRadius: 9))
                        .overlay {
                            RoundedRectangle(cornerRadius: 9)
                                .stroke(Color.primary.opacity(0.12), lineWidth: 0.5)
                        }
                } else {
                    RoundedRectangle(cornerRadius: 9)
                        .fill(color)
                        .frame(width: 42, height: 42)
                        .overlay {
                        HStack(spacing: 1) {
                            Image(systemName: "calendar")
                            Image(systemName: "bicycle")
                        }
                        .font(.caption2)
                        .foregroundStyle(.white)
                        }
                }
                Text(label)
                    .font(.caption2)
                if premium.supporterIcon == icon {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.caption)
                        .foregroundStyle(Color.accentColor)
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
                .font(.caption2)
                .fontWeight(.bold)
                .foregroundStyle(.orange)
                .padding(.horizontal, 6)
                .padding(.vertical, 2)
                .background(Color.orange.opacity(0.15))
                .clipShape(RoundedRectangle(cornerRadius: 3))

            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Forzar membresía Amigo")
                        .font(.subheadline)
                        .fontWeight(.semibold)
                    Text("Toggle solo visible en builds Debug.")
                        .font(.caption)
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
                            .foregroundStyle(Color.accentColor)
                            .frame(width: 28, height: 28)
                            .accessibilityHidden(true)

                        Text(localeService.t("Política de privacidad", "Privacy policy"))
                            .font(.subheadline)
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
                                .font(.subheadline)
                                .foregroundStyle(.red)
                            Text(localeService.t("Borra tu token de notificaciones del servidor", "Deletes your notification token from the server"))
                                .font(.caption)
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
                .foregroundStyle(Color.accentColor)
                .accessibilityHidden(true)
            Text(title)
                .font(.title3)
                .fontWeight(.bold)
        }
        .padding(.horizontal)
        .accessibilityAddTraits(.isHeader)
    }

    private var notificationToggleCard: some View {
        HStack(spacing: 12) {
            Image(systemName: manager.isSubscribed ? "bell.fill" : "bell.slash")
                .font(.title3)
                .foregroundStyle(manager.isSubscribed ? Color.accentColor : .secondary)
                .frame(width: 36, height: 36)
                .background(
                    (manager.isSubscribed ? Color.accentColor : Color.gray)
                        .opacity(0.1)
                )
                .clipShape(RoundedRectangle(cornerRadius: 8))
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 2) {
                Text(localeService.t("Notificaciones push", "Push notifications"))
                    .font(.subheadline)
                    .fontWeight(.semibold)

                Text(manager.isSubscribed
                     ? localeService.t("Recibirás avisos importantes", "You will receive important alerts")
                     : localeService.t("Activa para recibir avisos", "Enable to receive alerts"))
                    .font(.caption)
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
                    .font(.caption)
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
                .foregroundStyle(Color.accentColor)
                .frame(width: 20)
                .accessibilityHidden(true)
            Text(text)
                .font(.caption)
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

    private let year: Int = {
        Calendar.current.component(.year, from: Date())
    }()

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
                    .foregroundStyle(Color.accentColor)
                    .frame(width: 36, height: 36)
                    .background(Color.accentColor.opacity(0.1))
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                    .accessibilityHidden(true)

                VStack(alignment: .leading, spacing: 2) {
                    Text(feed.label)
                        .font(.subheadline)
                        .fontWeight(.semibold)
                        .foregroundStyle(.primary)

                    Text(feed.description)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }

                Spacer(minLength: 0)

                HStack(spacing: 4) {
                    Image(systemName: isSubscribed ? "checkmark" : "plus")
                        .font(.caption2.weight(.bold))
                    Text(isSubscribed ? LocaleService.t("Añadido", "Added") : LocaleService.t("Añadir", "Add"))
                        .font(.caption)
                        .fontWeight(.medium)
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
                .background(isSubscribed ? Color.green.opacity(0.15) : Color.accentColor.opacity(0.15))
                .foregroundStyle(isSubscribed ? .green : Color.accentColor)
                .clipShape(RoundedRectangle(cornerRadius: 3))
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
