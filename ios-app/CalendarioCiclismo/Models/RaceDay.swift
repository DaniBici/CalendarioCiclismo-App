import Foundation

/// Etapa o jornada de una carrera (tabla `race_days` en Supabase).
struct RaceDay: Codable, Identifiable, Hashable {
    let id: String
    let raceId: String?
    let dateKey: String        // YYYY-MM-DD
    let slug: String?
    let isRestDay: Bool
    let isCancelledDay: Bool
    let stageNumber: Int?
    let startLocation: String?
    let finishLocation: String?
    let distanceKm: Double?
    let primaryType: String?
    let secondaryType: String?
    let neutralStartTimeUtc: String?
    let realStartTimeUtc: String?
    let estimatedFinishTimeUtc: String?
    let tvStatus: String?
    let description: String?
    let bonuses: String?
    let notes: String?
    let startLocationEn: String?
    let finishLocationEn: String?
    /// Traducciones EN guardadas en JSONB `translations` (migración 027). Estructura:
    /// `translations.en.{description,bonuses,notes}.value`. Las columnas top-level
    /// `descriptionEn`/`bonusesEn`/`notesEn` NO existen en la DB; la única fuente de
    /// verdad para esos campos en inglés es este JSONB (igual que en la web).
    let translations: RaceDayTranslations?
    let editorialStatus: String
    let hasAssets: Bool
    let updatedAt: String?
    /// Override puramente cosmético del país de la jornada (ISO-2). Si está
    /// presente reemplaza la bandera mostrada al usuario; nunca se usa en
    /// filtros de país (esos siguen mirando `Race.countryCode`).
    let countryCode: String?
    let elevationProfile: ElevationProfile?
    let profileSummits: [ProfileSummit]?
    let profileWaypoints: [ProfileWaypoint]?
    let profileNotViewable: Bool
    /// URL del GPX crudo del recorrido para el mapa interactivo (bucket público
    /// `route-gpx` de Supabase Storage; migración 105/106). NULL = la etapa no
    /// tiene mapa. La traza se parsea en cliente (`RouteMapLogic.parseGpx`); los
    /// marcadores de `profileSummits`/`profileWaypoints` se proyectan por km
    /// sobre ella. Independiente de `elevationProfile` (puede haber uno sin el otro).
    let routeGpxUrl: String?
    /// Estado confirmado por el contrato editorial. `finished` habilita la
    /// espera de resultados, pero nunca convierte una clasificación en oficial.
    let raceStatus: String?
    /// Métricas persistidas por el backend. Los clientes no recalculan estos
    /// valores a partir de resultados ni de reglamentos.
    let competitiveDistanceKm: Double?
    let timingPolicy: String
    let raceTimeSeconds: Double?
    let averageSpeedKmh: Double?
    let timeLimitSeconds: Double?
    let timeLimitBasis: TimeLimitBasis?
    let metricsUpdatedAt: String?

    /// Sufijo de doble sector ("A", "B", …). No viene de la DB, se asigna por lógica de app.
    var stageSuffix: String?

    private enum CodingKeys: String, CodingKey {
        case id, raceId, dateKey, slug, isRestDay, isCancelledDay
        case stageNumber, startLocation, finishLocation, distanceKm
        case primaryType, secondaryType, neutralStartTimeUtc, realStartTimeUtc, estimatedFinishTimeUtc
        case tvStatus, description, bonuses, notes
        case startLocationEn, finishLocationEn, translations
        case editorialStatus, hasAssets, updatedAt
        case countryCode, stageSuffix
        case elevationProfile, profileSummits, profileWaypoints, profileNotViewable
        case routeGpxUrl, raceStatus, competitiveDistanceKm, timingPolicy
        case raceTimeSeconds, averageSpeedKmh, timeLimitSeconds, timeLimitBasis, metricsUpdatedAt
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        raceId = try c.decodeIfPresent(String.self, forKey: .raceId)
        dateKey = try c.decode(String.self, forKey: .dateKey)
        slug = try c.decodeIfPresent(String.self, forKey: .slug)
        isRestDay = try c.decode(Bool.self, forKey: .isRestDay)
        isCancelledDay = try c.decode(Bool.self, forKey: .isCancelledDay)
        stageNumber = try c.decodeIfPresent(Int.self, forKey: .stageNumber)
        startLocation = try c.decodeIfPresent(String.self, forKey: .startLocation)
        finishLocation = try c.decodeIfPresent(String.self, forKey: .finishLocation)
        distanceKm = try c.decodeIfPresent(Double.self, forKey: .distanceKm)
        primaryType = try c.decodeIfPresent(String.self, forKey: .primaryType)
        secondaryType = try c.decodeIfPresent(String.self, forKey: .secondaryType)
        neutralStartTimeUtc = try c.decodeIfPresent(String.self, forKey: .neutralStartTimeUtc)
        realStartTimeUtc = try c.decodeIfPresent(String.self, forKey: .realStartTimeUtc)
        estimatedFinishTimeUtc = try c.decodeIfPresent(String.self, forKey: .estimatedFinishTimeUtc)
        tvStatus = try c.decodeIfPresent(String.self, forKey: .tvStatus)
        description = try c.decodeIfPresent(String.self, forKey: .description)
        bonuses = try c.decodeIfPresent(String.self, forKey: .bonuses)
        notes = try c.decodeIfPresent(String.self, forKey: .notes)
        startLocationEn = try c.decodeIfPresent(String.self, forKey: .startLocationEn)
        finishLocationEn = try c.decodeIfPresent(String.self, forKey: .finishLocationEn)
        translations = try c.decodeIfPresent(RaceDayTranslations.self, forKey: .translations)
        editorialStatus = try c.decode(String.self, forKey: .editorialStatus)
        hasAssets = try c.decode(Bool.self, forKey: .hasAssets)
        updatedAt = try c.decodeIfPresent(String.self, forKey: .updatedAt)
        countryCode = try c.decodeIfPresent(String.self, forKey: .countryCode)
        stageSuffix = try c.decodeIfPresent(String.self, forKey: .stageSuffix)
        elevationProfile = try c.decodeIfPresent(ElevationProfile.self, forKey: .elevationProfile)
        profileSummits = try c.decodeIfPresent([ProfileSummit].self, forKey: .profileSummits)
        profileWaypoints = try c.decodeIfPresent([ProfileWaypoint].self, forKey: .profileWaypoints)
        profileNotViewable = try c.decodeIfPresent(Bool.self, forKey: .profileNotViewable) ?? false
        routeGpxUrl = try c.decodeIfPresent(String.self, forKey: .routeGpxUrl)
        raceStatus = try c.decodeIfPresent(String.self, forKey: .raceStatus)
        competitiveDistanceKm = try c.decodeIfPresent(Double.self, forKey: .competitiveDistanceKm)
        timingPolicy = try c.decodeIfPresent(String.self, forKey: .timingPolicy) ?? "standard"
        raceTimeSeconds = try c.decodeIfPresent(Double.self, forKey: .raceTimeSeconds)
        averageSpeedKmh = try c.decodeIfPresent(Double.self, forKey: .averageSpeedKmh)
        timeLimitSeconds = try c.decodeIfPresent(Double.self, forKey: .timeLimitSeconds)
        timeLimitBasis = try c.decodeIfPresent(TimeLimitBasis.self, forKey: .timeLimitBasis)
        metricsUpdatedAt = try c.decodeIfPresent(String.self, forKey: .metricsUpdatedAt)
    }

    func hash(into hasher: inout Hasher) {
        hasher.combine(id)
    }

    static func == (lhs: RaceDay, rhs: RaceDay) -> Bool {
        lhs.id == rhs.id
    }

    // MARK: - Computed

    var hasElevationProfile: Bool {
        guard let ep = elevationProfile else { return false }
        return !profileNotViewable && ep.points.count >= 2
    }

    /// Etiqueta de etapa: "Prólogo"/"Prologue", "Etapa 3"/"Stage 3", "Etapa 1A", etc.
    var stageLabel: String {
        guard let n = stageNumber else { return "" }
        let base = n == 0
            ? LocaleService.t("Prólogo", "Prologue")
            : "\(LocaleService.t("Etapa", "Stage")) \(n)"
        guard let suffix = stageSuffix else { return base }
        return n == 0 ? "\(base) \(suffix)" : "\(base)\(suffix)"
    }

    /// Etiqueta corta: "Pról"/"Prol", "E3"/"S3", "E1A"/"S1A", etc.
    var stageLabelShort: String {
        guard let n = stageNumber else { return "" }
        let prefix = n == 0 ? LocaleService.t("Pról", "Prol") : "\(LocaleService.t("E", "S"))\(n)"
        return "\(prefix)\(stageSuffix ?? "")"
    }

    var localizedDescription: String? {
        if LocaleService.isEnglish, let en = translations?.en?.description?.value, !en.isEmpty { return en }
        return description
    }

    var localizedBonuses: String? {
        if LocaleService.isEnglish, let en = translations?.en?.bonuses?.value, !en.isEmpty { return en }
        return bonuses
    }

    var localizedNotes: String? {
        if LocaleService.isEnglish, let en = translations?.en?.notes?.value, !en.isEmpty { return en }
        return notes
    }

    /// `true` cuando la descripción EN proviene de traducción automática (status `auto`/`stale`)
    /// y el usuario actual está viendo la app en inglés. Se usa para mostrar el aviso
    /// "AI translated from Spanish, might contain errors" igual que en la web.
    var isDescriptionAutoTranslated: Bool {
        guard LocaleService.isEnglish, let st = translations?.en?.description?.status else { return false }
        return st != "manual"
    }

    /// Recorrido localizado: "Ciudad A > Ciudad B".
    var routeDescription: String? {
        let start = LocaleService.isEnglish
            ? (startLocationEn?.isEmpty == false ? startLocationEn : startLocation)
            : startLocation
        let finish = LocaleService.isEnglish
            ? (finishLocationEn?.isEmpty == false ? finishLocationEn : finishLocation)
            : finishLocation
        let s = (start?.isEmpty == false) ? start : nil
        let f = (finish?.isEmpty == false) ? finish : nil
        if let s, let f { return s == f ? s : "\(s) > \(f)" }
        if let s { return s }
        if let f { return f }
        return nil
    }

    /// True cuando solo hay ciudad de salida (se interpreta como salida y meta).
    var isSingleCity: Bool {
        let start = LocaleService.isEnglish
            ? (startLocationEn?.isEmpty == false ? startLocationEn : startLocation)
            : startLocation
        let finish = LocaleService.isEnglish
            ? (finishLocationEn?.isEmpty == false ? finishLocationEn : finishLocation)
            : finishLocation
        let s = (start?.isEmpty == false) ? start : nil
        let f = (finish?.isEmpty == false) ? finish : nil
        if let s, !s.isEmpty { return f == nil || f == s }
        return false
    }

    /// Sede a efectos del campeonato: la META si existe (más representativa de
    /// la ciudad sede), si no la SALIDA. Localizada (EN con respaldo a ES).
    var championshipVenue: String? {
        let finish = LocaleService.isEnglish
            ? (finishLocationEn?.isEmpty == false ? finishLocationEn : finishLocation)
            : finishLocation
        if let f = finish, !f.isEmpty { return f }
        let start = LocaleService.isEnglish
            ? (startLocationEn?.isEmpty == false ? startLocationEn : startLocation)
            : startLocation
        if let s = start, !s.isEmpty { return s }
        return nil
    }

    /// Init para crear placeholders (datos de elev. a nil por defecto).
    init(
        id: String, raceId: String?, dateKey: String, slug: String?,
        isRestDay: Bool, isCancelledDay: Bool, stageNumber: Int?,
        startLocation: String?, finishLocation: String?,
        distanceKm: Double?, primaryType: String?, secondaryType: String?,
        neutralStartTimeUtc: String?, realStartTimeUtc: String? = nil, estimatedFinishTimeUtc: String?,
        tvStatus: String?, description: String?,
        bonuses: String?,
        notes: String?, startLocationEn: String? = nil, finishLocationEn: String? = nil,
        translations: RaceDayTranslations? = nil,
        editorialStatus: String, hasAssets: Bool,
        updatedAt: String?, countryCode: String?,
        elevationProfile: ElevationProfile? = nil,
        profileSummits: [ProfileSummit]? = nil,
        profileWaypoints: [ProfileWaypoint]? = nil,
        profileNotViewable: Bool = false,
        routeGpxUrl: String? = nil,
        stageSuffix: String? = nil,
        raceStatus: String? = nil,
        competitiveDistanceKm: Double? = nil,
        timingPolicy: String = "standard",
        raceTimeSeconds: Double? = nil,
        averageSpeedKmh: Double? = nil,
        timeLimitSeconds: Double? = nil,
        timeLimitBasis: TimeLimitBasis? = nil,
        metricsUpdatedAt: String? = nil
    ) {
        self.id = id
        self.raceId = raceId
        self.dateKey = dateKey
        self.slug = slug
        self.isRestDay = isRestDay
        self.isCancelledDay = isCancelledDay
        self.stageNumber = stageNumber
        self.startLocation = startLocation
        self.finishLocation = finishLocation
        self.distanceKm = distanceKm
        self.primaryType = primaryType
        self.secondaryType = secondaryType
        self.neutralStartTimeUtc = neutralStartTimeUtc
        self.realStartTimeUtc = realStartTimeUtc
        self.estimatedFinishTimeUtc = estimatedFinishTimeUtc
        self.tvStatus = tvStatus
        self.description = description
        self.bonuses = bonuses
        self.notes = notes
        self.startLocationEn = startLocationEn
        self.finishLocationEn = finishLocationEn
        self.translations = translations
        self.editorialStatus = editorialStatus
        self.hasAssets = hasAssets
        self.updatedAt = updatedAt
        self.countryCode = countryCode
        self.elevationProfile = elevationProfile
        self.profileSummits = profileSummits
        self.profileWaypoints = profileWaypoints
        self.profileNotViewable = profileNotViewable
        self.routeGpxUrl = routeGpxUrl
        self.stageSuffix = stageSuffix
        self.raceStatus = raceStatus
        self.competitiveDistanceKm = competitiveDistanceKm
        self.timingPolicy = timingPolicy
        self.raceTimeSeconds = raceTimeSeconds
        self.averageSpeedKmh = averageSpeedKmh
        self.timeLimitSeconds = timeLimitSeconds
        self.timeLimitBasis = timeLimitBasis
        self.metricsUpdatedAt = metricsUpdatedAt
    }

    /// Distancia formateada: "174,5 km" (ES) / "174.5 km" (EN). El separador
    /// decimal sigue el IDIOMA DE CONTENIDO (no el locale del dispositivo ni el
    /// chrome de la UI), igual que la web (toLocaleString es-ES/en-GB) y que
    /// Android (`RaceDay.distanceFormatted`).
    var distanceFormatted: String? {
        guard let km = distanceKm else { return nil }
        let formatted: String
        if km.truncatingRemainder(dividingBy: 1) == 0 {
            formatted = String(format: "%.0f", km)
        } else {
            let raw = String(format: "%.1f", locale: Locale(identifier: "en_US_POSIX"), km)   // siempre con '.'
            formatted = LocaleService.shouldShowEnglishContent ? raw : raw.replacingOccurrences(of: ".", with: ",")
        }
        return "\(formatted) km"
    }

    /// Desnivel positivo formateado: "+2.500 m" (ES) / "+2,500 m" (EN), redondeado a la decena.
    /// El separador de miles sigue el IDIOMA DE CONTENIDO (no el locale del
    /// dispositivo ni el chrome de la UI), igual que el kilometraje de arriba:
    /// un dispositivo en inglés con la app en ES debe ver el punto del contenido.
    var elevationGainFormatted: String? {
        guard let gain = elevationProfile?.elevationGain else { return nil }
        let rounded = (gain / 10) * 10
        let sep = LocaleService.shouldShowEnglishContent ? "," : "."
        // Agrupar en miles desde la derecha ("2500" → "2.500"), como Android.
        let digits = String(rounded)
        var chunks: [String] = []
        var end = digits.endIndex
        while end > digits.startIndex {
            let start = digits.index(end, offsetBy: -3, limitedBy: digits.startIndex) ?? digits.startIndex
            chunks.insert(String(digits[start..<end]), at: 0)
            end = start
        }
        return "+\(chunks.joined(separator: sep)) m"
    }

    /// Fuera de control publicable: duración positiva y base verificable con
    /// URL HTTP(S) y fecha ISO válida. Es el mismo contrato que la web.
    var hasValidTimeLimit: Bool {
        guard let seconds = timeLimitSeconds, seconds > 0,
              let basis = timeLimitBasis,
              let url = URL(string: basis.sourceUrl),
              ["http", "https"].contains(url.scheme?.lowercased() ?? ""),
              DateFormatting.parseISO(basis.verifiedAt) != nil else { return false }
        return true
    }

    static func formatDuration(seconds: Double?) -> String? {
        guard let seconds, seconds > 0, seconds.isFinite else { return nil }
        let totalMilliseconds = Int((seconds * 1_000).rounded())
        let hours = totalMilliseconds / 3_600_000
        let minutes = (totalMilliseconds % 3_600_000) / 60_000
        let wholeSeconds = (totalMilliseconds % 60_000) / 1_000
        let millis = totalMilliseconds % 1_000
        let suffix = millis == 0 ? "" : String(format: ".%03d", millis).replacingOccurrences(of: "0+$", with: "", options: .regularExpression)
        return String(format: "%d:%02d:%02d", hours, minutes, wholeSeconds) + suffix
    }
}

// MARK: - Elevation payload (lazy fetch)

/// Payload mínimo de elevación para carga diferida en `loadDayComplete`.
/// Solo contiene `id` + los 4 campos JSONB pesados.
struct RaceDayElevationData: Codable {
    let id: String
    let elevationProfile: ElevationProfile?
    let profileSummits: [ProfileSummit]?
    let profileWaypoints: [ProfileWaypoint]?
    let profileNotViewable: Bool?
}

extension RaceDay {
    /// Devuelve una copia con los datos de elevación reemplazados por los del payload.
    func applying(elevation: RaceDayElevationData) -> RaceDay {
        RaceDay(
            id: id, raceId: raceId, dateKey: dateKey, slug: slug,
            isRestDay: isRestDay, isCancelledDay: isCancelledDay, stageNumber: stageNumber,
            startLocation: startLocation, finishLocation: finishLocation,
            distanceKm: distanceKm, primaryType: primaryType, secondaryType: secondaryType,
            neutralStartTimeUtc: neutralStartTimeUtc, realStartTimeUtc: realStartTimeUtc, estimatedFinishTimeUtc: estimatedFinishTimeUtc,
            tvStatus: tvStatus, description: description,
            bonuses: bonuses, notes: notes,
            startLocationEn: startLocationEn, finishLocationEn: finishLocationEn,
            translations: translations,
            editorialStatus: editorialStatus, hasAssets: hasAssets,
            updatedAt: updatedAt, countryCode: countryCode,
            elevationProfile: elevation.elevationProfile,
            profileSummits: elevation.profileSummits,
            profileWaypoints: elevation.profileWaypoints,
            profileNotViewable: elevation.profileNotViewable ?? false,
            routeGpxUrl: routeGpxUrl,
            stageSuffix: stageSuffix,
            raceStatus: raceStatus,
            competitiveDistanceKm: competitiveDistanceKm,
            timingPolicy: timingPolicy,
            raceTimeSeconds: raceTimeSeconds,
            averageSpeedKmh: averageSpeedKmh,
            timeLimitSeconds: timeLimitSeconds,
            timeLimitBasis: timeLimitBasis,
            metricsUpdatedAt: metricsUpdatedAt
        )
    }
}

struct TimeLimitBasis: Codable, Hashable {
    let sourceUrl: String
    let verifiedAt: String
}

// MARK: - Translations JSONB

/// Espejo del JSONB `race_days.translations` (migración 027). En la app solo
/// consumimos el sub-objeto `en`. Cada campo tiene `value` (texto traducido)
/// y `status` (`manual`, `auto`, `stale`, `pending`).
struct RaceDayTranslations: Codable, Hashable {
    let en: RaceDayTranslationFields?
}

struct RaceDayTranslationFields: Codable, Hashable {
    let description: RaceDayTranslationEntry?
    let bonuses: RaceDayTranslationEntry?
    let notes: RaceDayTranslationEntry?
}

struct RaceDayTranslationEntry: Codable, Hashable {
    let value: String?
    let status: String?
}
