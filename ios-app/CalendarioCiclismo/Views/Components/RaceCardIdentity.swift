import SwiftUI

struct RaceCardIdentity<Title: View, Details: View>: View {
    let logoUrl: String?
    var countryCode: String? = nil
    var stackedFlag = false
    @ViewBuilder var title: () -> Title
    @ViewBuilder var details: () -> Details
    var body: some View {
        HStack(alignment: stackedFlag ? .top : .center, spacing: 10) {
            if stackedFlag {
                VStack(spacing: 3) {
                    RaceLogo(logoUrl, size: 32).frame(width: 32, height: 32)
                    CountryFlag(countryCode: countryCode).frame(height: 16)
                }.frame(width: 36)
            } else { RaceLogo(logoUrl, size: 36) }
            VStack(alignment: .leading, spacing: 3) { title(); details() }
        }.frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// Etiqueta de acción de las tarjetas (Dorsales, Orden de salida, accesos
/// de ciclocross). `primary` es la etiqueta neutra de enlace (texto principal
/// sobre gris al 8 %); `neutral`, la informativa (texto atenuado). El acento
/// queda solo para la selección (`selected`). Con la etiqueta vacía se muestra
/// solo el icono.
struct RaceActionLabel: View {
    let label: String
    var icon: String? = nil
    var primary = true
    var selected = false
    /// Tinte neutro (secundario) para los indicadores de categoría de la
    /// agenda de ciclocross.
    var neutral = false
    private var colors: AppTheme.BadgeColor {
        if primary { return AppTheme.neutralLinkBadgeColor() }
        if neutral { return AppTheme.neutralBadgeColor() }
        return AppTheme.BadgeColor(
            background: Color.accentColor.opacity(selected ? 0.18 : 0.10),
            foreground: .accentColor
        )
    }
    var body: some View {
        Group {
            if let icon {
                if label.isEmpty {
                    Label { Text(label) } icon: { ActionIcon(name: icon) }.labelStyle(.iconOnly)
                } else {
                    Label { Text(label) } icon: { ActionIcon(name: icon) }.labelStyle(.titleAndIcon)
                }
            } else {
                Text(label)
            }
        }
        .ccFont(.s12, weight: .semibold)
        .padding(.horizontal, label.isEmpty ? 6 : 8).padding(.vertical, 3)
        .foregroundStyle(colors.foreground)
        .background(colors.background)
        .clipShape(RoundedRectangle(cornerRadius: AppTheme.Radius.control))
    }
}

/// Icono de una etiqueta de acción: SF Symbol o, con
/// `LogoCyclistIcon.name`, la bicicleta del logotipo.
struct ActionIcon: View {
    let name: String
    var body: some View {
        if name == LogoCyclistIcon.name { LogoCyclistIcon() } else { Image(systemName: name) }
    }
}

/// Bicicleta del logotipo para los enlaces a dorsales. Mismo trazo que
/// `favicon.svg`, la web (`startlistCyclistHtml`) y Android
/// (`ic_logo_cyclist`): retícula de 24, trazo 2 y alto igual al de la letra.
struct LogoCyclistIcon: View {
    static let name = "cc.logo.cyclist"
    @ScaledMetric private var size: CGFloat
    init(size: CGFloat = AppTheme.TextSize.s12.rawValue) {
        _size = ScaledMetric(wrappedValue: size, relativeTo: .caption)
    }
    var body: some View {
        LogoCyclistShape()
            .stroke(style: StrokeStyle(lineWidth: size / 12, lineCap: .round, lineJoin: .round))
            .frame(width: size, height: size)
            .accessibilityHidden(true)
    }
}

private struct LogoCyclistShape: Shape {
    func path(in rect: CGRect) -> Path {
        let s = min(rect.width, rect.height) / 24
        let x0 = rect.midX - 12 * s, y0 = rect.midY - 12 * s
        func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: x0 + x * s, y: y0 + y * s) }
        var path = Path()
        for (cx, cy, r): (CGFloat, CGFloat, CGFloat) in [(18.5, 17.5, 3.5), (5.5, 17.5, 3.5), (15, 5, 1)] {
            path.addEllipse(in: CGRect(origin: p(cx - r, cy - r), size: CGSize(width: 2 * r * s, height: 2 * r * s)))
        }
        path.addLines([p(12, 17.5), p(12, 14), p(9, 11), p(13, 8), p(15, 11), p(17, 11)])
        return path
    }
}

struct WaitingResultsLabel: View {
    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: "flag.checkered").font(.system(size: 18, weight: .medium))
            PulsingDotsView(color: .secondary, size: 4, spacing: 3)
        }.ccFont(.s12, weight: .semibold).foregroundStyle(.secondary)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(LocaleService.t("Esperando resultados", "Awaiting results"))
    }
}

struct RaceActionTileLabel<Detail: View>: View {
    let label: String
    var selected = false
    /// Reparte el cuadro por el ancho disponible (fila de la agenda CX con
    /// horarios) en vez de mantener el cuadro fijo de 40 puntos.
    var fillWidth = false
    /// Caja solo con la etiqueta (agenda CX): la hora o la copa se muestran
    /// fuera de la caja, bajo ella.
    var boxOnly = false
    /// Tinte neutro (secundario) para los indicadores de categoría CX.
    var neutral = false
    @ViewBuilder var detail: () -> Detail
    private var tint: Color { neutral ? .secondary : .accentColor }
    var body: some View {
        Group {
            if fillWidth {
                tileContent.frame(maxWidth: .infinity, minHeight: tileHeight, maxHeight: tileHeight)
            } else {
                tileContent.frame(width: 40, height: tileHeight)
            }
        }
        .foregroundStyle(tint)
        .background(tint.opacity(selected ? 0.18 : 0.10), in: RoundedRectangle(cornerRadius: AppTheme.Radius.control))
    }
    private var tileHeight: CGFloat { boxOnly ? 24 : 40 }
    @ViewBuilder private var tileContent: some View {
        if boxOnly {
            Text(label).ccFont(.s12, weight: .semibold)
        } else {
            VStack(spacing: 2) {
                Text(label).ccFont(.s12, weight: .semibold)
                detail().ccFont(.s12, weight: .semibold).frame(height: 14)
            }
        }
    }
}

struct RaceCardChevron: View {
    var body: some View {
        Image(systemName: "chevron.right").font(.caption).foregroundStyle(.tertiary).accessibilityHidden(true)
    }
}
