import SwiftUI

struct RaceCardIdentity<Title: View, Details: View>: View {
    let logoUrl: String?
    var countryCode: String? = nil
    var stackedFlag = false
    /// Sin logo, hueco de la marca (no en los Campeonatos Nacionales).
    var logoPlaceholder = false
    @ViewBuilder var title: () -> Title
    @ViewBuilder var details: () -> Details
    var body: some View {
        HStack(alignment: stackedFlag ? .top : .center, spacing: 10) {
            if stackedFlag {
                VStack(spacing: 3) {
                    RaceLogo(logoUrl, size: 32, placeholder: logoPlaceholder).frame(width: 32, height: 32)
                    CountryFlag(countryCode: countryCode, outlined: true).frame(height: 16)
                }.frame(width: 36)
            } else { RaceLogo(logoUrl, size: 36, placeholder: logoPlaceholder) }
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
    /// Segundo icono, solo en la variante de solo icono (etiqueta vacía): el
    /// del Resumen de ciclocross lleva el de TV y el de retroceso.
    var secondIcon: String? = nil
    var primary = true
    var selected = false
    /// Tinte neutro (secundario) para los indicadores de categoría de la
    /// agenda de ciclocross.
    var neutral = false
    /// Esquinas redondeadas: dos etiquetas unidas comparten el lado recto.
    var corners: Corners = .all
    enum Corners { case all, leading, trailing }
    private var shape: UnevenRoundedRectangle {
        let r = AppTheme.Radius.control
        return UnevenRoundedRectangle(
            topLeadingRadius: corners == .trailing ? 0 : r,
            bottomLeadingRadius: corners == .trailing ? 0 : r,
            bottomTrailingRadius: corners == .leading ? 0 : r,
            topTrailingRadius: corners == .leading ? 0 : r
        )
    }
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
                    // El texto oculto conserva la altura de las etiquetas vecinas.
                    ZStack {
                        Text(" ").hidden()
                        HStack(spacing: 3) {
                            Label { Text(label) } icon: { ActionIcon(name: icon) }.labelStyle(.iconOnly)
                            if let secondIcon { Image(systemName: secondIcon) }
                        }
                    }
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
        .clipShape(shape)
    }
}

/// Icono de una etiqueta de acción: un símbolo del sistema o uno propio
/// (`StartlistIcon.name`, `BibSearchIcon.name`).
struct ActionIcon: View {
    let name: String
    var body: some View {
        switch name {
        case StartlistIcon.name: StartlistIcon()
        case BibSearchIcon.name: BibSearchIcon()
        default: Image(systemName: name)
        }
    }
}

/// Dorsal para los enlaces a la lista de inscritos: rectángulo con cuatro
/// imperdibles y una cifra. Mismo trazo que la web (`startlistIconHtml`) y
/// Android (`ic_startlist_bib`): retícula de 24, trazo 2 y alto igual al de la
/// letra.
struct StartlistIcon: View {
    static let name = "cc.startlist"
    @ScaledMetric private var size: CGFloat
    init(size: CGFloat = AppTheme.TextSize.s12.rawValue) {
        _size = ScaledMetric(wrappedValue: size, relativeTo: .caption)
    }
    var body: some View {
        GridStrokeShape(glyph: .startlist)
            .stroke(style: StrokeStyle(lineWidth: size / 12, lineCap: .round, lineJoin: .round))
            .frame(width: size, height: size)
            .accessibilityHidden(true)
    }
}

/// Lupa con una cifra en la lente: «Busca dorsal» de la tarjeta de Hoy. Mismo
/// trazo que la web (`bibSearchIconHtml`) y Android (`ic_bib_search`).
struct BibSearchIcon: View {
    static let name = "cc.bib.search"
    @ScaledMetric private var size: CGFloat
    init(size: CGFloat = AppTheme.TextSize.s12.rawValue) {
        _size = ScaledMetric(wrappedValue: size, relativeTo: .caption)
    }
    var body: some View {
        GridStrokeShape(glyph: .bibSearch)
            .stroke(style: StrokeStyle(lineWidth: size / 12, lineCap: .round, lineJoin: .round))
            .frame(width: size, height: size)
            .accessibilityHidden(true)
    }
}

/// Trazo sobre una retícula de 24 centrada en el rectángulo disponible.
private struct GridStrokeShape: Shape {
    enum Glyph { case startlist, bibSearch }
    let glyph: Glyph

    func path(in rect: CGRect) -> Path {
        let s = min(rect.width, rect.height) / 24
        let x0 = rect.midX - 12 * s, y0 = rect.midY - 12 * s
        func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: x0 + x * s, y: y0 + y * s) }
        var path = Path()
        switch glyph {
        case .startlist:
            path.addRoundedRect(in: CGRect(origin: p(3, 4.5), size: CGSize(width: 18 * s, height: 15 * s)),
                                cornerSize: CGSize(width: s, height: s))
            path.addLines([p(10.7, 10.6), p(12.6, 9.2), p(12.6, 15.5)])
            // Imperdibles: un segmento mínimo con remate redondo pinta un punto.
            for (x, y): (CGFloat, CGFloat) in [(6.3, 7.8), (17.7, 7.8), (6.3, 16.2), (17.7, 16.2)] {
                path.addLines([p(x, y), p(x + 0.01, y)])
            }
        case .bibSearch:
            path.addEllipse(in: CGRect(origin: p(3.5, 3.5), size: CGSize(width: 14 * s, height: 14 * s)))
            path.addLines([p(21, 21), p(15.5, 15.5)])
            path.addLines([p(9.2, 9.3), p(11.1, 7.9), p(11.1, 13.5)])
        }
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
