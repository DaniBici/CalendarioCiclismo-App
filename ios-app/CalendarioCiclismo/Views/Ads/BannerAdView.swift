import GoogleMobileAds
import SwiftUI

/// Banner adaptativo (anchored adaptive) de AdMob, envuelto en SwiftUI vía
/// `UIViewRepresentable`.
///
/// Espejo de `AdBanner.kt` (Android).
///
/// **Auto-medición del alto:** un banner adaptativo (y, sobre todo, los
/// creativos de la unidad de TEST de Google, que devuelven tamaños IAB fijos
/// como 320×50 / 468×60 / 728×90) no garantiza un alto fijo. En vez de adivinar
/// el alto, el `Coordinator` actúa de `BannerViewDelegate` y, cuando el anuncio
/// carga (`bannerViewDidReceiveAd`), publica el **tamaño realmente entregado**
/// para que el slot de SwiftUI se ajuste a él. Así nunca recorta ni desborda.
///
/// **Gate (defensa en profundidad):** además del gate en la vista que lo monta,
/// el wrapper `AdBannerSlot` no renderiza nada si el usuario está suscrito. El
/// SDK además solo arranca cuando `shouldShowAds` (ver `AdsConsentManager`).
struct BannerAdView: UIViewRepresentable {
    /// Ancho disponible en puntos para calcular el tamaño adaptativo.
    let width: CGFloat
    /// Callback con el tamaño real del anuncio una vez cargado, para que el
    /// contenedor SwiftUI se ajuste a la altura entregada.
    var onLoad: (CGSize) -> Void = { _ in }
    /// Callback cuando la petición de anuncio falla (no-fill, red…). El slot
    /// colapsa para no dejar un hueco vacío que además intercepte toques.
    var onFail: () -> Void = {}

    func makeCoordinator() -> Coordinator {
        Coordinator(onLoad: onLoad, onFail: onFail)
    }

    func makeUIView(context: Context) -> BannerView {
        let banner = BannerView(adSize: largeAnchoredAdaptiveBanner(width: width))
        banner.adUnitID = AdsConfig.bannerUnitID
        banner.rootViewController = Self.rootViewController
        banner.delegate = context.coordinator
        // Garantía a nivel UIKit: si el creativo entregado es más ancho que el
        // hueco (p. ej. el 468×60 de la unidad de test), se recorta a los
        // límites de la `BannerView` en vez de pintar fuera y romper la columna.
        banner.clipsToBounds = true
        banner.load(Request())
        return banner
    }

    func updateUIView(_ uiView: BannerView, context: Context) {
        context.coordinator.onLoad = onLoad
        context.coordinator.onFail = onFail
        // Si cambia el ancho (rotación), recalcular el tamaño adaptativo.
        let newSize = largeAnchoredAdaptiveBanner(width: width)
        if !isAdSizeEqualToSize(size1: uiView.adSize, size2: newSize) {
            uiView.adSize = newSize
        }
    }

    final class Coordinator: NSObject, BannerViewDelegate {
        var onLoad: (CGSize) -> Void
        var onFail: () -> Void

        init(onLoad: @escaping (CGSize) -> Void, onFail: @escaping () -> Void) {
            self.onLoad = onLoad
            self.onFail = onFail
        }

        func bannerViewDidReceiveAd(_ bannerView: BannerView) {
            // Tamaño real del creativo entregado (puede diferir del pedido,
            // sobre todo con la unidad de test). El slot se ajusta a él.
            onLoad(cgSize(for: bannerView.adSize))
        }

        func bannerView(_ bannerView: BannerView, didFailToReceiveAdWithError error: Error) {
            // No-fill / sin red. El SDK reintenta solo en el siguiente ciclo de
            // auto-refresco de la unidad (el slot se mantiene montado a alto 0).
            onFail()
        }
    }

    private func isAdSizeEqualToSize(size1: AdSize, size2: AdSize) -> Bool {
        cgSize(for: size1) == cgSize(for: size2)
    }

    private static var rootViewController: UIViewController? {
        UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .first(where: { $0.activationState == .foregroundActive })?
            .windows
            .first(where: { $0.isKeyWindow })?
            .rootViewController
    }
}

/// Slot listo para colocar en cualquier vista: se auto-oculta si el usuario
/// está suscrito (`shouldShowAds == false`) y mide su propio ancho disponible.
/// Es lo que se inserta en Hoy / detalle de carrera / detalle de etapa.
///
/// El alto NO se fija a un valor mágico: el banner publica su tamaño real al
/// cargar y el slot se ajusta a esa altura. El contenido se centra para que un
/// creativo de test más ancho que el móvil (p. ej. 468×60 / 728×90) no quede
/// pegado al borde izquierdo y recortado de forma asimétrica.
struct AdBannerSlot: View {
    private let premium = PremiumService.shared
    @State private var availableWidth: CGFloat = 0
    @State private var loadedHeight: CGFloat?
    /// La petición falló (no-fill aleatorio de la unidad real, sin red…) y aún
    /// no hay ningún anuncio cargado → el slot COLAPSA a alto 0. Sin esto, el
    /// `BannerView` vacío se quedaba ocupando el hueco reservado e
    /// interceptando los toques de la zona — la card inmediatamente anterior
    /// "dejaba de ser pulsable" de forma aparentemente aleatoria (Hoy /
    /// competición). El `BannerView` sigue montado a alto 0: si el
    /// auto-refresco de la unidad entrega un anuncio más tarde, el slot se
    /// vuelve a expandir.
    @State private var hasFailed = false

    var body: some View {
        if premium.shouldShowAds {
            content
        }
    }

    @ViewBuilder
    private var content: some View {
        // Alto reservado antes de que cargue: el del `AdSize` adaptativo para el
        // ancho disponible (evita salto de layout). Una vez cargado, usamos el
        // alto real entregado por el SDK. Si la petición falló y no hay anuncio,
        // el slot colapsa (no se reserva hueco para un anuncio que no existe).
        let reservedHeight = availableWidth > 0
            ? cgSize(for: largeAnchoredAdaptiveBanner(width: availableWidth)).height
            : 50
        let slotHeight: CGFloat = hasFailed ? 0 : (loadedHeight ?? reservedHeight)

        // El hueco del banner ocupa EXACTAMENTE el ancho disponible (el del
        // resto de tarjetas, ya que el contenedor padre aplica el padding
        // horizontal) y el alto del anuncio. El `BannerView` se fija a ese
        // mismo ancho y se recorta a él: un creativo de test más ancho que el
        // móvil (468×60 / 728×90) se recorta y centra dentro de la columna, NO
        // rompe el ancho de las tarjetas. Un anuncio real (unidad de
        // producción) viene dimensionado al ancho pedido y no se recorta.
        Group {
            // El `BannerView` se crea SOLO cuando ya conocemos el ancho real: si
            // lo montáramos con un ancho provisional (1 pt), el `load(Request())`
            // inicial pediría un tamaño adaptativo degenerado.
            if availableWidth > 0 {
                BannerAdView(
                    width: availableWidth,
                    onLoad: { size in
                        // Guardia: un "anuncio" sin alto útil se trata como fallo
                        // (colapso), nunca como un hueco vacío.
                        guard size.height > 0 else {
                            if loadedHeight == nil { hasFailed = true }
                            return
                        }
                        hasFailed = false
                        loadedHeight = size.height
                    },
                    onFail: {
                        // Solo colapsa si NUNCA llegó a cargar: si falla un
                        // refresco posterior, el SDK conserva el último anuncio
                        // visible y no hay que esconder nada.
                        if loadedHeight == nil { hasFailed = true }
                    }
                )
                // Clamp duro al ancho del hueco: el banner NUNCA puede ser más
                // ancho que la columna de tarjetas. Sin `.fixedSize` (que dejaba
                // que conservara su ancho intrínseco de 468 pt y desbordara).
                .frame(width: availableWidth, height: slotHeight)
                .clipped()
            } else {
                Color.clear
            }
        }
        .frame(maxWidth: .infinity)
        .frame(height: slotHeight)
        .clipped()
        // El banner solo es interactivo cuando HAY un anuncio cargado: un
        // `BannerView` cargando o sin fill no debe poder capturar toques
        // (defensa directa contra el bloqueo de la card vecina).
        .allowsHitTesting(loadedHeight != nil)
        .background(
            GeometryReader { geo in
                Color.clear
                    .onAppear { availableWidth = geo.size.width }
                    .onChange(of: geo.size.width) { _, newWidth in
                        availableWidth = newWidth
                    }
            }
        )
    }
}
