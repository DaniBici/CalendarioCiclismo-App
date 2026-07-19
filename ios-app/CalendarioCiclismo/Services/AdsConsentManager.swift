import AppTrackingTransparency
import Foundation
import GoogleMobileAds
import UserMessagingPlatform

/// Gestiona el consentimiento RGPD (UMP), el permiso ATT (App Tracking
/// Transparency) e inicializa el SDK de Google Mobile Ads, en este orden
/// estricto y una sola vez por proceso.
///
/// Espejo de `AdsConsentManager.kt` (Android). Orden iOS-específico:
///   1. UMP (`requestConsentInfoUpdate` → `loadAndPresentIfRequired`)
///   2. ATT (`ATTrackingManager.requestTrackingAuthorization`)
///   3. `MobileAds.shared.start()`
///
/// **Principio rector (CLAUDE.md):** si el usuario está suscrito
/// (`shouldShowAds == false`), este manager NO se invoca: ni UMP, ni el prompt
/// ATT, ni el arranque del SDK. Todo cuelga de `shouldShowAds`, nunca de
/// `featuresUnlocked`.
///
/// **Mensaje de consentimiento:** hasta que el usuario cree el mensaje "European
/// regulations" en el panel de AdMob, `loadAndPresentIfRequired` no mostrará
/// formulario en Europa; el SDK sirve anuncios igualmente. El código queda listo.
@MainActor
enum AdsConsentManager {

    /// El SDK de Mobile Ads se arranca una única vez por proceso.
    private static var didStartSDK = false

    /// Punto de entrada. Recoge consentimiento (UMP), pide ATT y arranca el SDK.
    /// Debe llamarse en cada arranque, pero solo cuando `shouldShowAds == true`.
    /// Es idempotente: el arranque del SDK está protegido por `didStartSDK`.
    static func gather() {
        let parameters = RequestParameters()
        ConsentInformation.shared.requestConsentInfoUpdate(with: parameters) { error in
            // El completion llega en el hilo principal. Encadenamos en un Task
            // @MainActor para poder usar la API async de ConsentForm.
            Task { @MainActor in
                if let error {
                    print("[AdsConsent] requestConsentInfoUpdate falló: \(error.localizedDescription)")
                } else {
                    await presentFormIfNeeded()
                }
                await requestATTThenStart()
            }
        }
    }

    private static func presentFormIfNeeded() async {
        guard let root = rootViewController else { return }
        do {
            try await ConsentForm.loadAndPresentIfRequired(from: root)
        } catch {
            print("[AdsConsent] loadAndPresentIfRequired falló: \(error.localizedDescription)")
        }
    }

    /// Pide ATT (si está en estado `.notDetermined`) y, sea cual sea la
    /// respuesta, arranca el SDK si `canRequestAds` lo permite. Rechazar ATT no
    /// impide servir anuncios: pasan a ser no personalizados.
    private static func requestATTThenStart() async {
        if ATTrackingManager.trackingAuthorizationStatus == .notDetermined {
            _ = await ATTrackingManager.requestTrackingAuthorization()
        }
        guard ConsentInformation.shared.canRequestAds else {
            print("[AdsConsent] canRequestAds=false — no se arranca el SDK de Ads")
            return
        }
        guard !didStartSDK else { return }
        didStartSDK = true
        await MobileAds.shared.start()
        print("[AdsConsent] MobileAds arrancado")
    }

    /// `rootViewController` de la escena activa, necesario para presentar el
    /// formulario de consentimiento.
    private static var rootViewController: UIViewController? {
        UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .first(where: { $0.activationState == .foregroundActive })?
            .windows
            .first(where: { $0.isKeyWindow })?
            .rootViewController
    }
}
