import SwiftUI

/// Logo de carrera cargado desde URL (Cloudflare R2).
struct RaceLogo: View {
    let url: String?
    let size: CGFloat

    init(_ url: String?, size: CGFloat = 32) {
        self.url = url
        self.size = size
    }

    var body: some View {
        Group {
            if let urlStr = url, let imageUrl = URL(string: urlStr) {
                // Solo la imagen ajustada y el recorte: sin caja, fondo, margen
                // ni borde en ninguna vista.
                logoImage(imageUrl, side: size)
                    .clipShape(RoundedRectangle(cornerRadius: AppTheme.Radius.control))
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
        CachedAsyncImage(url: imageUrl) {
            // Mientras carga: hueco del mismo tamaño para no saltar el layout
            // cuando llega la imagen.
            Color.clear
                .frame(width: side, height: side)
        }
        .aspectRatio(contentMode: .fit)
        .frame(width: side, height: side)
    }
}
