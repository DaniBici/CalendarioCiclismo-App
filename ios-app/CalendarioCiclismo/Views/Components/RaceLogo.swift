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
                // Preferir la copia local descargada por el modo offline si
                // existe — garantiza render sin red aunque `CachedAsyncImage`
                // no tenga el URL en su disk cache.
                let effectiveURL = CacheManager.localLogoFileURL(for: imageUrl) ?? imageUrl
                CachedAsyncImage(url: effectiveURL) {
                    // Mientras carga: hueco del mismo tamaño para no saltar el
                    // layout cuando llega la imagen.
                    Color.clear
                        .frame(width: size, height: size)
                }
                .aspectRatio(contentMode: .fit)
                .frame(width: size, height: size)
                .clipShape(RoundedRectangle(cornerRadius: 3))
            }
            // Sin logo: NO se renderiza nada (EmptyView) → el slot no ocupa
            // espacio y el contenido a su derecha se desplaza a ocuparlo. En un
            // HStack con spacing, el espaciado solo se aplica entre vistas
            // visibles, así que tampoco queda hueco de separación.
        }
        .accessibilityHidden(true)
    }
}
