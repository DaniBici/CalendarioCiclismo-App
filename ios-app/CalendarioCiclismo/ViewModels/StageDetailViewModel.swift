import Foundation

/// ViewModel para la vista de detalle de etapa/jornada — equivalente a `js/jornada.js`.
@MainActor
@Observable
final class StageDetailViewModel {
    var raceDay: RaceDay?
    var race: Race?
    var broadcasts: [Broadcast] = []
    var assets: [Asset] = []
    var siblings: [RaceDay] = []
    var isLoading = false
    var error: String?
    /// Se incrementa tras sustituir una respuesta remota completa. La vista lo
    /// usa para reconstruir las secciones que pudieran conservar subviews
    /// asociadas al contenido anterior.
    var refreshToken = 0

    /// Derivado de `races.startlistImportedAt`. Evita un roundtrip extra a
    /// `startlist_teams`, por lo que el botón de "Inscritos" aparece sin retraso.
    var hasStartlist: Bool { race?.startlistImportedAt != nil }

    func load(raceDayId: String) async {
        isLoading = true
        error = nil

        // 1. Intentar rellenar desde la caché offline (DayData de los últimos 14 días).
        //    Esto permite que la pantalla se pinte inmediatamente sin red y que
        //    los assets R2 descargados sean accesibles aunque Supabase esté caído.
        if let cached = await Self.loadFromCache(raceDayId: raceDayId) {
            raceDay = cached.raceDay
            race = cached.race
            broadcasts = RaceLogic.filterBroadcastsByRegion(
                cached.broadcasts,
                allowedGroups: RegionService.shared.current.allowedBroadcastGroups,
            )
            assets = cached.assets
            // Pre-cargar siblings desde caché de carrera para evitar el flash al pintar
            var cachedSiblingsReady = false
            if let raceId = cached.raceDay.raceId,
               var cachedSiblings = await CacheManager.shared.load([RaceDay].self, forKey: CacheManager.siblingsKey(raceId)) {
                RaceLogic.annotateDoubleSectors(&cachedSiblings)
                siblings = cachedSiblings
                cachedSiblingsReady = true
            }
            // Solo pintar desde caché si ya tenemos siblings — primera visita espera la red
            if cachedSiblingsReady { isLoading = false }
        }

        do {
            let service = SupabaseService.shared
            var rd = try await service.client.from("race_days")
                .select()
                .eq("id", value: raceDayId)
                .single()
                .execute()
                .value as RaceDay

            // Cargar carrera, broadcasts y assets en paralelo
            if let raceId = rd.raceId {
                let rdId = rd.id
                async let raceResult = service.race(byId: raceId)
                async let broadcastsResult = service.broadcasts(byRaceDayId: rdId)
                async let assetsResult = service.assets(byRaceDayId: rdId)
                // Cargar siblings para detectar doble sector
                async let siblingsResult = service.raceDays(byRaceId: raceId)

                let (r, b, a, siblings) = try await (raceResult, broadcastsResult, assetsResult, siblingsResult)
                race = r

                // Detectar doble sector desde siblings
                var allDays = siblings
                RaceLogic.annotateDoubleSectors(&allDays)
                if let match = allDays.first(where: { $0.id == rd.id }), match.stageSuffix != nil {
                    rd.stageSuffix = match.stageSuffix
                }

                broadcasts = RaceLogic.filterBroadcastsByRegion(
                    b,
                    allowedGroups: RegionService.shared.current.allowedBroadcastGroups,
                )
                assets = a
                self.siblings = allDays
                // Guardar siblings para cargas futuras sin flash
                await CacheManager.shared.save(allDays, forKey: CacheManager.siblingsKey(raceId))
            }

            raceDay = rd
            error = nil
        } catch {
            // Si la caché nos ha dejado algo visible, no sobreescribir con error.
            if raceDay == nil {
                self.error = error.localizedDescription
            }
        }
        isLoading = false
    }

    // MARK: - Caché offline

    /// Resultado de la búsqueda en caché local.
    private struct CachedStage {
        let raceDay: RaceDay
        let race: Race?
        let broadcasts: [Broadcast]
        let assets: [Asset]
    }

    /// Busca una jornada entre los `DayData` cacheados por el modo offline
    /// (próximos 14 días). Devuelve nil si no aparece o si la caché está vacía.
    private static func loadFromCache(raceDayId: String) async -> CachedStage? {
        let cache = CacheManager.shared
        let today = DateFormatting.todayKey()
        for offset in 0..<14 {
            guard let dateKey = DateFormatting.dayOffset(from: today, by: offset) else { continue }
            guard let data = await cache.load(DayData.self, forKey: CacheManager.dayKey(dateKey)) else { continue }
            if let match = data.raceDays.first(where: { $0.id == raceDayId }) {
                return CachedStage(
                    raceDay: match.raceDay,
                    race: match.race,
                    broadcasts: match.broadcasts,
                    assets: match.assets,
                )
            }
        }
        return nil
    }

    /// Re-fetch desde Supabase sin tocar `isLoading`. Se usa desde el
    /// `.refreshable` de la vista: el indicador lo pinta el propio sistema,
    /// así que no queremos ocultar el contenido con `LoadingView`.
    /// Si la petición falla (p. ej. sin red), mantenemos los datos actuales
    /// en lugar de sobrescribir con un estado de error.
    func refresh(raceDayId: String) async {
        do {
            let service = SupabaseService.shared
            var rd = try await service.client.from("race_days")
                .select()
                .eq("id", value: raceDayId)
                .single()
                .execute()
                .value as RaceDay

            if let raceId = rd.raceId {
                let rdId = rd.id
                async let raceResult = service.race(byId: raceId)
                async let broadcastsResult = service.broadcasts(byRaceDayId: rdId)
                async let assetsResult = service.assets(byRaceDayId: rdId)
                async let siblingsResult = service.raceDays(byRaceId: raceId)

                let (r, b, a, siblings) = try await (
                    raceResult, broadcastsResult, assetsResult, siblingsResult
                )
                race = r

                var allDays = siblings
                RaceLogic.annotateDoubleSectors(&allDays)
                if let match = allDays.first(where: { $0.id == rd.id }), match.stageSuffix != nil {
                    rd.stageSuffix = match.stageSuffix
                }

                broadcasts = RaceLogic.filterBroadcastsByRegion(
                    b,
                    allowedGroups: RegionService.shared.current.allowedBroadcastGroups,
                )
                assets = a
                self.siblings = allDays
                await CacheManager.shared.save(allDays, forKey: CacheManager.siblingsKey(raceId))
            }

            // Sustituir la instantánea completa. Las colecciones vienen de
            // consultas nuevas a Supabase, así que se propagan también altas,
            // bajas y campos vaciados en el backend.
            raceDay = rd
            error = nil
            refreshToken &+= 1
        } catch {
            // Silenciamos el fallo: mantenemos los datos visibles anteriores.
        }
    }

    func load(slug: String) async {
        isLoading = true
        error = nil
        do {
            let rd = try await SupabaseService.shared.raceDay(bySlug: slug)
            raceDay = rd
            // Recargar con ID completo
            await load(raceDayId: rd.id)
        } catch {
            self.error = error.localizedDescription
        }
        isLoading = false
    }

    /// Assets ordenados según el orden estándar.
    var sortedAssets: [Asset] {
        assets.sorted { a, b in
            let idxA = Constants.assetOrder.firstIndex(of: a.type ?? "") ?? 99
            let idxB = Constants.assetOrder.firstIndex(of: b.type ?? "") ?? 99
            return idxA < idxB
        }
    }

    /// URL de la lista de inscritos en la web.
    var startlistURL: URL? {
        guard let race else { return nil }
        let basePath = "https://www.calendariociclismo.app"
        let utms = "utm_source=app_ios&utm_medium=app&utm_campaign=inscritos"
        if let slug = race.slug {
            return URL(string: "\(basePath)/inscritos/\(slug)/?\(utms)")
        }
        return URL(string: "\(basePath)/inscritos.html?race=\(race.id)&\(utms)")
    }

    /// Etapa anterior en la misma carrera (no descanso, no cancelada), ordenada por stageNumber.
    var previousStage: RaceDay? {
        guard let rd = raceDay else { return nil }
        let nav = siblings
            .filter { !$0.isRestDay && !$0.isCancelledDay }
            .sorted {
                if let na = $0.stageNumber, let nb = $1.stageNumber, na != nb { return na < nb }
                return $0.dateKey < $1.dateKey
            }
        guard let idx = nav.firstIndex(where: { $0.id == rd.id }), idx > 0 else { return nil }
        return nav[idx - 1]
    }

    /// Título de la página: "Tour de Francia · Etapa 3".
    /// En carreras por etapas, el nombre de la carrera va primero para darle
    /// protagonismo; la etiqueta de etapa cuelga a la derecha.
    var title: String {
        let stage = raceDay?.stageLabel ?? ""
        let raceName = race?.localizedName ?? ""
        if stage.isEmpty { return raceName }
        if raceName.isEmpty { return stage }
        return "\(raceName) · \(stage)"
    }
}
