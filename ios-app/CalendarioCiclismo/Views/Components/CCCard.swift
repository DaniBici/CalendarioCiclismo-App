import SwiftUI

/// Política común de anchura para las superficies adaptativas de la app.
/// La decisión depende del contenedor y de la size class, nunca de la pantalla
/// física ni del modelo de dispositivo.
enum AdaptiveLayoutPolicy {
    struct BalancedBreak: Equatable {
        /// Número de bloques completos asignados a la primera columna.
        let blockIndex: Int
        /// Filas del bloque siguiente que también pasan a la primera columna.
        let offset: Int
    }

    static let twoColumnThreshold: CGFloat = 620
    static let detailThreshold: CGFloat = 820
    static let spacing: CGFloat = 12

    static func feedColumns(width: CGFloat, isRegular: Bool) -> Int {
        isRegular && width >= twoColumnThreshold ? 2 : 1
    }

    static func startlistColumns(width: CGFloat, isRegular: Bool) -> Int {
        guard isRegular else { return 1 }
        let usable = max(0, width)
        let fitted = Int((usable + spacing) / (290 + spacing))
        return min(3, max(1, fitted))
    }

    static func usesWideDetail(width: CGFloat, isRegular: Bool) -> Bool {
        isRegular && width >= detailThreshold
    }

    /// Divide categorías ordenadas de arriba abajo con un número de filas lo
    /// más equilibrado posible. Si el corte cae dentro de una categoría,
    /// devuelve el desplazamiento necesario para repetir su cabecera.
    static func balancedBreak(counts: [Int]) -> BalancedBreak {
        let target = (counts.reduce(0, +) + 1) / 2
        var accumulated = 0
        for (index, count) in counts.enumerated() {
            if accumulated + count < target {
                accumulated += count
                continue
            }
            if accumulated + count == target {
                return BalancedBreak(blockIndex: index + 1, offset: 0)
            }
            return BalancedBreak(blockIndex: index, offset: max(0, target - accumulated))
        }
        return BalancedBreak(blockIndex: counts.count, offset: 0)
    }

    static func rows<Item: Identifiable>(
        _ items: [Item],
        columns: Int,
        spansAllColumns: (Item) -> Bool = { _ in false }
    ) -> [AdaptiveGridRow<Item>] {
        guard columns > 1 else {
            return items.map { AdaptiveGridRow(items: [$0], spansAllColumns: true) }
        }
        var result: [AdaptiveGridRow<Item>] = []
        var pending: [Item] = []
        func flushPending() {
            guard !pending.isEmpty else { return }
            result.append(AdaptiveGridRow(items: pending, spansAllColumns: false))
            pending.removeAll(keepingCapacity: true)
        }
        for item in items {
            if spansAllColumns(item) {
                flushPending()
                result.append(AdaptiveGridRow(items: [item], spansAllColumns: true))
            } else {
                pending.append(item)
                if pending.count == columns { flushPending() }
            }
        }
        flushPending()
        return result
    }

    static func divisionSpacing(in _: GeometryProxy, fallback: CGFloat = 24) -> CGFloat {
        fallback
    }
}

struct AdaptiveGridRow<Item: Identifiable>: Identifiable {
    let items: [Item]
    let spansAllColumns: Bool
    var id: Item.ID { items[0].id }
}

/// Tarjeta canónica de la app: superficie neutra de `AppTheme.cardBackground`
/// con el radio de superficie (`AppTheme.Radius.surface`, 8 pt) y la sombra
/// común. Sin tinte de carrera ni filete: el color de carrera solo marca el
/// avance de una jornada en directo y el perfil recorrido.
///
/// El contenido recibe el área interna ya recortada a la forma de la tarjeta;
/// cualquier gesto/ripple del contenido queda confinado a las esquinas.
///
/// Paridad: Android `CCCard`.
struct CCCard<Content: View>: View {
    @ViewBuilder var content: () -> Content

    var body: some View {
        content().ccCardSurface()
    }
}

// MARK: - Modificador de superficie para tarjetas

extension View {
    /// Superficie de tarjeta: fondo plano, radio de superficie y sombra común.
    /// `cornerRadius: 0` queda para superficies a sangre (listas a ancho
    /// completo); el resto usa el radio de superficie.
    ///
    /// Paridad: Android `CCCard`.
    func ccCardSurface(
        cornerRadius: CGFloat = AppTheme.Radius.surface,
        fill: Color = AppTheme.cardBackground
    ) -> some View {
        let shape = RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
        return self
            .background(fill)
            .clipShape(shape)
            .ccCardShadow()
    }

    /// Sombra única de las tarjetas (negro 6 %, radio 8, y = 3), la misma en
    /// todas las superficies: cintillo, listados, detalle y Ajustes.
    func ccCardShadow() -> some View {
        shadow(color: Color.black.opacity(0.06), radius: 8, x: 0, y: 3)
    }
}

struct JornadaInfoCard<Content: View>: View {
    @ViewBuilder var content: () -> Content
    var body: some View {
        VStack(alignment: .leading, spacing: 8) { content() }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding()
            .ccCardSurface()
    }
}
