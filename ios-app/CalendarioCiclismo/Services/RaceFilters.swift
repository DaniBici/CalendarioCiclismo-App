import Foundation
import SwiftUI

// Filtros de carreras de Hoy, Mes y Temporada (carretera) y de la agenda de
// Ciclocross, con el menú de Fichajes: opciones marcables por grupos, dentro de
// un grupo es O y entre grupos, Y. Un grupo con todo marcado no filtra y nunca
// queda vacío. La selección se recuerda por disciplina y la comparten Hoy, Mes y
// Temporada. Espejo de `js/race-filters.js` y `js/category-filter.js` (web) y de
// `RaceFilters.kt` (Android).

/// Carretera: nivel (WorldTour, Profesional, .2) y género.
struct RoadRaceFilter: Equatable, Codable {
    static let allLevels = ["wt", "pro", "dev"]
    static let allGenders = ["male", "female"]

    var levels = Set(allLevels)
    var genders = Set(allGenders)

    var isActive: Bool { levels.count < Self.allLevels.count || genders.count < Self.allGenders.count }
    /// Solo Femenino: los nombres prescinden del sufijo femenino y del ♀.
    var femaleOnly: Bool { genders == ["female"] }

    mutating func toggleLevel(_ value: String) { RaceFilterToggle.toggle(&levels, value, all: Self.allLevels) }
    mutating func toggleGender(_ value: String) { RaceFilterToggle.toggle(&genders, value, all: Self.allGenders) }

    private static let worldTour: Set<String> = ["1.UWT", "2.UWT", "1.WWT", "2.WWT", "WC"]
    private static let professional: Set<String> = ["1.Pro", "2.Pro", "1.1", "2.1", "CC", "CN"]
    /// .2 y las clases sueltas de una lista cerrada: una categoría nueva no
    /// entra sola; sin nivel, solo se ve con el grupo entero marcado.
    private static let development: Set<String> = ["1.2", "2.2", "1.2U", "2.2U", "1.Ncup", "2.Ncup", "1.NE", "2.NE"]

    static func level(of race: Race) -> String? {
        let cat = race.uciCategory ?? ""
        if worldTour.contains(cat) { return "wt" }
        if professional.contains(cat) { return "pro" }
        if development.contains(cat) { return "dev" }
        return nil
    }

    /// Una carrera sin género (mixta o con pruebas de ambos sexos) y los relevos
    /// mixtos cuentan en Masculino y en Femenino.
    static func genders(of race: Race) -> Set<String> {
        let cat = race.uciCategory ?? ""
        let mixedRelay = (cat == "WC" || cat == "CC")
            && (race.name.localizedCaseInsensitiveContains("relevo mixto") || race.name.localizedCaseInsensitiveContains("mixed relay"))
        if !mixedRelay, let gender = race.gender, gender == "male" || gender == "female" { return [gender] }
        return Set(allGenders)
    }

    func matches(_ race: Race) -> Bool {
        if levels.count < Self.allLevels.count {
            guard let level = Self.level(of: race), levels.contains(level) else { return false }
        }
        if genders.count < Self.allGenders.count, genders.isDisjoint(with: Self.genders(of: race)) { return false }
        return true
    }

    /// Jornadas que pasan el filtro; las que no tienen carrera se conservan.
    func apply(_ items: [EnrichedRaceDay]) -> [EnrichedRaceDay] {
        guard isActive else { return items }
        return items.filter { item in item.race.map(matches) ?? true }
    }

    /// `p_filter` de la RPC `widget_day`: «all» o los grupos que filtran.
    var widgetParameter: String {
        guard isActive else { return "all" }
        var parts: [String] = []
        if levels.count < Self.allLevels.count { parts.append("level:" + Self.allLevels.filter(levels.contains).joined(separator: ",")) }
        if genders.count < Self.allGenders.count { parts.append("gender:" + Self.allGenders.filter(genders.contains).joined(separator: ",")) }
        return parts.joined(separator: ";")
    }

    /// Conversión de la chincheta de la 5.2.3 (`defaultFilter`).
    static func fromLegacy(_ raw: String) -> RoadRaceFilter? {
        switch raw {
        case "uwt": return RoadRaceFilter(levels: ["wt"], genders: ["male"])
        case "wwt": return RoadRaceFilter(levels: ["wt"], genders: ["female"])
        case "pro": return RoadRaceFilter(levels: ["wt", "pro"])
        case "male": return RoadRaceFilter(levels: ["wt", "pro"], genders: ["male"])
        case "female": return RoadRaceFilter(genders: ["female"])
        default: return nil
        }
    }
}

/// Ciclocross: Big, UCI y Nacional, combinables.
struct CxRaceFilter: Equatable, Codable {
    /// «Nacional» (NAC, calendario español) no existe en inglés: esas pruebas
    /// se ocultan en la agenda en inglés (`CyclocrossPresentation.hiddenClasses`).
    static var allLevels: [String] { LocaleService.isEnglish ? ["big", "uci"] : ["big", "uci", "national"] }

    var levels = Set(["big", "uci", "national"])

    /// Opciones marcadas entre las visibles en el idioma actual.
    private var visibleLevels: Set<String> { levels.intersection(Self.allLevels) }
    var isActive: Bool { !visibleLevels.isEmpty && visibleLevels.count < Self.allLevels.count }

    mutating func toggleLevel(_ value: String) {
        levels = visibleLevels.isEmpty ? Set(Self.allLevels) : visibleLevels
        RaceFilterToggle.toggle(&levels, value, all: Self.allLevels)
    }

    /// Big: Mundial, Copa del Mundo, Continental y los torneos Copa del Mundo,
    /// Superprestige, X2O y HG Cross (antes Exact Cross). Nacional: NAC. UCI: el
    /// resto, C1 y C2 fuera de esos torneos y Campeonatos nacionales.
    static func level(of race: CxRace) -> String {
        if race.raceClass == "NAC" { return "national" }
        if ["CM", "CDM", "CC"].contains(race.raceClass) { return "big" }
        if let tournament = race.tournament {
            let identity = (tournament.slug + " " + tournament.name)
                .folding(options: [.diacriticInsensitive, .caseInsensitive], locale: Locale(identifier: "en_US_POSIX"))
                .lowercased().filter { $0.isASCII && ($0.isLetter || $0.isNumber) }
            if ["superprestige", "x2o", "worldcup", "copadelmundo", "exactcross", "hgcross"].contains(where: identity.contains) {
                return "big"
            }
        }
        return "uci"
    }

    func matches(_ race: CxRace) -> Bool {
        guard isActive else { return true }
        return visibleLevels.contains(Self.level(of: race))
    }

    /// `p_cx_filter` de la RPC `widget_day`.
    var widgetParameter: String {
        guard isActive else { return "all" }
        return "level:" + Self.allLevels.filter(visibleLevels.contains).joined(separator: ",")
    }

    /// Conversión de la chincheta de la 5.2.3 (`cx_default_filter`).
    static func fromLegacy(_ raw: String) -> CxRaceFilter? {
        switch raw {
        case "big": return CxRaceFilter(levels: ["big"])
        case "pro": return CxRaceFilter(levels: ["big", "uci"])
        case "spain": return CxRaceFilter(levels: ["national"])
        default: return nil
        }
    }
}

enum RaceFilterToggle {
    static func toggle(_ set: inout Set<String>, _ value: String, all: [String]) {
        if set.contains(value) { set.remove(value) } else { set.insert(value) }
        if set.isEmpty { set = Set(all) }
    }
}

/// Selección recordada de cada disciplina, compartida por Hoy, Mes, Temporada
/// y la agenda de Ciclocross. Se guarda en `UserDefaults` (lo lee
/// `WidgetBridge` para el widget en «Filtro de la app»).
@MainActor @Observable
final class RaceFilterStore {
    static let shared = RaceFilterStore()

    nonisolated static let roadKey = "road_race_filters"
    nonisolated static let cxKey = "cx_race_filters"

    var road: RoadRaceFilter { didSet { if road != oldValue { Self.save(road, key: Self.roadKey) } } }
    var cx: CxRaceFilter { didSet { if cx != oldValue { Self.save(cx, key: Self.cxKey) } } }

    private init() {
        road = Self.load(key: Self.roadKey, legacyKey: "defaultFilter", legacy: RoadRaceFilter.fromLegacy) ?? RoadRaceFilter()
        cx = Self.load(key: Self.cxKey, legacyKey: "cx_default_filter", legacy: CxRaceFilter.fromLegacy) ?? CxRaceFilter()
    }

    private static func load<T: Codable>(key: String, legacyKey: String, legacy: (String) -> T?) -> T? {
        let defaults = UserDefaults.standard
        if let data = defaults.data(forKey: key), let value = try? JSONDecoder().decode(T.self, from: data) { return value }
        guard let raw = defaults.string(forKey: legacyKey) else { return nil }
        defaults.removeObject(forKey: legacyKey)
        let value = legacy(raw)
        if let value { save(value, key: key) }
        return value
    }

    private static func save<T: Codable>(_ value: T, key: String) {
        guard let data = try? JSONEncoder().encode(value) else { return }
        UserDefaults.standard.set(data, forKey: key)
    }

    /// Parámetros del widget leídos sin instanciar la tienda.
    nonisolated static func widgetParameters() -> (road: String, cx: String) {
        let defaults = UserDefaults.standard
        let road = defaults.data(forKey: roadKey).flatMap { try? JSONDecoder().decode(RoadRaceFilter.self, from: $0) }
        let cx = defaults.data(forKey: cxKey).flatMap { try? JSONDecoder().decode(CxRaceFilter.self, from: $0) }
        return (road?.widgetParameter ?? "all", cx?.widgetParameter ?? "all")
    }
}

// MARK: - Menú

/// Opciones con sus textos, como en la web y Android.
enum RaceFilterOptions {
    @MainActor static var roadLevels: [(value: String, label: String)] {
        [("wt", "WorldTour"), ("pro", LocaleService.t("Profesional", "Professional")), ("dev", ".2")]
    }
    @MainActor static var genders: [(value: String, label: String)] {
        [("male", LocaleService.t("Masculino", "Men")), ("female", LocaleService.t("Femenino", "Women"))]
    }
    @MainActor static var cxLevels: [(value: String, label: String)] {
        let all: [(value: String, label: String)] = [("big", "Big"), ("uci", "UCI"), ("national", LocaleService.t("Nacional", "National"))]
        return all.filter { CxRaceFilter.allLevels.contains($0.value) }
    }

    @MainActor static func summary(_ filter: RoadRaceFilter) -> String {
        var parts: [String] = []
        if filter.levels.count < RoadRaceFilter.allLevels.count { parts += roadLevels.filter { filter.levels.contains($0.value) }.map(\.label) }
        if filter.genders.count < RoadRaceFilter.allGenders.count { parts += genders.filter { filter.genders.contains($0.value) }.map(\.label) }
        return parts.joined(separator: " · ")
    }

    @MainActor static func summary(_ filter: CxRaceFilter) -> String {
        cxLevels.filter { filter.levels.contains($0.value) }.map(\.label).joined(separator: " · ")
    }
}

/// Etiqueta «Ordenar» de la fila de la fecha de Hoy y de Ciclocross, con el
/// mismo gris que «Filtros».
struct TodaySortLabel: View {
    let label: String

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: "arrow.up.arrow.down")
            Text(label)
        }
        .ccFont(.s13, weight: .semibold)
        .foregroundStyle(AppTheme.textMuted)
    }
}

/// Etiqueta «Filtros» de la fila de la fecha de Hoy, con el símbolo de Fichajes
/// (relleno con algún filtro) y el aspecto de «Ordenar».
struct RaceFiltersMenuLabel: View {
    let isActive: Bool
    private var localeService: LocaleService { LocaleService.shared }

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: isActive ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease.circle")
            Text(localeService.t("Filtros", "Filters"))
        }
        .ccFont(.s13, weight: .semibold)
        // El gris de «Ordenar» (`TodaySortLabel`); con filtros, el acento.
        .foregroundStyle(isActive ? Color.accentColor : AppTheme.textMuted)
        .contentShape(Rectangle())
    }
}

/// Menú de filtros de carretera: nivel y género, separados, y «Limpiar
/// filtros». Marcar no cierra el menú, como en Fichajes.
struct RoadFiltersMenu<MenuLabel: View>: View {
    @Bindable var store = RaceFilterStore.shared
    @ViewBuilder var label: (Bool) -> MenuLabel
    private var localeService: LocaleService { LocaleService.shared }

    var body: some View {
        Menu {
            Section {
                ForEach(RaceFilterOptions.roadLevels, id: \.value) { option in
                    Toggle(option.label, isOn: Binding(
                        get: { store.road.levels.contains(option.value) },
                        set: { _ in Haptics.play(.selection); store.road.toggleLevel(option.value) }
                    ))
                }
            }
            Section {
                ForEach(RaceFilterOptions.genders, id: \.value) { option in
                    Toggle(option.label, isOn: Binding(
                        get: { store.road.genders.contains(option.value) },
                        set: { _ in Haptics.play(.selection); store.road.toggleGender(option.value) }
                    ))
                }
            }
            Section {
                Button(localeService.t("Limpiar filtros", "Clear filters"), systemImage: "xmark.circle") {
                    store.road = RoadRaceFilter()
                }
                .disabled(!store.road.isActive)
            }
        } label: {
            label(store.road.isActive)
        }
        .menuActionDismissBehavior(.disabled)
        .accessibilityLabel(localeService.t("Filtros", "Filters"))
        .accessibilityValue(store.road.isActive ? RaceFilterOptions.summary(store.road) : localeService.t("Sin filtros", "No filters"))
    }
}

/// Menú de filtros de Ciclocross: Big, UCI y Nacional, y «Limpiar filtros».
struct CxFiltersMenu<MenuLabel: View>: View {
    @Bindable var store = RaceFilterStore.shared
    @ViewBuilder var label: (Bool) -> MenuLabel
    private var localeService: LocaleService { LocaleService.shared }

    var body: some View {
        Menu {
            Section {
                ForEach(RaceFilterOptions.cxLevels, id: \.value) { option in
                    Toggle(option.label, isOn: Binding(
                        get: { !store.cx.isActive || store.cx.levels.contains(option.value) },
                        set: { _ in Haptics.play(.selection); store.cx.toggleLevel(option.value) }
                    ))
                }
            }
            Section {
                Button(localeService.t("Limpiar filtros", "Clear filters"), systemImage: "xmark.circle") {
                    store.cx = CxRaceFilter()
                }
                .disabled(!store.cx.isActive)
            }
        } label: {
            label(store.cx.isActive)
        }
        .menuActionDismissBehavior(.disabled)
        .accessibilityLabel(localeService.t("Filtros", "Filters"))
        .accessibilityValue(store.cx.isActive ? RaceFilterOptions.summary(store.cx) : localeService.t("Sin filtros", "No filters"))
    }
}
