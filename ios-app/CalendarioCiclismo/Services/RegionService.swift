import Foundation

/// Servicio centralizado de preferencia regional (España / Europa / América /
/// Asia y Pacífico / África / Todas).
///
/// Sigue el mismo patrón que `ThemeService` y `LocaleService`:
/// - Preferencia persistida en `UserDefaults` con clave `region_preference`.
/// - Valor por defecto: `.spain` (baseline gratuito heredado de 1.4.4 —
///   `ALL + ES + EUROPA`). Cualquier instalación pre-2.0 que actualice
///   mantiene este valor por defecto y sigue viendo lo mismo de siempre.
/// - `@Observable` para que cambios en runtime recalculen filtros sin
///   reiniciar la app.
///
/// Todas las preferencias regionales están disponibles sin compra desde 4.3.
@MainActor @Observable
final class RegionService {
    static let shared = RegionService()

    /// Regiones expuestas al usuario en Ajustes / onboarding. El mapping a
    /// los grupos `broadcasts.country` permitidos vive en [allowedBroadcastGroups].
    enum RegionPreference: String, CaseIterable, Identifiable {
        case spain = "SPAIN"
        case europe = "EUROPE"
        case americas = "AMERICAS"
        case asia = "ASIA"
        case africa = "AFRICA"
        case all = "ALL"

        var id: String { rawValue }

        /// Conjunto de valores `broadcasts.country` que son visibles cuando
        /// esta preferencia está activa. Los broadcasts sin `country` se
        /// consideran globales (compatibilidad con datos antiguos).
        var allowedBroadcastGroups: Set<String> {
            switch self {
            case .spain:
                return ["ALL", "EUROPA", "ES"]
            case .europe:
                return [
                    "ALL", "EUROPA",
                    "ES", "PT", "FR", "BE", "NL", "IT",
                    "DE_AT_CH", "UK_IE", "SCANDI", "EE",
                ]
            case .americas:
                return ["ALL", "NORTEAM", "LATAM"]
            case .asia:
                return ["ALL", "ASIAPAC", "MENA"]
            case .africa:
                return ["ALL", "AFRICA", "MENA"]
            case .all:
                return [
                    "ALL", "EUROPA",
                    "ES", "PT", "FR", "BE", "NL", "IT",
                    "DE_AT_CH", "UK_IE", "SCANDI", "EE",
                    "NORTEAM", "LATAM",
                    "ASIAPAC", "MENA",
                    "AFRICA",
                ]
            }
        }

        /// Etiqueta visible en la UI. Devuelve la cadena fuente en español;
        /// `LocalizedStringKey(label)` resuelve la traducción contra el
        /// catálogo `Localizable.xcstrings` (sourceLanguage = "es").
        var labelKey: String {
            switch self {
            case .spain: return "España"
            case .europe: return "Europa"
            case .americas: return "América"
            case .asia: return "Asia y Pacífico"
            case .africa: return "África"
            case .all: return "Todas las regiones"
            }
        }

        /// Emoji decorativo para chips/filas. Hardcoded — no traducción.
        var flagEmoji: String {
            switch self {
            case .spain: return "🇪🇸"
            case .europe: return "🇪🇺"
            case .americas: return "🌎"
            case .asia: return "🌏"
            case .africa: return "🌍"
            case .all: return "🌐"
            }
        }

        /// Grupos finos `broadcasts.country` que el usuario puede elegir como
        /// "país preferido" dentro de este bucket. Se usan para sobrescribir
        /// la detección automática por TZ a la hora de afinar `tv_start`.
        ///
        /// SPAIN solo expone ES (un único grupo fino, sin elección). ALL no
        /// expone sub-selector — usa la TZ siempre (usuario itinerante).
        /// El resto exponen los grupos finos relevantes.
        var availableCountryGroups: [String] {
            switch self {
            case .spain:
                return ["ES"]
            case .europe:
                return ["ES", "PT", "FR", "BE", "NL", "IT",
                        "DE_AT_CH", "UK_IE", "SCANDI", "EE"]
            case .americas:
                return ["NORTEAM", "LATAM"]
            case .asia:
                return ["ASIAPAC", "MENA"]
            case .africa:
                return ["AFRICA", "MENA"]
            case .all:
                return []
            }
        }
    }

    // MARK: - País preferido (sub-selector dentro del bucket)

    /// Nombre humano del grupo fino `broadcasts.country`. Sirve para etiquetar
    /// filas del sub-selector. Devuelve la cadena fuente en español; las
    /// traducciones EN se resuelven vía `LocalizedStringKey`.
    static func countryGroupLabel(_ group: String) -> String {
        switch group {
        case "ES": return "España"
        case "PT": return "Portugal"
        case "FR": return "Francia"
        case "BE": return "Bélgica"
        case "NL": return "Países Bajos"
        case "IT": return "Italia"
        case "DE_AT_CH": return "Alemania / Austria / Suiza"
        case "UK_IE": return "Reino Unido / Irlanda"
        case "SCANDI": return "Países nórdicos"
        case "EE": return "Europa del Este"
        case "NORTEAM": return "EE. UU. y Canadá"
        case "LATAM": return "América Latina"
        case "ASIAPAC": return "Asia y Pacífico"
        case "MENA": return "Oriente Medio y Norte de África"
        case "AFRICA": return "África subsahariana"
        default: return group
        }
    }

    /// Bandera/emoji decorativo del grupo fino. Hardcoded.
    static func countryGroupEmoji(_ group: String) -> String {
        switch group {
        case "ES": return "🇪🇸"
        case "PT": return "🇵🇹"
        case "FR": return "🇫🇷"
        case "BE": return "🇧🇪"
        case "NL": return "🇳🇱"
        case "IT": return "🇮🇹"
        case "DE_AT_CH": return "🇩🇪"
        case "UK_IE": return "🇬🇧"
        case "SCANDI": return "🇸🇪"
        case "EE": return "🇵🇱"
        case "NORTEAM": return "🇺🇸"
        case "LATAM": return "🌎"
        case "ASIAPAC": return "🌏"
        case "MENA": return "🌍"
        case "AFRICA": return "🌍"
        default: return "🏳️"
        }
    }

    private static let defaultsKey = "region_preference"
    private static let preferredGroupKey = "preferred_country_group"

    /// Preferencia actual. Observada por las vistas que filtran broadcasts.
    private(set) var current: RegionPreference

    /// País preferido dentro del bucket (override manual del grupo fino para
    /// afinar `tv_start`). `nil` = detección automática por TZ.
    private(set) var preferredCountryGroup: String?

    private init() {
        let raw = UserDefaults.standard.string(forKey: Self.defaultsKey)
            ?? RegionPreference.spain.rawValue
        self.current = RegionPreference(rawValue: raw) ?? .spain
        self.preferredCountryGroup = UserDefaults.standard.string(forKey: Self.preferredGroupKey)
        // Sanea: si el grupo guardado no pertenece al bucket actual lo limpia.
        if let pref = preferredCountryGroup,
           !self.current.availableCountryGroups.contains(pref) {
            UserDefaults.standard.removeObject(forKey: Self.preferredGroupKey)
            self.preferredCountryGroup = nil
        }
    }

    /// Persiste y publica la nueva preferencia. Si el grupo fino guardado
    /// ya no pertenece al nuevo bucket, se limpia automáticamente (vuelve
    /// a "Automático").
    func setRegion(_ value: RegionPreference) {
        UserDefaults.standard.set(value.rawValue, forKey: Self.defaultsKey)
        current = value
        if let pref = preferredCountryGroup,
           !value.availableCountryGroups.contains(pref) {
            UserDefaults.standard.removeObject(forKey: Self.preferredGroupKey)
            preferredCountryGroup = nil
        }
    }

    /// Setea el país preferido dentro del bucket. `nil` = automático por TZ.
    func setPreferredCountryGroup(_ value: String?) {
        if let v = value {
            UserDefaults.standard.set(v, forKey: Self.preferredGroupKey)
        } else {
            UserDefaults.standard.removeObject(forKey: Self.preferredGroupKey)
        }
        preferredCountryGroup = value
    }

    /// Grupo fino efectivo para enviar a Supabase como `countryGroup`.
    /// Si hay override manual y sigue siendo válido para el bucket actual,
    /// se usa; si no, cae al detectado por TZ.
    func effectiveCountryGroup() -> String? {
        if let pref = preferredCountryGroup,
           current.availableCountryGroups.contains(pref) {
            return pref
        }
        return Self.detectedCountryGroup()
    }

    // MARK: - Detección por TZ

    /// Zonas horarias que cubren España (Madrid, Canarias, Ceuta).
    private static let spainTimeZones: Set<String> = [
        "Europe/Madrid", "Atlantic/Canary", "Africa/Ceuta",
    ]

    /// Zonas horarias europeas que no empiezan por `Europe/` ni `Africa/Ceuta`
    /// (Atlántico Norte y oeste). Se tratan como `.europe`.
    private static let europeExtraTimeZones: Set<String> = [
        "Atlantic/Azores", "Atlantic/Madeira", "Atlantic/Faroe",
        "Atlantic/Reykjavik", "Arctic/Longyearbyen",
    ]

    /// Devuelve la región sugerida según la TZ del dispositivo. Nunca devuelve
    /// `.all` (esa solo se elige manualmente). Si no hay match, vuelve a `.spain`
    /// para preservar el baseline gratuito.
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

    // MARK: - Grupo fino para auto_dispatch `tv_start`

    /// Mapa TZ → grupo `broadcasts.country` fino (paridad con `_COUNTRY_TZ_MAP`
    /// de `js/shared.js`). Solo cubre Europa fina; el resto se calcula por
    /// prefijo en [detectedCountryGroup].
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

    /// Grupo fino `broadcasts.country` para la TZ del device (o NIL si no
    /// hay match: TZ rara, indeterminada, o Europa no cubierta por un grupo
    /// fino — en cuyo caso el cron usa el bucket por `region`).
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
}
