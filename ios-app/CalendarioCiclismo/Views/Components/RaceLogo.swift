import SwiftUI

/// Logo de carrera cargado desde URL (Cloudflare R2).
struct RaceLogo: View {
    let url: String?
    let size: CGFloat
    /// Sin logo, o si no carga, pinta el hueco de la marca (`LogoPlaceholder`)
    /// en lugar de nada. Solo en carreras que admiten logo: nunca en los
    /// Campeonatos Nacionales.
    let placeholder: Bool

    init(_ url: String?, size: CGFloat = 32, placeholder: Bool = false) {
        self.url = url
        self.size = size
        self.placeholder = placeholder
    }

    var body: some View {
        Group {
            if let urlStr = url, !urlStr.isEmpty, let imageUrl = URL(string: urlStr) {
                // Solo la imagen ajustada y el recorte: sin caja, fondo, margen
                // ni borde en ninguna vista.
                logoImage(imageUrl, side: size)
                    .clipShape(RoundedRectangle(cornerRadius: AppTheme.Radius.control))
            } else if placeholder {
                LogoPlaceholder(side: size)
            }
            // Sin logo: NO se renderiza nada (EmptyView) → el slot no ocupa
            // espacio y el contenido a su derecha se desplaza a ocuparlo. En un
            // HStack con spacing, el espaciado solo se aplica entre vistas
            // visibles, así que tampoco queda hueco de separación.
        }
        .accessibilityHidden(true)
    }

    private func logoImage(_ imageUrl: URL, side: CGFloat) -> some View {
        // La URL remota identifica la carga; la copia local sirve de respaldo.
        CachedAsyncImage(url: imageUrl) { failed in
            // Mientras carga: hueco del mismo tamaño para no saltar el layout
            // cuando llega la imagen. Si falla, el hueco de la marca.
            if failed && placeholder {
                LogoPlaceholder(side: side)
            } else {
                Color.clear
                    .frame(width: side, height: side)
            }
        }
        .aspectRatio(contentMode: .fit)
        .frame(width: side, height: side)
    }
}

/// Hueco de logotipo: la marca de la cabecera (calendario y bici) en gris
/// terciario sobre el relleno neutro, con el radio de control y el tamaño del
/// logo, para que filas y cabeceras no cambien de forma. Concepto de
/// Alejandro Monteagudo con la estética actual de la app (web:
/// `logoPlaceholderHtml`; Android: `LogoPlaceholder`).
struct LogoPlaceholder: View {
    let side: CGFloat

    var body: some View {
        RoundedRectangle(cornerRadius: AppTheme.Radius.control, style: .continuous)
            .fill(AppTheme.neutralFill)
            .overlay {
                Image("HeaderLogo")
                    .renderingMode(.template)
                    .resizable()
                    .scaledToFit()
                    .foregroundStyle(AppTheme.textDim)
                    .padding(side * 0.14)
            }
            .frame(width: side, height: side)
            .accessibilityHidden(true)
    }
}
