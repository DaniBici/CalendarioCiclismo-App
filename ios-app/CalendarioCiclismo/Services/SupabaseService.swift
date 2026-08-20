import Foundation
import Supabase

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
                auth: .init(emitLocalSessionAsInitialSession: true)
            )
        )
    }

    // MARK: - Races

    /// Todas las carreras de un año.
    func racesByYear(_ year: Int) async throws -> [Race] {
        try await client.from("races")
            .select()
            .eq("year", value: year)
            .execute()
            .value
    }

    /// Una carrera por ID.
    func race(byId id: String) async throws -> Race {
        try await client.from("races")
            .select()
            .eq("id", value: id)
            .single()
            .execute()
            .value
    }

    /// Una carrera por slug.
    func race(bySlug slug: String) async throws -> Race {
        try await client.from("races")
            .select()
            .eq("slug", value: slug)
            .single()
            .execute()
            .value
    }

    /// Carreras por IDs (batch).
    func races(byIds ids: [String]) async throws -> [Race] {
        guard !ids.isEmpty else { return [] }
        return try await client.from("races")
            .select()
            .in("id", values: ids)
            .execute()
            .value
    }

    /// Carreras de Campeonatos Nacionales (uciCategory='CN') de un año dentro de
    /// un rango de fechas de salida. Espejo de la query en `js/campeonatos.js`.
    func championshipRaces(year: Int, from startKey: String, to endKey: String) async throws -> [Race] {
        try await client.from("races")
            .select()
            .eq("uciCategory", value: "CN")
            .eq("year", value: year)
            .gte("startDate", value: startKey)
            .lte("startDate", value: endKey)
            .execute()
            .value
    }

    // MARK: - Race Days

    /// Columnas de race_days sin los campos de perfil de elevación (JSONB pesados).
    /// Para queries masivas (Mes, Temporada, Búsqueda) donde esos datos no son necesarios.
    private static let raceDaySlimColumns =
        "id,raceId,dateKey,slug,isRestDay,isCancelledDay,stageNumber," +
        "startLocation,finishLocation,distanceKm,primaryType,secondaryType," +
        "neutralStartTimeUtc,estimatedFinishTimeUtc,tvStatus,description,bonuses,notes," +
        "startLocationEn,finishLocationEn,translations,editorialStatus,hasAssets,updatedAt,countryCode,routeGpxUrl"

    /// Jornadas publicadas para una fecha concreta (sin perfil de elevación).
    /// La elevación se carga de forma diferida en `loadDayComplete`.
    func raceDays(byDate dateKey: String) async throws -> [RaceDay] {
        try await client.from("race_days")
            .select(SupabaseService.raceDaySlimColumns)
            .eq("dateKey", value: dateKey)
            .eq("editorialStatus", value: "published")
            .execute()
            .value
    }

    /// Datos de elevación para un conjunto de jornadas (carga diferida).
    func raceDays(byIds ids: [String]) async throws -> [RaceDay] {
        guard !ids.isEmpty else { return [] }
        return try await client.from("race_days")
            .select()
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

    /// Jornadas publicadas de una carrera.
    func raceDays(byRaceId raceId: String) async throws -> [RaceDay] {
        try await client.from("race_days")
            .select()
            .eq("raceId", value: raceId)
            .eq("editorialStatus", value: "published")
            .execute()
            .value
    }

    /// Jornadas publicadas de un conjunto de carreras (batch). Usado por el Modo
    /// Campeonatos para traer las jornadas de todas las carreras CN del rango.
    func raceDays(byRaceIds ids: [String]) async throws -> [RaceDay] {
        guard !ids.isEmpty else { return [] }
        return try await client.from("race_days")
            .select()
            .in("raceId", values: ids)
            .eq("editorialStatus", value: "published")
            .execute()
            .value
    }

    /// Jornadas publicadas en un rango de fechas (sin perfil de elevación).
    /// Pagina manualmente en chunks de 1.000: PostgREST aplica un tope
    /// server-side de 1.000 filas por request que un `.limit()` más alto NO
    /// evita (mismo tope que ya documenta `panel.js` para riders_men/women).
    /// Sin esto, un rango que cubra más de 1.000 jornadas (p. ej. un año
    /// natural completo, como hace `MonthViewModel.loadYear`) se trunca en
    /// silencio y el orden de retorno no sigue la fecha, así que la parte
    /// recortada no son necesariamente "los últimos días del año": pueden
    /// faltar carreras enteras de mitad de temporada (bug real: Tour de
    /// Francia 2026 desaparecía casi entero de la vista de Mes).
    /// Se pagina por `id` (clave única) para que el orden entre páginas sea
    /// estable — paginar por `dateKey` (no único) puede saltar o duplicar
    /// filas en el borde de cada página.
    func raceDays(from startKey: String, to endKey: String) async throws -> [RaceDay] {
        var all: [RaceDay] = []
        var offset = 0
        let chunk = 1000
        while true {
            let page: [RaceDay] = try await client.from("race_days")
                .select(SupabaseService.raceDaySlimColumns)
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

    /// Una jornada por slug.
    func raceDay(bySlug slug: String) async throws -> RaceDay {
        try await client.from("race_days")
            .select()
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

    /// Parámetros de la RPC `set_push_subscription_v3`.
    /// Upsert atómico de subscripción + idioma + countryGroup + categorías +
    /// carreras seguidas + filtros de grupo + jornadas seguidas.
    private struct SetPushSubscriptionV3Params: Encodable {
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
    /// `language` ('es' | 'en') determina el idioma de las notificaciones Premium
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
        followedStages: [String] = []
    ) async throws {
        let normalizedLanguage = (language == "en") ? "en" : "es"
        let params = SetPushSubscriptionV3Params(
            p_token: token,
            p_platform: "ios",
            p_is_active: isActive,
            p_region: region,
            p_country_group: countryGroup,
            p_language: normalizedLanguage,
            p_categories: categories,
            p_followed_races: followedRaces,
            p_race_filters: raceFilters,
            p_followed_stages: followedStages
        )
        try await client
            .rpc("set_push_subscription_v3", params: params)
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

    /// Carga datos completos de un día: jornadas + carreras + emisiones + assets + elevación.
    /// La elevación se obtiene en paralelo con el resto (no bloquea la carga inicial).
    func loadDayComplete(dateKey: String) async throws -> DayData {
        var raceDays = try await raceDays(byDate: dateKey)

        let raceIds = Array(Set(raceDays.compactMap(\.raceId)))
        let rdIds = raceDays.map(\.id)

        async let racesResult = races(byIds: raceIds)
        async let broadcastsResult = broadcasts(byRaceDayIds: rdIds)
        async let assetsResult = assets(byRaceDayIds: rdIds)
        async let elevResult = raceDaysElevation(byIds: rdIds)

        let (fetchedRaces, fetchedBroadcasts, fetchedAssets, fetchedElev) = try await (
            racesResult, broadcastsResult, assetsResult, elevResult
        )

        let raceMap = Dictionary(uniqueKeysWithValues: fetchedRaces.map { ($0.id, $0) })
        let broadcastsByRd = Dictionary(grouping: fetchedBroadcasts, by: \.raceDayId)
        let assetsByRd = Dictionary(grouping: fetchedAssets, by: \.raceDayId)
        let elevMap = Dictionary(uniqueKeysWithValues: fetchedElev.map { ($0.id, $0) })

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

        return DayData(raceDays: enriched, raceMap: raceMap)
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

    /// Carga datos completos de una carrera: info + etapas + emisiones + assets.
    func loadRaceComplete(raceId: String) async throws -> (race: Race, days: [EnrichedRaceDay]) {
        let race = try await race(byId: raceId)
        var days = try await raceDays(byRaceId: raceId)

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

        let dayIds = days.map(\.id)

        async let broadcastsResult = broadcasts(byRaceDayIds: dayIds)
        async let assetsResult = assets(byRaceDayIds: dayIds)

        let (fetchedBroadcasts, fetchedAssets) = try await (broadcastsResult, assetsResult)

        let broadcastsByRd = Dictionary(grouping: fetchedBroadcasts, by: \.raceDayId)
        let assetsByRd = Dictionary(grouping: fetchedAssets, by: \.raceDayId)

        let enriched = days.map { rd in
            EnrichedRaceDay(
                raceDay: rd,
                race: race,
                broadcasts: broadcastsByRd[rd.id] ?? [],
                assets: assetsByRd[rd.id] ?? []
            )
        }

        return (race, enriched)
    }
}
