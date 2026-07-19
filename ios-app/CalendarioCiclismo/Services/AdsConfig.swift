import Foundation

/// Punto único de configuración de AdMob (FASE B). Centraliza el App ID y los
/// Ad Unit IDs con un flag test/producción para no tener que tocar varias
/// vistas cuando se cree la unidad real.
///
/// Espejo del objeto `AdsConfig` de Android (`data/ads/AdsConfig.kt`).
///
/// **Principio rector (CLAUDE.md):** todo lo de anuncios cuelga de
/// `PremiumService.shouldShowAds`; NUNCA de `featuresUnlocked`. Esta config solo
/// provee identificadores — el gate de si se inicializa/renderiza vive en la capa
/// que la consume.
enum AdsConfig {

    /// App ID de AdMob (iOS). También declarado en Info.plist
    /// (`GADApplicationIdentifier`).
    static let appID = "ca-app-pub-7131748907832450~8887444226"

    /// En Debug servimos SIEMPRE unidades de test de Google (evita impresiones
    /// inválidas y posibles baneos de la cuenta durante el desarrollo). En
    /// Release se usan las unidades reales.
    private static var useTestAds: Bool {
        #if DEBUG
        return true
        #else
        return false
        #endif
    }

    /// Unidad de test oficial de Google para banner adaptativo (iOS).
    private static let testBannerUnitID = "ca-app-pub-3940256099942544/2934735716"

    /// Unidad real de banner (iOS), creada en AdMob (bloque "Banner iOS -
    /// inline"). En Release se sirve esta; en Debug se fuerza la de test.
    private static let prodBannerUnitID = "ca-app-pub-7131748907832450/5546577974"

    /// Ad Unit ID del banner según el flag test/prod.
    static var bannerUnitID: String {
        if useTestAds || prodBannerUnitID.isEmpty {
            return testBannerUnitID
        }
        return prodBannerUnitID
    }
}
