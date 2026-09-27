import SwiftUI
import UIKit
import WidgetKit

// MARK: - Paleta sobre fondo de marca

extension Color {
    static let wPrimary   = Color.white
    static let wSecondary = Color.white.opacity(0.74)
    static let wTertiary  = Color.white.opacity(0.48)
    static let wDivider   = Color.white.opacity(0.18)
    static let wBadge     = Color.white.opacity(0.18)
    static let wLive      = Color(red: 0.43, green: 0.84, blue: 0.55)
}

// MARK: - Bandera

/// Bandera empaquetada (`Shared/Flags.xcassets`). Las variantes regionales
/// ausentes caen a la bandera del país.
struct WidgetFlag: View {
    let code: String?
    var width: CGFloat = 18

    var body: some View {
        if let resolved = Self.resolved(code) {
            Image("Flags/\(resolved)")
                .resizable()
                .widgetAccentedRenderingMode(.fullColor)
                .scaledToFill()
                .frame(width: width, height: width * 0.75)
                .clipShape(RoundedRectangle(cornerRadius: 2))
                .accessibilityHidden(true)
        }
    }

    static func resolved(_ raw: String?) -> String? {
        guard let code = raw?.lowercased(), !code.isEmpty else { return nil }
        if UIImage(named: "Flags/\(code)") != nil { return code }
        if let base = code.split(separator: "-").first, UIImage(named: "Flags/\(base)") != nil { return String(base) }
        return nil
    }
}

// MARK: - Distintivo

struct WidgetBadgeView: View {
    let badge: WidgetBadge
    var font: Font = .caption.monospacedDigit()

    var body: some View {
        HStack(spacing: 3) {
            if let symbol = badge.symbol {
                Image(systemName: symbol).imageScale(.small)
            }
            Text(badge.text).lineLimit(1)
        }
        .font(font)
        .foregroundStyle(badge.emphasized ? Color.wLive : Color.wSecondary)
    }
}

// MARK: - Logotipo

/// Marca de Calendario Ciclismo (calendario + bicicleta) de la cabecera de la
/// app, sin márgenes, en blanco y acentuable en los modos tintados.
struct WidgetLogo: View {
    var height: CGFloat = 18

    var body: some View {
        Image("WidgetMark")
            .resizable()
            .renderingMode(.template)
            .widgetAccentable()
            .aspectRatio(74 / 32, contentMode: .fit)
            .frame(height: height)
            .foregroundStyle(Color.wPrimary.opacity(0.9))
            .accessibilityHidden(true)
    }
}

// MARK: - Accesos de carrera terminada

/// Copa (resultados) y TV (Revive), con la iconografía de Hoy. En los tamaños
/// que admiten varios enlaces cada icono abre su destino; en el resto, se
/// muestran como indicación.
struct WidgetFinishedActions: View {
    let results: URL?
    let revive: URL?
    let text: WidgetText
    var interactive = true
    var size: CGFloat = 15

    var body: some View {
        HStack(spacing: interactive ? 2 : 8) {
            if let results { icon("trophy", url: results, label: text.t("Resultados", "Results")) }
            if let revive { icon("tv", url: revive, label: text.t("Revive la carrera", "Relive the race")) }
        }
    }

    @ViewBuilder private func icon(_ symbol: String, url: URL, label: String) -> some View {
        let image = Image(systemName: symbol)
            .font(.system(size: size))
            .foregroundStyle(Color.wSecondary)
        if interactive {
            Link(destination: url) {
                image.frame(width: size + 16, height: size + 14).contentShape(Rectangle())
            }
            .accessibilityLabel(label)
        } else {
            image.accessibilityLabel(label)
        }
    }
}

// MARK: - Fila compacta (mediano y grande)

struct WidgetRow: View {
    let item: WidgetItem
    let now: Date
    let text: WidgetText

    private var state: WidgetRaceState { item.raceState(at: now) }
    private var dimmed: Bool { state == .rest || state == .cancelled }

    var body: some View {
        let actions = item.finishedActions(at: now)
        let badge = actions == nil ? item.badge(at: now, text: text) : nil
        HStack(spacing: 6) {
            Link(destination: item.url ?? URL(string: "calendariociclismo://tab/today")!) {
                HStack(spacing: 6) {
                    WidgetFlag(code: item.countryCode)
                        .frame(width: 20)
                    VStack(alignment: .leading, spacing: 1) {
                        HStack(spacing: 4) {
                            Text(item.name)
                                .font(.footnote.weight(.semibold))
                                .foregroundStyle(Color.wPrimary)
                                .lineLimit(1)
                            if item.isCX {
                                Text("CX")
                                    .font(.system(size: 8, weight: .bold))
                                    .foregroundStyle(Color.wSecondary)
                                    .padding(.horizontal, 3).padding(.vertical, 1)
                                    .background(Color.wBadge, in: RoundedRectangle(cornerRadius: 3))
                            }
                        }
                        HStack(spacing: 3) {
                            if !item.isCX, state != .rest, let icon = widgetStageIcon(item.primaryType) {
                                Image(systemName: icon).font(.system(size: 8, weight: .medium))
                            }
                            Text(item.detailLine(at: now, text: text)).lineLimit(1)
                        }
                        .font(.caption2)
                        .foregroundStyle(Color.wSecondary)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    if let badge, badge.url == nil {
                        WidgetBadgeView(badge: badge)
                    }
                }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(item.accessibilityText(at: now, text: text))
            }
            if let badge, let url = badge.url {
                Link(destination: url) { WidgetBadgeView(badge: badge) }
            }
            if let actions {
                WidgetFinishedActions(results: actions.results, revive: actions.revive, text: text)
            }
        }
        .opacity(dimmed ? 0.6 : 1)
    }
}

// MARK: - Mensajes de estado

struct WidgetNextLine: View {
    let next: WidgetNext
    let now: Date
    let text: WidgetText

    var body: some View {
        Link(destination: next.url ?? URL(string: "calendariociclismo://tab/today")!) {
            HStack(spacing: 6) {
                WidgetFlag(code: next.countryCode, width: 16)
                VStack(alignment: .leading, spacing: 1) {
                    Text(text.t("Próxima", "Next") + " · " + text.day(next.date, relativeTo: now))
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(Color.wTertiary)
                        .textCase(.uppercase)
                    Text([next.name, next.stageLabel].compactMap { $0 }.joined(separator: " · "))
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(Color.wPrimary)
                        .lineLimit(1)
                }
                Spacer(minLength: 4)
                if let tv = text.time(next.tvStartUtc) {
                    WidgetBadgeView(badge: WidgetBadge(symbol: "tv", text: tv, emphasized: false))
                } else if let start = text.time(next.startUtc) {
                    WidgetBadgeView(badge: WidgetBadge(symbol: "clock", text: start, emphasized: false))
                }
            }
        }
        .accessibilityElement(children: .combine)
    }
}

struct WidgetMessage: View {
    let title: String
    var symbol: String = "calendar"

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: symbol)
            Text(title).lineLimit(2)
        }
        .font(.subheadline.weight(.semibold))
        .foregroundStyle(Color.wPrimary)
    }
}

struct WidgetStaleDot: View {
    var body: some View {
        Circle()
            .fill(Color.white.opacity(0.5))
            .frame(width: 6, height: 6)
            .accessibilityHidden(true)
    }
}
