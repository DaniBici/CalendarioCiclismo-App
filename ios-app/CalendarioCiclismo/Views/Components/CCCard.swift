import SwiftUI

/// Tarjeta canónica de la app — superficie pulida única extraída del cintillo
/// "Hoy" (`TodayHighlightsBanner`). Centraliza el "tratamiento de tarjeta" para
/// que toda la UI iOS comparta el mismo lenguaje visual:
///
///  - Esquinas redondeadas continuas (18pt por defecto, igual que el cintillo).
///  - Superficie de material translúcido (`.regularMaterial`), como el cintillo,
///    en vez de un color plano — da profundidad sutil sobre el fondo.
///  - Tinte de marca opcional muy leve sobre el material (7% por defecto).
///  - Hairline de borde (`Color.primary.opacity(0.06)`, 0.5pt) para definir la
///    tarjeta sobre fondos claros, donde el material casi se funde con
///    `systemBackground`.
///  - Sombra suave (negro 6%, radio 8, y=3) idéntica a la del cintillo.
///
/// El contenido recibe el área interna ya recortada a la forma de la tarjeta;
/// cualquier gesto/ripple del contenido queda confinado a las esquinas.
///
/// Paridad de referencia: `TodayHighlightsBanner.bannerCard` / Android `CCCard`.
struct CCCard<Content: View>: View {
    /// Color de marca; si no es nulo, tiñe el material a `accentAlpha`.
    var accent: Color? = nil
    var accentAlpha: Double = 0.07
    var cornerRadius: CGFloat = 18
    /// Si es `false`, omite la sombra (útil para tarjetas embebidas en listas
    /// largas donde N sombras apiladas pesarían demasiado).
    var showShadow: Bool = true
    @ViewBuilder var content: () -> Content

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
        content()
            .background(cardSurface)
            .clipShape(shape)
            .overlay(
                // Hairline de definición sobre fondos claros.
                shape.strokeBorder(Color.primary.opacity(0.06), lineWidth: 0.5)
            )
            .shadow(
                color: showShadow ? Color.black.opacity(0.06) : .clear,
                radius: showShadow ? 8 : 0,
                x: 0,
                y: showShadow ? 3 : 0
            )
    }

    /// Superficie de la tarjeta: material translúcido con un tinte de marca muy
    /// leve encima cuando se proporciona `accent`.
    @ViewBuilder
    private var cardSurface: some View {
        ZStack {
            Rectangle().fill(.regularMaterial)
            if let accent {
                accent.opacity(accentAlpha)
            }
        }
    }
}

// MARK: - Modificador de superficie para tarjetas de detalle

extension View {
    /// Aplica el tratamiento de tarjeta canónico (esquinas + hairline + sombra
    /// suave) sobre un color de fondo PLANO — la variante "neutra fría" del
    /// rediseño, para secciones de detalle y Ajustes que son bloques de una
    /// sola entidad (no listados de carreras distintas). Sustituye al par
    /// `.background(AppTheme.cardBackground).clipShape(RoundedRectangle(...))`,
    /// añadiéndole el hairline y la sombra del cintillo "Hoy".
    ///
    /// Paridad: Android `CCCard` neutro (sin `accent`).
    func ccCardSurface(
        cornerRadius: CGFloat = 12,
        fill: Color = AppTheme.cardBackground,
        showShadow: Bool = true
    ) -> some View {
        let shape = RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
        return self
            .background(fill)
            .clipShape(shape)
            .overlay(
                shape.strokeBorder(Color.primary.opacity(0.06), lineWidth: 0.5)
            )
            .shadow(
                color: showShadow ? Color.black.opacity(0.06) : .clear,
                radius: showShadow ? 8 : 0,
                x: 0,
                y: showShadow ? 3 : 0
            )
    }
}
