import WidgetKit
import SwiftUI

// MARK: - Payload model (contrato JSON con la app principal)

struct WidgetPayloadData: Codable {
    let payloadVersion: Int
    let generatedAtUtc: String
    let dateKey: String
    let items: [WidgetPayloadItem]
    let overflowCount: Int
    let specialState: WidgetSpecialState?
    let nextRaceDateKey: String?
    let nextRaceName: String?
    let nextRaceBroadcastStartTimeUtc: String?
    let nextRaceTvStatus: String?
}

struct WidgetPayloadItem: Codable {
    let raceDayId: String
    let raceId: String
    let raceName: String
    let countryCode: String?
    let uciCategory: String?
    let gender: String?
    let stageLabel: String
    let startLocation: String?
    let finishLocation: String?
    let startTimeUtc: String?
    let estimatedFinishTimeUtc: String?
    let primaryType: String?
    let distanceKm: Double?
    let typeLabel: String?
    let hasLiveText: Bool?
    let channels: [String]
    let broadcastStartTimeUtc: String?
    let tvStatus: String?
}

struct WidgetSpecialState: Codable {
    let kind: String      // "rest_day" | "cancelled"
    let raceName: String
    let countryCode: String?
}

// MARK: - Timeline Entry

struct WidgetEntry: TimelineEntry {
    let date: Date
    let payload: WidgetPayloadData?
    let isStale: Bool
}

// MARK: - Provider

struct WidgetProvider: TimelineProvider {

    private static let appGroupID   = "group.app.calendariociclismo"
    private static let payloadPath  = "Caches/widget_today_payload.json"

    func placeholder(in context: Context) -> WidgetEntry {
        WidgetEntry(date: .now, payload: nil, isStale: false)
    }

    func getSnapshot(in context: Context, completion: @escaping (WidgetEntry) -> Void) {
        completion(WidgetEntry(date: .now, payload: readPayload(), isStale: false))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<WidgetEntry>) -> Void) {
        let now = Date()
        let raw = readPayload()
        let iso = ISO8601DateFormatter()

        var isStale = false
        let validPayload: WidgetPayloadData?

        if let p = raw {
            let isToday = p.dateKey == localTodayKey()
            if let gen = iso.date(from: p.generatedAtUtc) {
                isStale = now.timeIntervalSince(gen) > 6 * 3600
            }
            validPayload = isToday ? p : nil
        } else {
            validPayload = nil
        }

        var entries: [WidgetEntry] = [WidgetEntry(date: now, payload: validPayload, isStale: isStale)]

        // Entrada en cada hora estimada de llegada (activa filtrado de carreras terminadas)
        for item in validPayload?.items ?? [] {
            if let s = item.estimatedFinishTimeUtc,
               let d = iso.date(from: s), d > now {
                entries.append(WidgetEntry(date: d, payload: validPayload, isStale: isStale))
            }
        }

        // Entrada a medianoche local (nuevo día → datos a nil para pedir refresh)
        let midnight = nextMidnight()
        entries.append(WidgetEntry(date: midnight, payload: nil, isStale: false))
        entries.sort { $0.date < $1.date }

        // Política: refrescar a los 90 min o a medianoche, lo que sea antes
        let ninetyMin = Calendar.current.date(byAdding: .minute, value: 90, to: now)!
        let refreshAt = midnight < ninetyMin ? midnight : ninetyMin
        completion(Timeline(entries: entries, policy: .after(refreshAt)))
    }

    private func readPayload() -> WidgetPayloadData? {
        guard let container = FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: Self.appGroupID
        ) else { return nil }
        let url = container.appendingPathComponent(Self.payloadPath)
        guard let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(WidgetPayloadData.self, from: data)
    }

    private func localTodayKey() -> String {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = .current
        return f.string(from: Date())
    }

    private func nextMidnight() -> Date {
        var cal = Calendar.current
        cal.timeZone = .current
        let tomorrow = cal.date(byAdding: .day, value: 1, to: Date())!
        return cal.startOfDay(for: tomorrow)
    }
}

// MARK: - Paleta sobre fondo coloreado

private extension Color {
    static let wPrimary   = Color.white
    static let wSecondary = Color.white.opacity(0.72)
    static let wTertiary  = Color.white.opacity(0.44)
    static let wDivider   = Color.white.opacity(0.18)
    static let wBadge     = Color.white.opacity(0.20)
}

// MARK: - Helpers

// `ISO8601DateFormatter` no es `Sendable` en Swift 6, pero `date(from:)` y
// `string(from:)` son thread-safe desde iOS 7. Marcamos el global como
// `nonisolated(unsafe)` para silenciar el warning de strict concurrency sin
// pagar la instanciación por llamada (se invoca por cada item del payload).
nonisolated(unsafe) private let _iso = ISO8601DateFormatter()

private func flagEmoji(for code: String?) -> String? {
    guard let code, !code.isEmpty else { return nil }
    // Solo códigos ISO de 2 letras generan emojis válidos; ignorar sub-nacionales (es-ct, etc.)
    let base = String(code.split(separator: "-").first ?? Substring(code))
    guard base.count == 2, base.allSatisfy({ $0.isLetter }) else { return nil }
    let scalars = base.uppercased().unicodeScalars.compactMap { Unicode.Scalar($0.value + 0x1F1A5) }
    guard scalars.count == 2 else { return nil }
    return scalars.map { String($0) }.joined()
}

private func formatTimeLocal(_ utcString: String?) -> String? {
    guard let s = utcString, let date = _iso.date(from: s) else { return nil }
    let f = DateFormatter()
    f.dateFormat = "HH:mm"
    f.timeZone = .current
    f.locale = Locale(identifier: "es_ES")
    return f.string(from: date)
}

private func stageTypeIcon(for primaryType: String?) -> String? {
    switch primaryType {
    case "flat":                                          return "arrow.right"
    case "rolling":                                       return "point.topleft.down.to.point.bottomright.curvepath"
    case "cotas":                                         return "triangle"
    case "medium_mountain":                               return "mountain.2"
    case "high_mountain", "summit_finish",
         "uphill_finish", "monopuerto", "chrono_climb":   return "mountain.2.fill"
    case "itt", "ttt":                                    return "stopwatch"
    case "cobbles":                                       return "square.grid.3x3.topleft.filled"
    case "sterrato":                                      return "road.lanes"
    default:                                              return nil
    }
}

private func stageTypeAbbrev(for primaryType: String?) -> String? {
    switch primaryType {
    case "flat":                                          return "Ll"
    case "rolling":                                       return "Sin"
    case "medium_mountain":                               return "mM"
    case "high_mountain", "summit_finish",
         "uphill_finish":                                 return "aM"
    case "monopuerto":                                    return "Monop"
    case "chrono_climb":                                  return "CREsc"
    case "cobbles":                                       return "Pavé"
    case "sterrato":                                      return "Strr"
    case "cotas":                                         return "Cotas"
    case "itt":                                           return "CRI"
    case "ttt":                                           return "CRE"
    default:                                              return nil
    }
}

private func coverageIcon(channels: [String], hasLiveText: Bool?) -> String? {
    if !channels.isEmpty { return "tv" }
    if hasLiveText == true { return "text.bubble" }
    return nil
}

/// Badge de cobertura para el lado derecho de cada fila.
/// Prioridad: sin TV España → hora broadcast → TV confirmada → live → TBC → sin TV → ocultar.
private func coverageBadge(item: WidgetPayloadItem) -> (icon: String?, text: String)? {
    // Sin TV en España — tiene prioridad sobre broadcasts de otros países
    if item.tvStatus == "unavailable_es" {
        return ("tv.slash", "NO ESP")
    }
    // TV con horario de emisión conocido
    if let t = formatTimeLocal(item.broadcastStartTimeUtc) {
        return ("tv", t)
    }
    // Por confirmar — tiene prioridad sobre channels (canales no confirmados aún)
    if item.tvStatus == "pending" {
        return ("tv", "TBC")
    }
    // TV confirmada pero sin hora de emisión
    if !item.channels.isEmpty || item.tvStatus == "confirmed" {
        return ("tv", "TV")
    }
    // Sin TV pero live texto disponible
    if item.hasLiveText == true {
        return ("antenna.radiowaves.left.and.right", "Live")
    }
    // Sin TV en ningún país
    if item.tvStatus == "none" {
        return ("tv.slash", "Sin TV")
    }
    // Sin información → ocultar
    return nil
}

private func formatDistance(_ km: Double?) -> String? {
    guard let km else { return nil }
    return km.truncatingRemainder(dividingBy: 1) == 0 ? "\(Int(km)) km" : String(format: "%.1f km", km)
}

private func isFinished(_ item: WidgetPayloadItem, at date: Date) -> Bool {
    guard let s = item.estimatedFinishTimeUtc, let d = _iso.date(from: s) else { return false }
    return date > d
}

// MARK: - Entry View

struct WidgetEntryView: View {
    var entry: WidgetEntry
    @Environment(\.colorScheme) private var colorScheme

    private var bgColor: Color { colorScheme == .dark ? .black : .accentColor.mix(with: .black, by: 0.15) }

    var body: some View {
        Group {
            if let payload = entry.payload {
                let allItems = payload.items
                if allItems.isEmpty {
                    if let special = payload.specialState {
                        SpecialStateView(state: special)
                    } else {
                        EmptyStateView()
                    }
                } else {
                    let active = allItems.filter { !isFinished($0, at: entry.date) }
                    // Solo mostrar en solitario si tiene TV confirmada (con o sin hora)
                    let visible = (active.count == 1 && active[0].channels.isEmpty && active[0].tvStatus != "confirmed") ? [] : active
                    if visible.isEmpty {
                        AllCompletedView()
                    } else if visible.count == 1 {
                        SingleRaceView(item: visible[0], entryDate: entry.date)
                    } else {
                        MultiRaceView(items: visible, entryDate: entry.date)
                    }
                }
            } else {
                PlaceholderView()
            }
        }
        .overlay(alignment: .topTrailing) {
            if entry.isStale {
                Circle()
                    .fill(Color.white.opacity(0.5))
                    .frame(width: 6, height: 6)
                    .padding(10)
                    .accessibilityHidden(true)
            }
        }
        .containerBackground(for: .widget) {
            bgColor
        }
    }
}

// MARK: - Estado single (1 carrera activa)

struct SingleRaceView: View {
    let item: WidgetPayloadItem
    let entryDate: Date

    private var finished: Bool { isFinished(item, at: entryDate) }
    private var alpha: Double   { finished ? 0.5 : 1.0 }

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                if let flag = flagEmoji(for: item.countryCode) {
                    Text(flag).font(.title3)
                }
                Text(item.raceName)
                    .font(.headline)
                    .lineLimit(1)
                    .foregroundStyle(Color.wPrimary.opacity(alpha))
                Spacer(minLength: 4)
                if let cat = item.uciCategory {
                    Text(cat)
                        .font(.caption2.weight(.medium))
                        .foregroundStyle(Color.wPrimary)
                        .padding(.horizontal, 5).padding(.vertical, 2)
                        .background(Color.wBadge)
                        .clipShape(RoundedRectangle(cornerRadius: 4))
                }
            }

            HStack(spacing: 4) {
                if !item.stageLabel.isEmpty { Text(item.stageLabel) }
                if let tl = item.typeLabel {
                    if !item.stageLabel.isEmpty { Text("·").foregroundStyle(Color.wTertiary) }
                    if let icon = stageTypeIcon(for: item.primaryType) { Image(systemName: icon) }
                    Text(tl)
                }
                Spacer(minLength: 4)
                if let dist = formatDistance(item.distanceKm) {
                    Text(dist)
                }
            }
            .font(.caption)
            .foregroundStyle(Color.wSecondary)

            let sCity = item.startLocation.flatMap { $0.isEmpty ? nil : $0 }
            let fCity = item.finishLocation.flatMap { $0.isEmpty ? nil : $0 }
            let cityRoute: String? = {
                if let s = sCity, let f = fCity { return s == f ? s : "\(s) – \(f)" }
                return sCity ?? fCity
            }()
            if let cityRoute {
                HStack(spacing: 4) {
                    Image(systemName: "mappin.and.ellipse")
                    Text(cityRoute)
                }
                .font(.caption2)
                .foregroundStyle(Color.wTertiary)
            }

            Spacer(minLength: 4)

            HStack(spacing: 20) {
                if let (icon, text) = coverageBadge(item: item) {
                    HStack(spacing: 4) {
                        if let icon { Image(systemName: icon) }
                        Text(text)
                    }
                    .font(.subheadline.monospacedDigit())
                    .foregroundStyle(Color.wPrimary.opacity(alpha))
                }
                if let t = formatTimeLocal(item.estimatedFinishTimeUtc) {
                    HStack(spacing: 4) {
                        Image(systemName: "flag.checkered")
                        Text(t)
                    }
                    .font(.subheadline.monospacedDigit())
                    .foregroundStyle(Color.wSecondary)
                }
            }

            HStack {
                Image("LaunchLogo")
                    .resizable()
                    .aspectRatio(contentMode: .fit)
                    .frame(height: 22)
                Spacer()
            }
        }
        .padding(16)
    }
}

// MARK: - Estado multi (2+ carreras activas)

struct MultiRaceView: View {
    let items: [WidgetPayloadItem]   // solo activas (no terminadas)
    let entryDate: Date

    var body: some View {
        let capped = Array(items.prefix(3))
        let dynamicOverflow = max(0, items.count - 3)
        return VStack(alignment: .leading, spacing: 0) {
            // Con < 3 carreras, centrar verticalmente en el espacio disponible
            if capped.count < 3 { Spacer(minLength: 0) }

            ForEach(Array(capped.enumerated()), id: \.element.raceDayId) { idx, item in
                Link(destination: URL(string: "calendariociclismo://stage/\(item.raceDayId)")!) {
                    CompactRaceRow(item: item)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 4)
                }
                .buttonStyle(.plain)

                if idx < capped.count - 1 {
                    Color.wDivider.frame(height: 0.5).padding(.horizontal, 14)
                }
            }

            Spacer(minLength: 0)

            HStack(alignment: .center, spacing: 0) {
                Image("LaunchLogo")
                    .resizable()
                    .aspectRatio(contentMode: .fit)
                    .frame(height: 22)
                Spacer()
                if dynamicOverflow > 0 {
                    Link(destination: URL(string: "calendariociclismo://tab/today")!) {
                        HStack(spacing: 2) {
                            Text("+\(dynamicOverflow) más")
                                .font(.caption2)
                                .foregroundStyle(Color.wSecondary)
                            Image(systemName: "chevron.right")
                                .font(.caption2)
                                .foregroundStyle(Color.wTertiary)
                        }
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 14)
            .padding(.bottom, 8)
            .padding(.top, 2)
        }
        .padding(.top, capped.count < 3 ? 0 : 10)
    }
}

private struct CompactRaceRow: View {
    let item: WidgetPayloadItem

    var body: some View {
        HStack(alignment: .center, spacing: 0) {
            Group {
                if let flag = flagEmoji(for: item.countryCode) {
                    Text(flag).font(.footnote)
                } else {
                    Color.clear
                }
            }
            .frame(width: 22)

            VStack(alignment: .leading, spacing: 1) {
                Text(item.raceName)
                    .font(.footnote.weight(.semibold))
                    .lineLimit(1)
                    .foregroundStyle(Color.wPrimary)

                let hasStage   = !item.stageLabel.isEmpty
                // En vista multi solo se muestra el tipo primario (sin secundario)
                let primaryTypeLabel = item.typeLabel?.components(separatedBy: " · ").first
                let typeAbbrev = stageTypeAbbrev(for: item.primaryType) ?? primaryTypeLabel
                let hasType    = typeAbbrev != nil
                let finishTime = formatTimeLocal(item.estimatedFinishTimeUtc)
                let hasSecondLine = hasStage || hasType || finishTime != nil
                if hasSecondLine {
                    HStack(spacing: 3) {
                        if hasStage { Text(item.stageLabel) }
                        if let abbrev = typeAbbrev {
                            if hasStage { Text("·").foregroundStyle(Color.wTertiary) }
                            if let icon = stageTypeIcon(for: item.primaryType) {
                                Image(systemName: icon).font(.system(size: 7.5, weight: .medium))
                            }
                            Text(abbrev)
                        }
                        if let t = finishTime {
                            if hasStage || hasType { Text("·").foregroundStyle(Color.wTertiary) }
                            Image(systemName: "flag.checkered").font(.system(size: 7.5, weight: .medium))
                            Text(t)
                        }
                    }
                    .font(.caption2)
                    .foregroundStyle(Color.wSecondary)
                    .lineLimit(1)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.leading, 4)

            if let (icon, text) = coverageBadge(item: item) {
                HStack(spacing: 3) {
                    if let icon {
                        Image(systemName: icon)
                            .font(.caption2)
                            .foregroundStyle(Color.wSecondary)
                    }
                    Text(text)
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(Color.wSecondary)
                }
                .padding(.leading, 6)
            }

            Image(systemName: "chevron.right")
                .font(.system(size: 8, weight: .semibold))
                .foregroundStyle(Color.wTertiary)
                .padding(.leading, 4)
        }
    }
}

// MARK: - Estado todas completadas

struct AllCompletedView: View {
    var body: some View {
        VStack(spacing: 10) {
            Image("LaunchLogo")
                .resizable()
                .aspectRatio(contentMode: .fit)
                .frame(height: 68)
            Text("Completadas todas las carreras de hoy")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Color.wPrimary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(16)
    }
}

// MARK: - Estado vacío (sin carreras hoy)

struct EmptyStateView: View {
    var body: some View {
        VStack(spacing: 0) {
            Image("LaunchLogo")
                .resizable()
                .aspectRatio(contentMode: .fit)
                .frame(height: 80)
                .padding(.bottom, 2)
            Text("No hay carreras hoy")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Color.wPrimary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(16)
    }
}

// MARK: - Estado especial (descanso / anulada)

struct SpecialStateView: View {
    let state: WidgetSpecialState

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                if let flag = flagEmoji(for: state.countryCode) { Text(flag).font(.title3) }
                Text(state.raceName).font(.headline).lineLimit(1).foregroundStyle(Color.wPrimary)
            }
            Text(state.kind == "rest_day" ? "Jornada de descanso" : "Jornada anulada")
                .font(.subheadline)
                .foregroundStyle(state.kind == "cancelled" ? Color.orange : Color.wSecondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .padding(16)
    }
}

// MARK: - Placeholder (sin datos)

struct PlaceholderView: View {
    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: "arrow.trianglehead.clockwise")
                .font(.title2)
                .foregroundStyle(Color.wSecondary)
            Text("Abre la app para actualizar")
                .font(.caption)
                .foregroundStyle(Color.wSecondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(16)
    }
}

// MARK: - Widget

struct CalendarioCiclismoWidget: Widget {
    let kind: String = "TodayCyclingWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: WidgetProvider()) { entry in
            let deepLink: URL? = {
                guard let items = entry.payload?.items, !items.isEmpty else {
                    return URL(string: "calendariociclismo://tab/today")
                }
                let active = items.filter { !isFinished($0, at: entry.date) }
                let visible = (active.count == 1 && active[0].channels.isEmpty && active[0].tvStatus != "confirmed") ? [] : active
                if visible.count == 1 {
                    return URL(string: "calendariociclismo://stage/\(visible[0].raceDayId)")
                }
                return URL(string: "calendariociclismo://tab/today")
            }()
            WidgetEntryView(entry: entry)
                .widgetURL(deepLink)
        }
        .configurationDisplayName("Las carreras de hoy")
        .description("Qué se corre hoy.")
        .supportedFamilies([.systemMedium])
        .contentMarginsDisabled()
    }
}

#Preview(as: .systemMedium) {
    CalendarioCiclismoWidget()
} timeline: {
    WidgetEntry(date: .now, payload: nil, isStale: false)
}
