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

struct RaceActionLabel: View {
    let label: String
    var icon: String? = nil
    var primary = true
    var selected = false
    /// Tinte neutro (secundario) para los indicadores de categoría de la
    /// agenda de ciclocross; el resto de acciones conservan el acento.
    var neutral = false
    private var tint: Color { neutral ? .secondary : .accentColor }
    var body: some View {
        HStack(spacing: 3) {
            if let icon { Image(systemName: icon).font(.caption2) }
            if !label.isEmpty { Text(label).font(.caption2.weight(.semibold)).textCase(.uppercase) }
        }
        .padding(.horizontal, 8).padding(.vertical, 3)
        .foregroundStyle(primary ? Color.white : tint)
        .background(primary ? Color.accentColor : tint.opacity(selected ? 0.18 : 0.10))
        .clipShape(RoundedRectangle(cornerRadius: 3))
    }
}

struct WaitingResultsLabel: View {
    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: "flag.checkered").font(.system(size: 18, weight: .medium))
            PulsingDotsView(color: .secondary, size: 4, spacing: 3)
        }.font(.caption).fontWeight(.semibold).foregroundStyle(.secondary)
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
        .background(tint.opacity(selected ? 0.18 : 0.10), in: RoundedRectangle(cornerRadius: 3))
    }
    private var tileHeight: CGFloat { boxOnly ? 24 : 40 }
    @ViewBuilder private var tileContent: some View {
        if boxOnly {
            Text(label).font(.system(size: 11, weight: .semibold))
        } else {
            VStack(spacing: 2) {
                Text(label).font(.system(size: 11, weight: .semibold))
                detail().font(.system(size: 12, weight: .semibold)).frame(height: 14)
            }
        }
    }
}

struct RaceCardChevron: View {
    var body: some View {
        Image(systemName: "chevron.right").font(.caption).foregroundStyle(.tertiary).accessibilityHidden(true)
    }
}
