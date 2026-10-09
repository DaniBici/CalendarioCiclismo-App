import Foundation
import Supabase

private struct FeaturedDatesParams: Encodable {
    let date_keys: [String]
}

/// Servicio centralizado para acceso a datos de Supabase.
/// Equivalente a `js/services/api.js`.
@MainActor
final class SupabaseService {
    static let shared = SupabaseService()

    let client: SupabaseClient

    /// Error de configuración si las variables de entorno no están definidas.
    /// Cuando no es nil, la UI debe mostrar un mensaje de error en lugar del contenido.
    private(set) var configurationError: String?

    private init() {
        guard let infoPlist = Bundle.main.infoDictionary,
              let urlString = infoPlist["SUPABASE_URL"] as? String,
              let url = URL(string: urlString),
              let key = infoPlist["SUPABASE_ANON_KEY"] as? String else {
            configurationError = "SUPABASE_URL y SUPABASE_ANON_KEY deben estar configurados en Info.plist vía xcconfig"
            // Cliente placeholder — nunca se usará porque la UI mostrará el error
            client = SupabaseClient(supabaseURL: URL(string: "https://placeholder.invalid")!, supabaseKey: "placeholder")
            return
        }
        client = SupabaseClient(
            supabaseURL: url,
            supabaseKey: key,
            options: .init(
                auth: .init(emitLocalSessionAsInitialSession: true),
                global: .init(session: Self.makeDataSession())
            )
        )
    }

    /// Los datos offline se gestionan en CacheManager; una consulta debe llegar a la red.
    private static func makeDataSession() -> URLSession {
        let configuration = URLSessionConfiguration.default
        configuration.urlCache = nil
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        return URLSession(configuration: configuration)
    }

    // MARK: - Peticiones compartidas

    /// Petición en vuelo o recién resuelta, compartida por clave.
    private struct SharedRequest {
        let id: UUID
        let task: Task<any Sendable, Error>
        var expiresAt: Date?
    }

    private var sharedRequests: [String: SharedRequest] = [:]

    /// Comparte una petición idéntica entre llamadores simultáneos (p. ej. la
    /// precarga del arranque y la primera carga de Hoy) y reutiliza la
    /// respuesta durante `reuseWindow` segundos. `forceNetwork` ignora la
    /// respuesta reutilizable y lanza una petición nueva (pull-to-refresh).
    func sharedRequest<T: Sendable>(
        _ key: String,
        reuseWindow: TimeInterval = 10,
        forceNetwork: Bool = false,
        _ operation: @escaping @MainActor @Sendable () async throws -> T
    ) async throws -> T {
        let now = Date()
        sharedRequests = sharedRequests.filter { $0.value.expiresAt.map { $0 > now } ?? true }
        if !forceNetwork, let entry = sharedRequests[key],
           let value = try await entry.task.value as? T {
            // La tarea compartida no se cancela con un llamador; quien se
            // canceló recibe la cancelación al terminar, como antes.
            try Task.checkCancellation()
            return value
        }
        let id = UUID()
        let task = Task<any Sendable, Error> { try await operation() }
        sharedRequests[key] = SharedRequest(id: id, task: task, expiresAt: nil)
        do {
            let value = try await task.value
            if sharedRequests[key]?.id == id {
                sharedRequests[key]?.expiresAt = Date().addingTimeInterval(reuseWindow)
            }
            guard let typed = value as? T else { throw CancellationError() }
            try Task.checkCancellation()
            return typed
        } catch {
            if sharedRequests[key]?.id == id { sharedRequests[key] = nil }
            throw error
        }
    }

    // MARK: - Races

    /// Columnas de `races` que decodifica `Race`. Evita traer traducciones,
    /// metadatos de importación y otros campos que la app no lee.
    static let raceColumns =
        "id,name,nameEn,uciCategory,gender,raceFormat,countryCode,colorHex,logoUrl,websiteUrl," +
        "hideFlag,isGrandTour,isCancelled,startDate,endDate,year,slug,originalName," +
        "startlistImportedAt,startlistProvisional"

    /// Todas las carreras de un año. Pagina en bloques de 1.000 (2026 supera
    /// las 1.200 carreras) para no depender del tope de filas por respuesta de
    /// PostgREST, ordenando por `id` para que las páginas sean estables. Las llamadas simultáneas o
    /// muy seguidas comparten la misma descarga.
    func racesByYear(_ year: Int, forceNetwork: Bool = false) async throws -> [Race] {
        try await sharedRequest("racesByYear:\(year)", forceNetwork: forceNetwork) {
            try await self.pagedRaces { $0.eq("year", value: year) }
        }
    }

    /// Descarga paginada de `races` con el filtro indicado.
    private func pagedRaces(
        _ filter: (PostgrestFilterBuilder) -> PostgrestFilterBuilder
    ) async throws -> [Race] {
        var all: [Race] = []
        var offset = 0
        let chunk = 1000
        while true {
            let page: [Race] = try await filter(client.from("races").select(Self.raceColumns))
                .order("id")
                .range(from: offset, to: offset + chunk - 1)
                .execute()
                .value
            all.append(contentsOf: page)
            if page.count < chunk { break }
            offset += chunk
        }
        return all
    }

    /// Challenges de un año (agrupaciones de carreras de un día).
    func challengeGroups(year: Int) async throws -> [ChallengeGroup] {
        try await client.from("challenge_groups")
            .select("id,name,gender,year,uciCategory,countryCode,colorHex,logoUrl,raceIds")
            .eq("year", value: year)
            .execute()
            .value
    }

    /// Una carrera por ID.
    func race(byId id: String) async throws -> Race {
        try await client.from("races")
            .select(Self.raceColumns)
            .eq("id", value: id)
            .single()
            .execute()
            .value
    }

    /// Una carrera por slug.
    func race(bySlug slug: String) async throws -> Race {
        try await client.from("races")
            .select(Self.raceColumns)
            .eq("slug", value: slug)
            .single()
            .execute()
            .value
    }

    /// Carreras por IDs (batch).
    func races(byIds ids: [String]) async throws -> [Race] {
        try await inChunks(ids) { chunk in
            try await self.client.from("races")
                .select(Self.raceColumns)
                .in("id", values: chunk)
                .execute()
                .value
        }
    }

    /// Carreras cuyo intervalo se solapa con el rango solicitado. La vista de
    /// Mes usa este filtro para no descargar todas las ediciones del año.
    func racesOverlapping(from startKey: String, to endKey: String) async throws -> [Race] {
        try await pagedRaces {
            $0.lte("startDate", value: endKey)
                .gte("endDate", value: startKey)
        }
    }

    /// Jornadas y carreras necesarias para un mes. Además del solapamiento de
    /// fechas recupera por ID cualquier padre referenciado por una jornada.
    func calendarMonthData(from startKey: String, to endKey: String) async throws -> (raceDays: [RaceDay], races: [Race]) {
        async let daysResult = raceDays(from: startKey, to: endKey)
        async let racesResult = racesOverlapping(from: startKey, to: endKey)
        let (days, overlappingRaces) = try await (daysResult, racesResult)

        let missingIds = RaceLogic.missingRaceIds(raceDays: days, races: overlappingRaces)
        let recovered = try await races(byIds: missingIds)
        var byId = Dictionary(uniqueKeysWithValues: overlappingRaces.map { ($0.id, $0) })
        recovered.forEach { byId[$0.id] = $0 }
        return (days, Array(byId.values))
    }

    /// Carreras de Campeonatos Nacionales (uciCategory='CN') de un año dentro de
    /// un rango de fechas de salida. Espejo de la query en `js/campeonatos.js`.
    func championshipRaces(year: Int, from startKey: String, to endKey: String) async throws -> [Race] {
        try await client.from("races")
            .select(Self.raceColumns)
            .eq("uciCategory", value: "CN")
            .eq("year", value: year)
            .gte("startDate", value: startKey)
            .lte("startDate", value: endKey)
            .execute()
            .value
    }

    /// Selección editorial de hasta dos carreras por fecha. La RPC concentra
    /// coronas manuales, exclusiones explícitas y fallback automático.
    func featuredRaces(for dateKeys: [String]) async throws -> [FeaturedRaceSelection] {
        let keys = Array(Set(dateKeys.filter { !$0.isEmpty })).sorted()
        guard !keys.isEmpty else { return [] }
        return try await client
            .rpc("featured_races_for_dates", params: FeaturedDatesParams(date_keys: keys))
            .execute()
            .value
    }

    // MARK: - Race Days

    /// Columnas de race_days para listas y tarjetas: sin textos editoriales ni
    /// perfil de elevación (JSONB pesados). Mes, Temporada, Campeonatos,
    /// hermanas de la Jornada, feed de resultados y cintillo.
    static let raceDayCoreColumns =
        "id,raceId,dateKey,slug,isRestDay,isCancelledDay,stageNumber," +
        "startLocation,finishLocation,startLocationEn,finishLocationEn,distanceKm,primaryType,secondaryType," +
        "neutralStartTimeUtc,realStartTimeUtc,estimatedFinishTimeUtc,tvStatus," +
        "editorialStatus,hasAssets,updatedAt,countryCode,routeGpxUrl,profileNotViewable," +
        "raceStatus,competitiveDistanceKm,timingPolicy,raceTimeSeconds,averageSpeedKmh,timeLimitSeconds,timeLimitBasis,metricsUpdatedAt"

    /// Textos editoriales de la jornada (solo los lee la ficha de Jornada).
    private static let raceDayEditorialColumns = ",description,bonuses,notes,translations"

    /// Perfil de elevación, cimas y puntos de paso.
    private static let raceDayProfileFields = ",elevationProfile,profileSummits,profileWaypoints"

    /// Núcleo + textos editoriales, sin perfil. Hoy: la caché del día alimenta
    /// también la ficha de Jornada sin red, que muestra la descripción.
    static let raceDaySlimColumns = raceDayCoreColumns + raceDayEditorialColumns

    /// Núcleo + perfil, sin textos editoriales (Carrera y Resultados).
    static let raceDayProfileColumns = raceDayCoreColumns + raceDayProfileFields

    /// Todas las columnas que decodifica `RaceDay` (ficha de Jornada).
    static let raceDayFullColumns = raceDaySlimColumns + raceDayProfileFields

    /// Núcleo + desnivel positivo extraído del JSON del perfil, sin sus puntos.
    /// `RaceDay` lo decodifica como un perfil sin puntos (feed de resultados).
    static let raceDayFeedColumns = raceDayCoreColumns + ",elevationGain:elevationProfile->elevationGain"

    /// Jornadas publicadas para una fecha concreta (sin perfil de elevación).
    func raceDays(byDate dateKey: String) async throws -> [RaceDay] {
        try await client.from("race_days")
            .select(SupabaseService.raceDaySlimColumns)
            .eq("dateKey", value: dateKey)
            .eq("editorialStatus", value: "published")
            .execute()
            .value
    }

    /// Perfil de elevación de las jornadas publicadas de una fecha. No depende
    /// de la consulta de jornadas, así que `loadDayComplete` lo lanza a la vez.
    private func raceDaysElevation(byDate dateKey: String) async throws -> [RaceDayElevationData] {
        try await client.from("race_days")
            .select("id,elevationProfile,profileSummits,profileWaypoints,profileNotViewable")
            .eq("dateKey", value: dateKey)
            .eq("editorialStatus", value: "published")
            .execute()
            .value
    }

    /// Jornadas por ID. Por defecto con todas las columnas que decodifica
    /// `RaceDay`; los llamadores que solo pintan una fila piden `raceDayCoreColumns`.
    func raceDays(byIds ids: [String], columns: String = SupabaseService.raceDayFullColumns) async throws -> [RaceDay] {
        guard !ids.isEmpty else { return [] }
        return try await client.from("race_days")
            .select(columns)
            .in("id", values: ids)
            .execute()
            .value
    }

    func raceDaysElevation(byIds ids: [String]) async throws -> [RaceDayElevationData] {
        guard !ids.isEmpty else { return [] }
        return try await client.from("race_days")
            .select("id,elevationProfile,profileSummits,profileWaypoints,profileNotViewable")
            .in("id", values: ids)
            .execute()
            .value
    }

    /// Jornadas publicadas de una carrera. Las columnas por defecto omiten los
    /// textos editoriales; las hermanas de la Jornada piden `raceDayCoreColumns`.
    func raceDays(byRaceId raceId: String, columns: String = SupabaseService.raceDayProfileColumns) async throws -> [RaceDay] {
        try await client.from("race_days")
            .select(columns)
            .eq("raceId", value: raceId)
            .eq("editorialStatus", value: "published")
            .execute()
            .value
    }

    /// Fila mínima de jornada (solo el identificador y la fecha).
    private struct RaceDayIdRow: Codable {
        let id: String
        let dateKey: String
    }

    /// IDs de las jornadas publicadas de una carrera, por fecha. Temporada solo
    /// necesita saber si existen y cuál es la primera.
    func raceDayIds(byRaceId raceId: String) async throws -> [String] {
        let rows: [RaceDayIdRow] = try await client.from("race_days")
            .select("id,dateKey")
            .eq("raceId", value: raceId)
            .eq("editorialStatus", value: "published")
            .order("dateKey")
            .execute()
            .value
        return rows.map(\.id)
    }

    /// Jornadas publicadas de un conjunto de carreras (batch, columnas de
    /// lista). Usado por el Modo Campeonatos y por el programa del feed de
    /// resultados. Pagina por `id` para no depender del tope de filas por
    /// respuesta de PostgREST.
    func raceDays(byRaceIds ids: [String], columns: String = SupabaseService.raceDayCoreColumns) async throws -> [RaceDay] {
        guard !ids.isEmpty else { return [] }
        var all: [RaceDay] = []
        var offset = 0
        let chunk = 1000
        while true {
            let page: [RaceDay] = try await client.from("race_days")
                .select(columns)
                .in("raceId", values: ids)
                .eq("editorialStatus", value: "published")
                .order("id")
                .range(from: offset, to: offset + chunk - 1)
                .execute()
                .value
            all.append(contentsOf: page)
            if page.count < chunk { break }
            offset += chunk
        }
        return all
    }

    /// Jornadas publicadas en un rango de fechas (columnas de lista, sin perfil
    /// ni textos editoriales: Mes y feed no los muestran).
    /// Pagina manualmente en bloques de 1.000: PostgREST aplica un tope
    /// server-side de filas por respuesta que un `.limit()` más alto NO
    /// evita. Sin paginar, un consumidor que superase ese tope se truncaría
    /// en silencio y la parte recortada no tendría por qué coincidir con el
    /// final cronológico del rango.
    /// Se pagina por `id` (clave única) para que el orden entre páginas sea
    /// estable — paginar por `dateKey` (no único) puede saltar o duplicar
    /// filas en el borde de cada página.
    func raceDays(from startKey: String, to endKey: String, columns: String = SupabaseService.raceDayCoreColumns) async throws -> [RaceDay] {
        var all: [RaceDay] = []
        var offset = 0
        let chunk = 1000
        while true {
            let page: [RaceDay] = try await client.from("race_days")
                .select(columns)
                .eq("editorialStatus", value: "published")
                .gte("dateKey", value: startKey)
                .lte("dateKey", value: endKey)
                .order("id")
                .range(from: offset, to: offset + chunk - 1)
                .execute()
                .value
            all.append(contentsOf: page)
            if page.count < chunk { break }
            offset += chunk
        }
        return all
    }

    /// Una jornada por ID con todas las columnas que decodifica `RaceDay`.
    func raceDay(byId id: String) async throws -> RaceDay {
        try await client.from("race_days")
            .select(SupabaseService.raceDayFullColumns)
            .eq("id", value: id)
            .single()
            .execute()
            .value
    }

    /// Una jornada por slug.
    func raceDay(bySlug slug: String) async throws -> RaceDay {
        try await client.from("race_days")
            .select(SupabaseService.raceDayFullColumns)
            .eq("slug", value: slug)
            .single()
            .execute()
            .value
    }

    // MARK: - Broadcasts

    /// Emisiones de una jornada.
    func broadcasts(byRaceDayId id: String) async throws -> [Broadcast] {
        try await client.from("broadcasts")
            .select()
            .eq("raceDayId", value: id)
            .order("sortOrder", ascending: true)
            .execute()
            .value
    }

    /// Emisiones de múltiples jornadas (batch).
    func broadcasts(byRaceDayIds ids: [String]) async throws -> [Broadcast] {
        guard !ids.isEmpty else { return [] }
        return try await client.from("broadcasts")
            .select()
            .in("raceDayId", values: ids)
            .order("sortOrder", ascending: true)
            .execute()
            .value
    }

    /// Emisiones de las jornadas publicadas de una fecha. Filtra por la
    /// relación con `race_days` para no esperar a la lista de jornadas.
    func broadcasts(byPublishedDate dateKey: String) async throws -> [Broadcast] {
        try await client.from("broadcasts")
            .select("*,race_days!inner(dateKey)")
            .eq("race_days.dateKey", value: dateKey)
            .eq("race_days.editorialStatus", value: "published")
            .order("sortOrder", ascending: true)
            .execute()
            .value
    }

    /// Emisiones de las jornadas publicadas de una carrera.
    func broadcasts(byPublishedRaceId raceId: String) async throws -> [Broadcast] {
        try await client.from("broadcasts")
            .select("*,race_days!inner(raceId)")
            .eq("race_days.raceId", value: raceId)
            .eq("race_days.editorialStatus", value: "published")
            .order("sortOrder", ascending: true)
            .execute()
            .value
    }

    // MARK: - Assets

    /// Assets de una jornada.
    func assets(byRaceDayId id: String) async throws -> [Asset] {
        try await client.from("assets")
            .select()
            .eq("raceDayId", value: id)
            .execute()
            .value
    }

    /// Assets de múltiples jornadas (batch, campos esenciales).
    func assets(byRaceDayIds ids: [String]) async throws -> [Asset] {
        guard !ids.isEmpty else { return [] }
        return try await client.from("assets")
            .select("id,raceDayId,type,url")
            .in("raceDayId", values: ids)
            .execute()
            .value
    }

    /// Assets de las jornadas publicadas de una fecha (campos esenciales).
    func assets(byPublishedDate dateKey: String) async throws -> [Asset] {
        try await client.from("assets")
            .select("id,raceDayId,type,url,race_days!inner(dateKey)")
            .eq("race_days.dateKey", value: dateKey)
            .eq("race_days.editorialStatus", value: "published")
            .execute()
            .value
    }

    /// Assets de las jornadas publicadas de una carrera (campos esenciales).
    func assets(byPublishedRaceId raceId: String) async throws -> [Asset] {
        try await client.from("assets")
            .select("id,raceDayId,type,url,race_days!inner(raceId)")
            .eq("race_days.raceId", value: raceId)
            .eq("race_days.editorialStatus", value: "published")
            .execute()
            .value
    }

    /// Carreras con alguna jornada publicada en una fecha.
    private func races(withPublishedDayOn dateKey: String) async throws -> [Race] {
        try await client.from("races")
            .select(Self.raceColumns + ",race_days!inner(id)")
            .eq("race_days.dateKey", value: dateKey)
            .eq("race_days.editorialStatus", value: "published")
            .execute()
            .value
    }

    /// Libro de ruta único de una competición. Se resuelve mediante la relación
    /// con `race_days` para que una ficha de jornada no tenga que esperar a que
    /// termine la consulta de siblings antes de poder mostrarlo.
    func technicalGuide(byRaceId raceId: String) async throws -> Asset? {
        let guides: [Asset] = try await client.from("assets")
            .select("id,raceDayId,type,url,race_days!inner(raceId)")
            .eq("type", value: "technicalGuide")
            .eq("race_days.raceId", value: raceId)
            .limit(1)
            .execute()
            .value
        return guides.first
    }

    /// Resultado mínimo para buscar siguiente fecha.
    private struct MinimalDateRow: Codable {
        let dateKey: String
    }

    /// Siguiente fecha con jornadas publicadas después de una fecha dada.
    func nextDateWithRaces(after dateKey: String) async throws -> String? {
        let rows: [MinimalDateRow] = try await client.from("race_days")
            .select("dateKey")
            .eq("editorialStatus", value: "published")
            .gt("dateKey", value: dateKey)
            .order("dateKey")
            .limit(1)
            .execute()
            .value
        return rows.first?.dateKey
    }

    // MARK: - Push Notifications

    /// Modelo mínimo para leer filas de push_subscriptions (count, etc.).
    private struct PushSubscriptionRow: Codable {
        let deviceToken: String
        let platform: String
        let isActive: Bool
        let updatedAt: String
        let region: String
    }

    /// Parámetros de la RPC `set_push_subscription_v4`.
    /// Upsert atómico de subscripción + idioma + countryGroup + categorías +
    /// carreras seguidas + filtros de grupo + jornadas seguidas.
    struct SetPushSubscriptionV4Params: Encodable {
        let p_token: String
        let p_platform: String
        let p_is_active: Bool
        let p_region: String
        let p_country_group: String?
        let p_language: String
        let p_categories: [String]
        let p_followed_races: [String]
        let p_race_filters: [String]
        let p_followed_stages: [String]
        let p_followed_cx_races: [String]?

        enum CodingKeys: String, CodingKey {
            case p_token, p_platform, p_is_active, p_region, p_country_group, p_language
            case p_categories, p_followed_races, p_race_filters, p_followed_stages, p_followed_cx_races
        }
        func encode(to encoder: Encoder) throws {
            var values = encoder.container(keyedBy: CodingKeys.self)
            try values.encode(p_token, forKey: .p_token)
            try values.encode(p_platform, forKey: .p_platform)
            try values.encode(p_is_active, forKey: .p_is_active)
            try values.encode(p_region, forKey: .p_region)
            try values.encode(p_country_group, forKey: .p_country_group)
            try values.encode(p_language, forKey: .p_language)
            try values.encode(p_categories, forKey: .p_categories)
            try values.encode(p_followed_races, forKey: .p_followed_races)
            try values.encode(p_race_filters, forKey: .p_race_filters)
            try values.encode(p_followed_stages, forKey: .p_followed_stages)
            // JSON null preserva CX; [] elimina el seguimiento. No omitir la clave.
            try values.encode(p_followed_cx_races, forKey: .p_followed_cx_races)
        }
    }

    /// Registra o actualiza un token de dispositivo para notificaciones push.
    /// Atómico vía RPC con SECURITY DEFINER.
    ///
    /// `categories` debe incluir siempre `"general"` para preservar el baseline
    /// gratuito (regla "no degradar lo gratis").
    /// `followedRaces` y `raceFilters` vacíos → "follow-all" implícito (recibe todas).
    /// `countryGroup` (opcional, derivado de la TZ) afina el envío de `tv_start`
    /// al horario del primer canal visible para el grupo fino del usuario.
    /// `followedStages` siempre se envía completo (independiente del modo de carreras).
    /// `language` ('es' | 'en') determina el idioma de las notificaciones
    /// auto-generadas (race_start / tv_start / results); valores inválidos caen a 'es'.
    func upsertPushToken(
        _ token: String,
        isActive: Bool,
        region: String,
        countryGroup: String?,
        language: String,
        categories: [String],
        followedRaces: [String] = [],
        raceFilters: [String] = [],
        followedStages: [String] = [],
        followedCxRaces: [String]? = nil
    ) async throws {
        let normalizedLanguage = (language == "en") ? "en" : "es"
        let params = SetPushSubscriptionV4Params(
            p_token: token,
            p_platform: "ios",
            p_is_active: isActive,
            p_region: region,
            p_country_group: countryGroup,
            p_language: normalizedLanguage,
            p_categories: categories,
            p_followed_races: followedRaces,
            p_race_filters: raceFilters,
            p_followed_stages: followedStages,
            p_followed_cx_races: followedCxRaces
        )
        try await client
            .rpc("set_push_subscription_v4", params: params)
            .execute()
    }

    /// Número de dispositivos suscritos a notificaciones.
    func pushSubscriptionCount() async throws -> Int {
        let rows: [PushSubscriptionRow] = try await client.from("push_subscriptions")
            .select("deviceToken,platform,isActive,updatedAt,region")
            .eq("isActive", value: true)
            .execute()
            .value
        return rows.count
    }

    /// Elimina permanentemente el registro de push del dispositivo (derecho de supresión).
    /// Vía RPC SECURITY DEFINER: anon no tiene acceso directo a push_subscriptions
    /// (migración 125). Ver también set_push_subscription_v3 para el registro.
    func deletePushToken(_ token: String) async throws {
        try await client
            .rpc("delete_push_subscription", params: ["p_token": token])
            .execute()
    }

    // MARK: - Helpers compuestos

    /// Carga datos completos de un día: jornadas + carreras + emisiones +
    /// assets + elevación + destacados. Todas las consultas filtran por la
    /// fecha (las dependientes, mediante la relación con `race_days`), de modo
    /// que salen en una sola tanda en paralelo. Las llamadas simultáneas para
    /// la misma fecha (precarga del arranque y primera carga de Hoy) comparten
    /// la descarga; `forceNetwork` la repite (pull-to-refresh).
    func loadDayComplete(dateKey: String, forceNetwork: Bool = false) async throws -> DayData {
        try await sharedRequest("day:\(dateKey)", forceNetwork: forceNetwork) {
            try await self.fetchDayComplete(dateKey: dateKey)
        }
    }

    private func fetchDayComplete(dateKey: String) async throws -> DayData {
        async let daysResult = raceDays(byDate: dateKey)
        async let racesResult = races(withPublishedDayOn: dateKey)
        async let broadcastsResult = broadcasts(byPublishedDate: dateKey)
        async let assetsResult = assets(byPublishedDate: dateKey)
        async let elevResult = raceDaysElevation(byDate: dateKey)
        async let featuredResult = featuredRaces(for: [dateKey])

        var (raceDays, fetchedRaces, fetchedBroadcasts, fetchedAssets, fetchedElev, featured) = try await (
            daysResult, racesResult, broadcastsResult, assetsResult, elevResult, featuredResult
        )

        // Una jornada publicada entre consultas podría referir una carrera que
        // no llegó en la tanda: se recupera por ID.
        let missingRaceIds = RaceLogic.missingRaceIds(raceDays: raceDays, races: fetchedRaces)
        if !missingRaceIds.isEmpty {
            fetchedRaces += try await races(byIds: missingRaceIds)
        }

        let raceMap = Dictionary(fetchedRaces.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        let broadcastsByRd = Dictionary(grouping: fetchedBroadcasts, by: \.raceDayId)
        let assetsByRd = Dictionary(grouping: fetchedAssets, by: \.raceDayId)
        let elevMap = Dictionary(fetchedElev.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })

        // Aplicar datos de elevación sobre el resultado slim
        raceDays = raceDays.map { rd in elevMap[rd.id].map { rd.applying(elevation: $0) } ?? rd }

        // Detectar dobles sectores
        RaceLogic.annotateDoubleSectors(&raceDays)

        let enriched = raceDays.map { rd in
            EnrichedRaceDay(
                raceDay: rd,
                race: rd.raceId.flatMap { raceMap[$0] },
                broadcasts: broadcastsByRd[rd.id] ?? [],
                assets: assetsByRd[rd.id] ?? []
            )
        }

        return DayData(
            raceDays: enriched,
            raceMap: raceMap,
            featuredRaceIds: Set(featured.filter { $0.dateKey == dateKey }.map(\.raceId))
        )
    }

    /// Carga la rejilla del Modo Campeonatos: carreras CN del rango → primera
    /// jornada publicada de cada una + emisiones + assets → agrupadas por país y
    /// bucketizadas en slots. Espejo de `init()` en `js/campeonatos.js`.
    func loadChampionships() async throws -> [ChampionshipCountry] {
        let races = try await championshipRaces(
            year: ChampionshipsConfig.year,
            from: ChampionshipsConfig.queryStart,
            to: ChampionshipsConfig.queryEnd
        )
        guard !races.isEmpty else { return [] }

        let raceById = Dictionary(uniqueKeysWithValues: races.map { ($0.id, $0) })
        let days = try await raceDays(byRaceIds: races.map(\.id))
        guard !days.isEmpty else { return [] }

        let dayIds = days.map(\.id)
        async let broadcastsResult = broadcasts(byRaceDayIds: dayIds)
        async let assetsResult = assets(byRaceDayIds: dayIds)
        let (fetchedBroadcasts, fetchedAssets) = try await (broadcastsResult, assetsResult)

        let broadcastsByRd = Dictionary(grouping: fetchedBroadcasts, by: \.raceDayId)
        let assetsByRd = Dictionary(grouping: fetchedAssets, by: \.raceDayId)

        // Primera jornada publicada por carrera (menor dateKey).
        var firstDayByRace: [String: RaceDay] = [:]
        for rd in days {
            guard let raceId = rd.raceId else { continue }
            if let cur = firstDayByRace[raceId], cur.dateKey <= rd.dateKey { continue }
            firstDayByRace[raceId] = rd
        }

        // Agrupar por país y bucketizar en slots.
        struct Bucket { var slots: [ChampionshipsConfig.Slot: EnrichedRaceDay] = [:] }
        var byCountry: [String: Bucket] = [:]
        for race in races {
            guard let rd = firstDayByRace[race.id] else { continue }
            let cc = (race.countryCode ?? "").uppercased()
            guard !cc.isEmpty else { continue }
            let slot = ChampionshipsConfig.slot(race: race, rd: rd)
            // Broadcasts en crudo: TVBadge los filtra por región del usuario
            // (igual que loadDayComplete; no se pre-filtran aquí).
            let enriched = EnrichedRaceDay(
                raceDay: rd,
                race: raceById[race.id],
                broadcasts: broadcastsByRd[rd.id] ?? [],
                assets: assetsByRd[rd.id] ?? []
            )
            byCountry[cc, default: Bucket()].slots[slot] = enriched
        }

        // Orden: countryOrder presentes primero, luego el resto por código.
        let present = Set(byCountry.keys)
        let ordered = ChampionshipsConfig.countryOrder.filter { present.contains($0) }
            + present.subtracting(ChampionshipsConfig.countryOrder).sorted()

        return ordered.compactMap { cc -> ChampionshipCountry? in
            guard let bucket = byCountry[cc] else { return nil }
            // Sede de la prueba élite masculina de ruta (linea_masc): META si la
            // tiene (más representativa de la sede), si no la SALIDA.
            let hostCity = bucket.slots[.lineaMasc]?.raceDay.championshipVenue
            return ChampionshipCountry(countryCode: cc, hostCity: hostCity, slots: bucket.slots)
        }
    }

    /// Carga datos completos de una carrera: info + etapas + emisiones + assets,
    /// en una sola tanda (emisiones y assets filtran por la relación con
    /// `race_days`, sin esperar a la lista de jornadas).
    func loadRaceComplete(raceId: String) async throws -> (race: Race, days: [EnrichedRaceDay]) {
        async let raceResult = race(byId: raceId)
        async let daysResult = raceDays(byRaceId: raceId)
        async let broadcastsResult = broadcasts(byPublishedRaceId: raceId)
        async let assetsResult = assets(byPublishedRaceId: raceId)
        let (race, days, fetchedBroadcasts, fetchedAssets) = try await (
            raceResult, daysResult, broadcastsResult, assetsResult
        )
        return (race, Self.enrichRaceDays(days, race: race, broadcasts: fetchedBroadcasts, assets: fetchedAssets))
    }

    /// Variante para quien ya tiene la carrera (p. ej. resuelta por slug).
    func loadRaceComplete(race: Race) async throws -> (race: Race, days: [EnrichedRaceDay]) {
        async let daysResult = raceDays(byRaceId: race.id)
        async let broadcastsResult = broadcasts(byPublishedRaceId: race.id)
        async let assetsResult = assets(byPublishedRaceId: race.id)
        let (days, fetchedBroadcasts, fetchedAssets) = try await (daysResult, broadcastsResult, assetsResult)
        return (race, Self.enrichRaceDays(days, race: race, broadcasts: fetchedBroadcasts, assets: fetchedAssets))
    }

    /// Ordena las jornadas de una carrera, anota dobles sectores y les asocia
    /// emisiones y assets.
    private static func enrichRaceDays(
        _ raceDays: [RaceDay],
        race: Race,
        broadcasts: [Broadcast],
        assets: [Asset]
    ) -> [EnrichedRaceDay] {
        var days = raceDays
        days.sort { a, b in
            if let na = a.stageNumber, let nb = b.stageNumber {
                if na != nb { return na < nb }
                // Mismo stageNumber: ordenar por hora de inicio (doble sector)
                let tA = a.neutralStartTimeUtc.flatMap { DateFormatting.timestampToSeconds($0) } ?? Double.greatestFiniteMagnitude
                let tB = b.neutralStartTimeUtc.flatMap { DateFormatting.timestampToSeconds($0) } ?? Double.greatestFiniteMagnitude
                return tA < tB
            }
            return a.dateKey < b.dateKey
        }

        // Detectar dobles sectores
        RaceLogic.annotateDoubleSectors(&days)

        let broadcastsByRd = Dictionary(grouping: broadcasts, by: \.raceDayId)
        let assetsByRd = Dictionary(grouping: assets, by: \.raceDayId)

        return days.map { rd in
            EnrichedRaceDay(
                raceDay: rd,
                race: race,
                broadcasts: broadcastsByRd[rd.id] ?? [],
                assets: assetsByRd[rd.id] ?? []
            )
        }
    }
}
