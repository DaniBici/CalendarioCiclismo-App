import Foundation

/// Servicio de región del usuario.
///
/// La región se detecta automáticamente a partir de la zona horaria del
/// dispositivo, igual que la web (`js/shared.js` → `_detectUserGroup`): no hay
/// selección manual en Ajustes. El bucket (`RegionPreference`) se conserva como
/// valor de `push_subscriptions.region`; la visibilidad de canales de TV usa el
/// grupo fino `broadcasts.country` detectado por TZ.
///
/// Paridad con `RegionDetector` en Android: al cambiar uno, cambiar el otro.
@MainActor @Observable
final class RegionService {
    static let shared = RegionService()

    /// Buckets continentales que usa `push_subscriptions.region` (CHECK en la
    /// base de datos). Nunca se elige a mano: se derivan de la TZ.
    enum RegionPreference: String, CaseIterable, Identifiable {
        case spain = "SPAIN"
        case europe = "EUROPE"
        case americas = "AMERICAS"
        case asia = "ASIA"
        case africa = "AFRICA"
        case all = "ALL"

        var id: String { rawValue }
    }

    /// Bucket efectivo según la TZ. Solo se usa para el `region` que se envía
    /// al servidor de notificaciones.
    var current: RegionPreference { Self.suggestedRegion() }

    /// Grupos `broadcasts.country` visibles según la TZ del dispositivo.
    /// Espejo de `filterBroadcastsByRegion` en `js/shared.js`.
    var allowedBroadcastGroups: Set<String> { Self.allowedBroadcastGroups() }

    /// Grupo fino `broadcasts.country` detectado por TZ (para `tv_start`).
    func effectiveCountryGroup() -> String? { Self.detectedCountryGroup() }

    // MARK: - Detección por TZ

    /// Zonas horarias que cubren España (Madrid, Canarias, Ceuta).
    private static let spainTimeZones: Set<String> = [
        "Europe/Madrid", "Atlantic/Canary", "Africa/Ceuta",
    ]

    /// Zonas horarias europeas que no empiezan por `Europe/` ni `Africa/Ceuta`
    /// (Atlántico Norte y oeste). Se tratan como europeas.
    private static let europeExtraTimeZones: Set<String> = [
        "Atlantic/Azores", "Atlantic/Madeira", "Atlantic/Faroe",
        "Atlantic/Reykjavik", "Arctic/Longyearbyen",
    ]

    /// Mapa TZ → grupo `broadcasts.country` fino. Solo cubre Europa fina; el
    /// resto se calcula por prefijo en [detectedCountryGroup].
    ///
    /// Paridad con `_COUNTRY_TZ_MAP` de `js/shared.js` y `FINE_TZ_MAP` de
    /// `RegionDetector.kt`.
    private static let fineTimeZoneMap: [String: String] = [
        // ES
        "Europe/Madrid": "ES", "Atlantic/Canary": "ES", "Africa/Ceuta": "ES",
        // PT
        "Europe/Lisbon": "PT", "Atlantic/Azores": "PT", "Atlantic/Madeira": "PT",
        // FR
        "Europe/Paris": "FR", "Europe/Monaco": "FR",
        // BE / NL
        "Europe/Brussels": "BE",
        "Europe/Amsterdam": "NL",
        // IT
        "Europe/Rome": "IT", "Europe/Vatican": "IT",
        "Europe/San_Marino": "IT", "Europe/Malta": "IT",
        // DE / AT / CH
        "Europe/Berlin": "DE_AT_CH", "Europe/Busingen": "DE_AT_CH",
        "Europe/Vienna": "DE_AT_CH",
        "Europe/Zurich": "DE_AT_CH", "Europe/Vaduz": "DE_AT_CH",
        // UK / IE
        "Europe/London": "UK_IE", "Europe/Belfast": "UK_IE", "Europe/Guernsey": "UK_IE",
        "Europe/Jersey": "UK_IE", "Europe/Isle_of_Man": "UK_IE", "Europe/Gibraltar": "UK_IE",
        "Europe/Dublin": "UK_IE",
        // Nórdicos
        "Europe/Copenhagen": "SCANDI", "Atlantic/Faroe": "SCANDI",
        "Europe/Oslo": "SCANDI", "Arctic/Longyearbyen": "SCANDI",
        "Europe/Stockholm": "SCANDI",
        "Europe/Helsinki": "SCANDI", "Europe/Mariehamn": "SCANDI",
        "Atlantic/Reykjavik": "SCANDI",
        // Europa del Este (EE)
        "Europe/Warsaw": "EE", "Europe/Prague": "EE", "Europe/Bratislava": "EE",
        "Europe/Ljubljana": "EE", "Europe/Zagreb": "EE", "Europe/Budapest": "EE",
        "Europe/Bucharest": "EE", "Europe/Sofia": "EE", "Europe/Tallinn": "EE",
        "Europe/Riga": "EE", "Europe/Vilnius": "EE", "Europe/Belgrade": "EE",
        "Europe/Sarajevo": "EE", "Europe/Skopje": "EE", "Europe/Podgorica": "EE",
        "Europe/Tirane": "EE", "Europe/Chisinau": "EE", "Europe/Kiev": "EE",
        "Europe/Kyiv": "EE", "Europe/Uzhgorod": "EE", "Europe/Zaporozhye": "EE",
        "Europe/Simferopol": "EE", "Europe/Minsk": "EE",
        "Europe/Athens": "EE", "Asia/Nicosia": "EE", "Europe/Nicosia": "EE",
        "Europe/Istanbul": "EE", "Asia/Istanbul": "EE", "Turkey": "EE",
    ]

    /// Set de TZs MENA (Norte de África + Oriente Medio).
    private static let menaTimeZones: Set<String> = [
        "Africa/Cairo", "Africa/Algiers", "Africa/Tunis",
        "Africa/Casablanca", "Africa/El_Aaiun", "Africa/Tripoli",
        "Africa/Khartoum",
        "Asia/Riyadh", "Asia/Dubai", "Asia/Qatar", "Asia/Kuwait",
        "Asia/Bahrain", "Asia/Muscat", "Asia/Baghdad", "Asia/Tehran",
        "Asia/Jerusalem", "Asia/Tel_Aviv", "Asia/Beirut",
        "Asia/Damascus", "Asia/Amman", "Asia/Aden",
        "Asia/Hebron", "Asia/Gaza",
    ]

    /// TZs de América del Norte (NORTEAM). El resto de `America/*` cae en LATAM.
    private static let norteamTimeZones: Set<String> = [
        "America/New_York", "America/Chicago", "America/Denver",
        "America/Los_Angeles", "America/Phoenix", "America/Anchorage",
        "America/Adak", "America/Toronto", "America/Vancouver",
        "America/Edmonton", "America/Winnipeg", "America/Halifax",
        "America/St_Johns", "America/Detroit", "America/Indianapolis",
        "America/Boise", "America/Juneau", "Pacific/Honolulu",
        "America/Regina",
    ]

    /// Bucket sugerido según la TZ. Nunca devuelve `.all`. Si la TZ no encaja,
    /// vuelve a `.spain` para preservar el baseline.
    static func suggestedRegion(timeZoneId: String = TimeZone.current.identifier) -> RegionPreference {
        if spainTimeZones.contains(timeZoneId) { return .spain }
        if timeZoneId.hasPrefix("Europe/") || europeExtraTimeZones.contains(timeZoneId) {
            return .europe
        }
        if timeZoneId.hasPrefix("America/") || timeZoneId == "Pacific/Honolulu" {
            return .americas
        }
        if timeZoneId.hasPrefix("Asia/")
            || timeZoneId.hasPrefix("Pacific/")
            || timeZoneId.hasPrefix("Australia/")
            || timeZoneId == "Indian/Christmas"
            || timeZoneId == "Indian/Cocos" {
            return .asia
        }
        if timeZoneId.hasPrefix("Africa/") { return .africa }
        return .spain
    }

    /// True si la TZ pertenece a Europa (cubierta o no por un grupo fino).
    static func isEuropean(timeZoneId: String = TimeZone.current.identifier) -> Bool {
        if fineTimeZoneMap[timeZoneId] != nil { return true }
        return timeZoneId.hasPrefix("Europe/") || europeExtraTimeZones.contains(timeZoneId)
    }

    /// Grupo fino `broadcasts.country` para la TZ del device, o `nil` si no hay
    /// match (TZ rara, Europa no cubierta por un grupo fino, etc.).
    ///
    /// Paridad con `_detectUserGroup` de `js/shared.js` — al cambiar uno,
    /// cambiar el otro.
    static func detectedCountryGroup(timeZoneId: String = TimeZone.current.identifier) -> String? {
        if let fine = fineTimeZoneMap[timeZoneId] { return fine }
        if menaTimeZones.contains(timeZoneId) { return "MENA" }
        if norteamTimeZones.contains(timeZoneId) { return "NORTEAM" }
        if timeZoneId.hasPrefix("America/") { return "LATAM" }
        if timeZoneId.hasPrefix("Africa/") { return "AFRICA" }
        if timeZoneId.hasPrefix("Asia/")
            || timeZoneId.hasPrefix("Pacific/")
            || timeZoneId.hasPrefix("Australia/")
            || timeZoneId == "Indian/Christmas"
            || timeZoneId == "Indian/Cocos" {
            return "ASIAPAC"
        }
        return nil
    }

    /// Grupos `broadcasts.country` visibles para la TZ. Espejo exacto de
    /// `filterBroadcastsByRegion` en `js/shared.js`:
    /// - siempre `ALL`;
    /// - el grupo fino detectado, si lo hay;
    /// - `EUROPA` solo si el usuario es europeo y no está en `UK_IE`.
    static func allowedBroadcastGroups(timeZoneId: String = TimeZone.current.identifier) -> Set<String> {
        let group = detectedCountryGroup(timeZoneId: timeZoneId)
        var allowed: Set<String> = ["ALL"]
        if let group { allowed.insert(group) }
        if isEuropean(timeZoneId: timeZoneId) && group != "UK_IE" {
            allowed.insert("EUROPA")
        }
        return allowed
    }
}
