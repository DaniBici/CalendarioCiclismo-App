import SwiftUI
import UIKit

// MARK: - Accessibility helpers for the cycling calendar app

/// Provides accessible country names from ISO 3166-1 alpha-2 codes.
enum AccessibilityCountryNames {
    static func name(for code: String?) -> String? {
        guard let code = code?.uppercased().prefix(2), code.count == 2 else { return nil }
        let locale = Locale(identifier: "es_ES")
        return locale.localizedString(forRegionCode: String(code))
    }
}

/// Provides accessible descriptions for stage types.
enum AccessibilityStageType {
    static func description(primary: String?, secondary: String?) -> String? {
        guard let primary, !primary.isEmpty else { return nil }
        let label = RaceLogic.resolveTypeLabel(primary: primary, secondary: secondary)
        return "Tipo de etapa: \(label)"
    }

    /// SF Symbol icon name for a stage type (color-blind support).
    static func iconName(for type: String?) -> String? {
        switch type {
        case "flat": return "arrow.right"
        case "rolling": return "point.topleft.down.to.point.bottomright.curvepath"
        case "cotas": return "triangle"
        case "medium_mountain": return "mountain.2"
        case "high_mountain", "summit_finish", "uphill_finish", "chrono_climb": return "mountain.2.fill"
        case "itt": return "stopwatch"
        case "ttt": return "stopwatch"
        case "cobbles": return "square.grid.3x3.topleft.filled"
        case "sterrato": return "road.lanes"
        default: return nil
        }
    }
}

/// Provides accessible descriptions for TV status.
enum AccessibilityTVStatus {
    static func description(tvStatus: String?, broadcasts: [Broadcast]) -> String? {
        if let first = broadcasts.first(where: { $0.startTimeUtc != nil }),
           let time = first.startTimeLocal {
            return "Televisión a las \(time)"
        }
        if !broadcasts.isEmpty { return "Televisada" }

        switch tvStatus {
        case "confirmed": return "Televisada"
        case "pending": return "Televisión por confirmar"
        case "none": return "Sin televisión"
        case "unavailable_es": return "No disponible en España"
        default: return nil
        }
    }
}

/// Provides accessible descriptions for UCI categories.
enum AccessibilityCategoryLabel {
    static func description(for category: String?) -> String? {
        guard let cat = category, !cat.isEmpty else { return nil }
        let descriptions: [String: String] = [
            "WC": "Campeonato del Mundo",
            "CC": "Campeonato Continental",
            "CN": "Campeonato Nacional",
            "1.UWT": "UCI WorldTour",
            "2.UWT": "UCI WorldTour segunda categoría",
            "1.WWT": "UCI WorldTour femenino",
            "2.WWT": "UCI WorldTour femenino segunda categoría",
            "1.Pro": "UCI ProSeries",
            "2.Pro": "UCI ProSeries segunda categoría",
            "1.1": "UCI clase 1.1",
            "2.1": "UCI clase 2.1",
            "1.2": "UCI clase 1.2",
            "2.2": "UCI clase 2.2",
            "1.2U": "UCI clase 1.2 sub-23",
            "2.2U": "UCI clase 2.2 sub-23",
        ]
        return "Categoría \(descriptions[cat] ?? cat)"
    }
}

// MARK: - Accessible race card description builder

enum AccessibilityRaceDescription {
    /// Builds a comprehensive VoiceOver description for a race card.
    static func raceCardLabel(item: EnrichedRaceDay) -> String {
        var parts: [String] = []

        if let race = item.race {
            parts.append(race.name)

            if race.isCancelled {
                parts.append("cancelada")
            }

            // El override de país de la jornada vence al hideFlag de la carrera:
            // si la jornada fija un país propio, ese nombre se lee en VoiceOver.
            let effectiveCountryCode = item.raceDay.countryCode ?? race.countryCode
            let showCountry = race.hideFlag != true || item.raceDay.countryCode != nil
            if showCountry, let country = AccessibilityCountryNames.name(for: effectiveCountryCode) {
                parts.append(country)
            }

            if let catDesc = AccessibilityCategoryLabel.description(for: race.uciCategory) {
                parts.append(catDesc)
            }
        }

        let rd = item.raceDay
        if !rd.stageLabel.isEmpty {
            parts.append(rd.stageLabel)
        }

        if let route = rd.routeDescription {
            parts.append("recorrido \(route)")
        }

        if let dist = rd.distanceFormatted {
            parts.append(dist)
        }

        if let typeDesc = AccessibilityStageType.description(primary: rd.primaryType, secondary: rd.secondaryType) {
            parts.append(typeDesc)
        }

        if let tvDesc = AccessibilityTVStatus.description(tvStatus: rd.tvStatus, broadcasts: item.broadcasts) {
            parts.append(tvDesc)
        }

        if let startTime = rd.neutralStartTimeUtc,
           let startStr = DateFormatting.formatTimeLocal(startTime) {
            parts.append("salida a las \(startStr)")
            if let finishTime = rd.estimatedFinishTimeUtc,
               let finishStr = DateFormatting.formatTimeLocal(finishTime) {
                parts.append("meta estimada a las \(finishStr)")
            }
        } else if let finishTime = rd.estimatedFinishTimeUtc,
                  let finishStr = DateFormatting.formatTimeLocal(finishTime) {
            parts.append("meta estimada a las \(finishStr)")
        }

        if item.isPlaceholder {
            parts.append("sin información detallada")
        }

        return parts.joined(separator: ", ")
    }

    /// Builds a VoiceOver description for a season race row.
    static func seasonRaceLabel(race: Race) -> String {
        var parts: [String] = []

        parts.append(race.name)

        if race.isCancelled {
            parts.append("cancelada")
        }

        if let country = AccessibilityCountryNames.name(for: race.countryCode), race.hideFlag != true {
            parts.append(country)
        }

        if let catDesc = AccessibilityCategoryLabel.description(for: race.uciCategory) {
            parts.append(catDesc)
        }

        let dateRange = DateFormatting.formatDateRange(start: race.startDate, end: race.endDate)
        if !dateRange.isEmpty {
            parts.append(dateRange)
        }

        if race.isStageRace {
            parts.append("carrera por etapas")
        }

        return parts.joined(separator: ", ")
    }

    /// Builds a VoiceOver description for a month day cell.
    static func monthDayCellLabel(day: Int, month: Int, year: Int, isToday: Bool, raceDays: [RaceDay], raceMap: [String: Race]) -> String {
        var parts: [String] = []

        parts.append("\(day)")

        if isToday {
            parts.append("hoy")
        }

        let raceCount = raceDays.count
        if raceCount == 0 {
            parts.append("sin carreras")
        } else if raceCount == 1 {
            if let name = raceDays.first?.raceId.flatMap({ raceMap[$0] })?.name {
                parts.append("1 carrera: \(name)")
            } else {
                parts.append("1 carrera")
            }
        } else {
            let names = raceDays.prefix(3).compactMap { $0.raceId.flatMap { raceMap[$0] }?.name }
            parts.append("\(raceCount) carreras: \(names.joined(separator: ", "))")
            if raceCount > 3 {
                parts.append("y \(raceCount - 3) más")
            }
        }

        return parts.joined(separator: ", ")
    }

    /// Builds a VoiceOver description for a stage row.
    static func stageRowLabel(item: EnrichedRaceDay) -> String {
        let rd = item.raceDay

        if rd.isRestDay {
            return "Jornada de descanso, \(DateFormatting.formatDateShort(rd.dateKey))"
        }

        if rd.isCancelledDay {
            return "Etapa cancelada, \(rd.stageLabel), \(DateFormatting.formatDateShort(rd.dateKey))"
        }

        var parts: [String] = []

        if !rd.stageLabel.isEmpty {
            parts.append(rd.stageLabel)
        }

        parts.append(DateFormatting.formatDateShort(rd.dateKey))

        if let route = rd.routeDescription {
            parts.append(route)
        }

        if let typeDesc = AccessibilityStageType.description(primary: rd.primaryType, secondary: rd.secondaryType) {
            parts.append(typeDesc)
        }

        if let dist = rd.distanceFormatted {
            parts.append(dist)
        }

        if let tvDesc = AccessibilityTVStatus.description(tvStatus: rd.tvStatus, broadcasts: item.broadcasts) {
            parts.append(tvDesc)
        }

        return parts.joined(separator: ", ")
    }
}

// MARK: - VoiceOver announcements

enum AccessibilityAnnouncement {
    /// Posts a VoiceOver announcement after a brief delay to let the UI settle.
    static func announce(_ message: String) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
            UIAccessibility.post(notification: .announcement, argument: message)
        }
    }

    /// Notifies VoiceOver that the screen layout has changed significantly.
    static func screenChanged(focusElement: sending Any? = nil) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
            UIAccessibility.post(notification: .screenChanged, argument: focusElement)
        }
    }

    /// Notifies VoiceOver that the layout has changed (e.g. content loaded).
    static func layoutChanged(focusElement: sending Any? = nil) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
            UIAccessibility.post(notification: .layoutChanged, argument: focusElement)
        }
    }
}

// MARK: - High contrast badge helper

extension AppTheme {
    /// Returns badge colors adjusted for high contrast when the accessibility setting is enabled.
    static func highContrastBadgeColor(background: Color, foreground: Color, highContrast: Bool) -> BadgeColor {
        if highContrast {
            return BadgeColor(background: foreground.opacity(0.25), foreground: foreground)
        }
        return BadgeColor(background: background, foreground: foreground)
    }
}

// MARK: - Accessibility identifiers

enum AccessibilityID {
    // Tabs (apps 4.0: Hoy · Resultados · Fichajes · Calendario)
    static let tabToday = "tab_today"
    static let tabResults = "tab_results"
    static let tabTransfers = "tab_transfers"
    static let tabCalendar = "tab_calendar"

    // Settings
    static let settingsButton = "settings_button"

    // TodayView
    static let dateBar = "date_bar"
    static let categoryFilters = "category_filters"
    static let sortMenu = "sort_menu"
    static let raceList = "race_list"
    static let previousDayButton = "previous_day"
    static let nextDayButton = "next_day"
    static let todayButton = "today_button"

    // MonthView
    static let monthNavPrevious = "month_nav_previous"
    static let monthNavNext = "month_nav_next"
    static let monthTitle = "month_title"
    static let monthScheduleList = "month_schedule_list"

    // SeasonView
    static let seasonTitle = "season_title"
    static let yearPicker = "year_picker"
    static let countryPicker = "country_picker"

    // StageDetailView
    static let stageHeader = "stage_header"
    static let timeSection = "time_section"
    static let timetableToggle = "timetable_toggle"
    static let broadcastSection = "broadcast_section"
    static let assetSection = "asset_section"

    // SettingsView
    static func feedCard(_ id: String) -> String { "feed_card_\(id)" }
    static let notificationsHeader = "notifications_header"
    static let notificationsToggle = "notifications_toggle"
    static let notificationsDeniedWarning = "notifications_denied_warning"
    static func notificationsInfoCard(_ id: String) -> String { "notifications_info_\(id)" }

    // NotificationOnboardingView
    static let onboardingEnableButton = "onboarding_enable_notifications"
    static let onboardingSkipButton = "onboarding_skip_notifications"

    // SettingsView — Offline
    static let offlineToggle = "offline_toggle"
    static let offlineSyncButton = "offline_sync_button"

    // SettingsView — Experiencia
    static let hapticsToggle = "haptics_toggle"

    // Shared
    static func raceCard(_ id: String) -> String { "race_card_\(id)" }
    static func stageRow(_ id: String) -> String { "stage_row_\(id)" }
    static func monthDay(_ day: Int) -> String { "month_day_\(day)" }
    static func filterButton(_ filter: String) -> String { "filter_\(filter)" }
}
