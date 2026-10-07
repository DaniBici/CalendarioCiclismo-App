import SwiftUI
import WidgetKit

struct WidgetEntryView: View {
    let entry: WidgetEntry
    @Environment(\.widgetFamily) private var family
    @Environment(\.colorScheme) private var colorScheme

    private var background: Color {
        colorScheme == .dark ? .black : Color.accentColor.mix(with: .black, by: 0.15)
    }

    var body: some View {
        content
            .containerBackground(for: .widget) {
                if isAccessory { Color.clear } else { background }
            }
            .widgetURL(defaultURL)
    }

    private var isAccessory: Bool {
        family == .accessoryInline || family == .accessoryRectangular || family == .accessoryCircular
    }

    @ViewBuilder private var content: some View {
        switch family {
        case .accessoryInline: InlineView(entry: entry)
        case .accessoryRectangular: RectangularView(entry: entry)
        case .systemSmall: SmallView(entry: entry)
        case .systemLarge: ListView(entry: entry, maxRows: 7, showsHeader: true)
        default: MediumView(entry: entry)
        }
    }

    /// Destino al pulsar fuera de una fila: la carrera destacada en los
    /// tamaños sin filas enlazadas; Hoy o Ciclocross en el resto.
    private var defaultURL: URL? {
        let items = entry.day?.items ?? []
        if family == .systemSmall || family == .accessoryRectangular || family == .accessoryInline,
           let featured = WidgetContent.featured(items, at: entry.date) {
            return featured.url
        }
        if !items.isEmpty, items.allSatisfy(\.isCX) { return URL(string: "calendariociclismo://tab/cyclocross") }
        return URL(string: "calendariociclismo://tab/today")
    }
}

// MARK: - Selección

enum WidgetContent {
    /// La carrera más relevante en este instante: en directo, después la
    /// próxima en salir, después la última con resultado. Respeta el orden de
    /// importancia de la RPC dentro de cada grupo.
    static func featured(_ items: [WidgetItem], at now: Date) -> WidgetItem? {
        let order: [WidgetRaceState] = [.live, .scheduled, .awaiting, .results]
        for state in order {
            if let item = items.first(where: { $0.raceState(at: now) == state }) { return item }
        }
        return items.first
    }

    static func emptyTitle(_ entry: WidgetEntry) -> String {
        let text = entry.text
        return entry.scope == .followed
            ? text.t("Hoy no corre ninguna carrera seguida", "None of your races today")
            : text.t("No hay carreras hoy", "No races today")
    }

    static func unavailableTitle(_ text: WidgetText) -> String {
        text.t("Sin datos. Revisa la conexión", "No data. Check your connection")
    }
}

// MARK: - Pequeño

private struct SmallView: View {
    let entry: WidgetEntry

    var body: some View {
        let text = entry.text
        VStack(alignment: .leading, spacing: 4) {
            if let day = entry.day, let item = WidgetContent.featured(day.items, at: entry.date) {
                HStack(alignment: .top) {
                    WidgetFlag(code: item.countryCode, width: 20)
                    Spacer()
                    if entry.isStale { WidgetStaleDot() }
                }
                Text(item.name)
                    .font(.subheadline.weight(.bold))
                    .foregroundStyle(Color.wPrimary)
                    .lineLimit(2)
                    .minimumScaleFactor(0.85)
                Text(item.detailLine(at: entry.date, text: text))
                    .font(.caption2)
                    .foregroundStyle(Color.wSecondary)
                    .lineLimit(2)
                Spacer(minLength: 0)
                if let actions = item.finishedActions(at: entry.date) {
                    WidgetFinishedActions(results: actions.results, revive: actions.revive, text: text,
                                          interactive: false, size: 18)
                } else if let badge = item.badge(at: entry.date, text: text) {
                    WidgetBadgeView(badge: badge, font: .subheadline.weight(.semibold).monospacedDigit())
                }
                let state = item.raceState(at: entry.date)
                if state == .scheduled || state == .live, let channel = item.tv?.channel {
                    Text(channel)
                        .font(.caption2)
                        .foregroundStyle(Color.wSecondary)
                        .lineLimit(1)
                }
                let others = day.items.count - 1
                HStack {
                    WidgetLogo(height: 16)
                    Spacer()
                    if others > 0 {
                        Text("+\(others)")
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(Color.wTertiary)
                    }
                }
            } else if let day = entry.day {
                Text(WidgetContent.emptyTitle(entry))
                    .font(.subheadline.weight(.bold))
                    .foregroundStyle(Color.wPrimary)
                    .lineLimit(3)
                Spacer(minLength: 0)
                if let next = day.next {
                    Text(text.t("Próxima", "Next") + " · " + text.day(next.date, relativeTo: entry.date))
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(Color.wTertiary)
                    Text(next.name)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(Color.wPrimary)
                        .lineLimit(2)
                }
                WidgetLogo(height: 16)
            } else {
                Spacer(minLength: 0)
                WidgetMessage(title: WidgetContent.unavailableTitle(text), symbol: "wifi.slash")
                Spacer(minLength: 0)
                WidgetLogo(height: 16)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .padding(14)
    }
}

// MARK: - Mediano

private struct MediumView: View {
    let entry: WidgetEntry

    var body: some View {
        if let items = entry.day?.items, items.count == 1, let item = items.first {
            SingleRaceView(entry: entry, item: item)
        } else {
            ListView(entry: entry, maxRows: 3, showsHeader: false)
        }
    }
}

/// Una sola carrera: ficha ampliada.
private struct SingleRaceView: View {
    let entry: WidgetEntry
    let item: WidgetItem

    var body: some View {
        let text = entry.text
        let now = entry.date
        let state = item.raceState(at: now)
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                WidgetFlag(code: item.countryCode, width: 20)
                Text(item.name)
                    .font(.headline)
                    .foregroundStyle(Color.wPrimary)
                    .lineLimit(1)
                Spacer(minLength: 4)
                if let category = item.category {
                    Text(category)
                        .font(.caption2.weight(.medium))
                        .foregroundStyle(Color.wPrimary)
                        .padding(.horizontal, 5).padding(.vertical, 2)
                        .background(Color.wBadge, in: RoundedRectangle(cornerRadius: 4))
                }
                if entry.isStale { WidgetStaleDot() }
            }
            if item.isCX {
                Text(item.tournament ?? "Ciclocross")
                    .font(.caption)
                    .foregroundStyle(Color.wSecondary)
                    .lineLimit(1)
                ForEach(item.displaySessions, id: \.category) { session in
                    CXSessionLine(session: session, now: now, text: text)
                }
            } else {
                HStack(spacing: 4) {
                    if let icon = widgetStageIcon(item.primaryType) { Image(systemName: icon) }
                    Text([item.stageLabel, item.typeLabel].compactMap { $0 }.joined(separator: " · "))
                        .lineLimit(1)
                    Spacer(minLength: 4)
                    if let distance = text.distance(item.distanceKm) { Text(distance) }
                }
                .font(.caption)
                .foregroundStyle(Color.wSecondary)
                if let route = item.route {
                    Label(route, systemImage: "mappin.and.ellipse")
                        .font(.caption2)
                        .foregroundStyle(Color.wTertiary)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 2)
            HStack(spacing: 14) {
                if let actions = item.finishedActions(at: now) {
                    WidgetFinishedActions(results: actions.results, revive: actions.revive, text: text, size: 18)
                } else if let badge = item.badge(at: now, text: text) {
                    if let url = badge.url {
                        Link(destination: url) {
                            WidgetBadgeView(badge: badge, font: .subheadline.weight(.semibold).monospacedDigit())
                        }
                    } else {
                        WidgetBadgeView(badge: badge, font: .subheadline.weight(.semibold).monospacedDigit())
                    }
                }
                if !item.isCX, state == .scheduled || state == .live, let channel = item.tv?.channel {
                    Text(channel)
                        .font(.caption)
                        .foregroundStyle(Color.wSecondary)
                        .lineLimit(1)
                }
                Spacer(minLength: 0)
                if !item.isCX, state != .results, let finish = text.time(item.finishUtc) {
                    Label(finish, systemImage: "flag.checkered")
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(Color.wSecondary)
                }
            }
            WidgetLogo()
        }
        .padding(14)
    }
}

private struct CXSessionLine: View {
    let session: WidgetSession
    let now: Date
    let text: WidgetText

    var body: some View {
        HStack(spacing: 6) {
            Text(session.label ?? session.category)
                .foregroundStyle(Color.wSecondary)
            Spacer(minLength: 4)
            if session.hasResults == true {
                Label(text.t("Terminada", "Finished"), systemImage: "checkmark")
                    .foregroundStyle(Color.wSecondary)
            } else if session.isLive(at: now) {
                Text(text.t("En curso", "Live")).foregroundStyle(Color.wLive)
            } else if let start = text.time(session.startUtc) {
                Text(start).monospacedDigit().foregroundStyle(Color.wPrimary)
            }
        }
        .font(.caption)
        .lineLimit(1)
    }
}

// MARK: - Lista (mediano con varias carreras y grande)

private struct ListView: View {
    let entry: WidgetEntry
    let maxRows: Int
    let showsHeader: Bool

    var body: some View {
        let text = entry.text
        VStack(alignment: .leading, spacing: 0) {
            if showsHeader {
                HStack {
                    Text(text.t("Hoy", "Today") + " · " + dayTitle(text))
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(Color.wTertiary)
                    Spacer()
                    if entry.isStale { WidgetStaleDot() }
                    WidgetLogo(height: 16)
                }
                .padding(.bottom, 6)
            }
            if let day = entry.day {
                if day.items.isEmpty {
                    Spacer(minLength: 0)
                    WidgetMessage(title: WidgetContent.emptyTitle(entry))
                    Spacer(minLength: 0)
                    if let next = day.next {
                        WidgetNextLine(next: next, now: entry.date, text: text)
                    }
                } else {
                    let rows = Array(day.items.prefix(maxRows))
                    if rows.count < maxRows && !showsHeader { Spacer(minLength: 0) }
                    ForEach(Array(rows.enumerated()), id: \.element.id) { index, item in
                        WidgetRow(item: item, now: entry.date, text: text)
                            .padding(.vertical, showsHeader ? 5 : 3)
                        if index < rows.count - 1 {
                            Color.wDivider.frame(height: 0.5)
                        }
                    }
                    Spacer(minLength: 0)
                    if showsHeader, let next = day.next, rows.count < maxRows {
                        Color.wDivider.frame(height: 0.5)
                        WidgetNextLine(next: next, now: entry.date, text: text)
                            .padding(.top, 6)
                    }
                    footer(overflow: day.items.count - rows.count, text: text)
                }
            } else {
                Spacer(minLength: 0)
                WidgetMessage(title: WidgetContent.unavailableTitle(text), symbol: "wifi.slash")
                Spacer(minLength: 0)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
    }

    private func dayTitle(_ text: WidgetText) -> String {
        let formatter = DateFormatter()
        formatter.locale = text.locale
        formatter.timeZone = .current
        formatter.setLocalizedDateFormatFromTemplate("EEEdMMM")
        return formatter.string(from: entry.date)
    }

    @ViewBuilder private func footer(overflow: Int, text: WidgetText) -> some View {
        if !showsHeader || overflow > 0 {
            HStack {
                if !showsHeader { WidgetLogo(height: 18) }
                if !showsHeader && entry.isStale { WidgetStaleDot() }
                Spacer()
                if overflow > 0 {
                    Link(destination: URL(string: "calendariociclismo://tab/today")!) {
                        HStack(spacing: 2) {
                            Text(text.t("+\(overflow) más", "+\(overflow) more"))
                            Image(systemName: "chevron.right")
                        }
                        .font(.caption2)
                        .foregroundStyle(Color.wSecondary)
                    }
                }
            }
            .padding(.top, 4)
        }
    }
}

// MARK: - Pantalla bloqueada

private struct RectangularView: View {
    let entry: WidgetEntry

    var body: some View {
        let text = entry.text
        VStack(alignment: .leading, spacing: 1) {
            if let day = entry.day, let item = WidgetContent.featured(day.items, at: entry.date) {
                Text(item.name)
                    .font(.headline)
                    .widgetAccentable()
                    .lineLimit(1)
                Text(item.detailLine(at: entry.date, text: text))
                    .font(.caption)
                    .lineLimit(1)
                if item.finishedActions(at: entry.date) != nil {
                    Label(text.t("Terminada", "Finished"), systemImage: "trophy")
                        .font(.caption)
                        .lineLimit(1)
                } else if let badge = item.badge(at: entry.date, text: text) {
                    Label(badge.text, systemImage: badge.symbol ?? "tv")
                        .font(.caption.monospacedDigit())
                        .lineLimit(1)
                }
            } else if let next = entry.day?.next {
                Text(text.t("Próxima", "Next") + " · " + text.day(next.date, relativeTo: entry.date))
                    .font(.caption)
                Text(next.name).font(.headline).widgetAccentable().lineLimit(2)
            } else {
                Text(entry.day == nil ? WidgetContent.unavailableTitle(text) : WidgetContent.emptyTitle(entry))
                    .font(.caption)
                    .lineLimit(3)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct InlineView: View {
    let entry: WidgetEntry

    var body: some View {
        let text = entry.text
        if let day = entry.day, let item = WidgetContent.featured(day.items, at: entry.date) {
            let finished = item.finishedActions(at: entry.date) != nil
            let badge = finished ? nil : item.badge(at: entry.date, text: text)
            Label(
                [item.name, finished ? text.t("Terminada", "Finished") : badge?.text].compactMap { $0 }.joined(separator: " · "),
                systemImage: finished ? "trophy" : (badge?.symbol ?? "bicycle")
            )
        } else if let next = entry.day?.next {
            Label(text.day(next.date, relativeTo: entry.date) + " · " + next.name, systemImage: "calendar")
        } else {
            Label(entry.day == nil ? text.t("Sin datos", "No data") : text.t("Sin carreras hoy", "No races today"),
                  systemImage: "bicycle")
        }
    }
}
