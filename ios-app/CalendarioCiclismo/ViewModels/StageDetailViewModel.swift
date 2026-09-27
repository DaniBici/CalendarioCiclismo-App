import Foundation

/// ViewModel para la vista de detalle de etapa/jornada — equivalente a `js/jornada.js`.
@MainActor
@Observable
final class StageDetailViewModel {
    var raceDay: RaceDay?
    var race: Race?
    /// Lista regional aplicada a la preferencia del usuario.
    var broadcasts: [Broadcast] = []
    /// Lista completa, necesaria para el selector «Todas» de la jornada.
    var allBroadcasts: [Broadcast] = []
    var assets: [Asset] = []
    var siblings: [RaceDay] = []
    var isLoading = false
    var error: String?
    /// Gates de resultados resueltos junto con la instantánea de la jornada. La
    /// vista no muta al CTA nativo de resultados tras pintarse.
    var hasInhouseResults = false
    var hasActualResults = false
    var resultsStageNumber: Int?
    var prevHasInhouse = false
    var prevResultsStageNumber: Int?
    var areInhouseGatesResolved = false
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
        areInhouseGatesResolved = false

        // 1. Intentar rellenar desde la caché offline (DayData de los últimos 14 días).
        //    Esto permite que la pantalla se pinte inmediatamente sin red y que
        //    los assets R2 descargados sean accesibles aunque Supabase esté caído.
        if let cached = await Self.loadFromCache(raceDayId: raceDayId) {
            raceDay = cached.raceDay
            race = cached.race
            allBroadcasts = cached.broadcasts.sorted { ($0.sortOrder ?? 0) < ($1.sortOrder ?? 0) }
            broadcasts = RaceLogic.filterBroadcastsByRegion(
                allBroadcasts,
                allowedGroups: RegionService.shared.allowedBroadcastGroups,
            )
            assets = cached.assets
            // Pre-cargar siblings, clasificaciones y guía como una sola
            // instantánea. La vista solo se publica cuando puede resolver todas
            // sus secciones sin insertar contenido tras el primer render.
            var cachedSnapshotReady = false
            if let raceId = cached.raceDay.raceId,
               var cachedSiblings = await CacheManager.shared.load([RaceDay].self, forKey: CacheManager.siblingsKey(raceId)) {
                RaceLogic.annotateDoubleSectors(&cachedSiblings)
                siblings = cachedSiblings
                let cachedResultsStages = await CacheManager.shared
                    .load([RaceUciStage].self, forKey: CacheManager.resultsStagesKey(raceId))
                if let cachedResultsStages {
                    updateInhouseGates(
                        raceDay: cached.raceDay,
                        siblings: cachedSiblings,
                        stages: cachedResultsStages
                    )
                    areInhouseGatesResolved = true
                }
                // La guía técnica pertenece a la carrera, no necesariamente a
                // esta jornada. Recuperarla con los siblings evita que el chip
                // aparezca solo cuando llegue el refresco remoto.
                let cachedGuides = await CacheManager.shared
                    .load([Asset].self, forKey: CacheManager.technicalGuideKey(raceId))
                let cachedGuide = cachedGuides?.first
                let localGuide = cached.assets.first { $0.type == "technicalGuide" }
                let technicalGuide = cachedGuide ?? localGuide
                assets = (technicalGuide.map { [$0] } ?? [])
                    + cached.assets.filter { $0.type != "technicalGuide" }
                // `nil` significa que esta instalación aún no ha creado la
                // nueva entrada por carrera (p. ej. tras actualizar desde una
                // versión anterior). En ese caso la instantánea no es completa:
                // mantener Loading hasta la respuesta remota evita pintar la
                // tira sin guía y añadirla unas décimas después. Una lista
                // vacía sí es un estado cacheado válido: sabemos que no existe.
                let cachedGuideReady = cachedGuides != nil || localGuide != nil
                cachedSnapshotReady = cachedGuideReady && cachedResultsStages != nil
            }
            // Con red se espera siempre la instantánea remota: una caché válida
            // puede haber quedado obsoleta justo al publicarse los resultados y
            // volvería a insertar el CTA después del primer render. Sin red sí
            // se presenta la instantánea local completa.
            if cachedSnapshotReady && !NetworkMonitor.shared.isOnline { isLoading = false }
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
                async let resultsStagesResult = service.raceUciStages(raceId: raceId)
                // La guía es de toda la competición. Se pide directamente por
                // raceId, en paralelo, en vez de esperar a siblings y lanzar
                // una segunda ronda de red: así el chip no aparece tarde.
                async let technicalGuideResult = service.technicalGuide(byRaceId: raceId)

                let (r, b, a, siblings, technicalGuide, resultsStages) = try await (
                    raceResult, broadcastsResult, assetsResult, siblingsResult, technicalGuideResult, resultsStagesResult
                )
                race = r

                // Detectar doble sector desde siblings
                var allDays = siblings
                RaceLogic.annotateDoubleSectors(&allDays)
                if let match = allDays.first(where: { $0.id == rd.id }), match.stageSuffix != nil {
                    rd.stageSuffix = match.stageSuffix
                }

                allBroadcasts = b.sorted { ($0.sortOrder ?? 0) < ($1.sortOrder ?? 0) }
                broadcasts = RaceLogic.filterBroadcastsByRegion(
                    allBroadcasts,
                    allowedGroups: RegionService.shared.allowedBroadcastGroups,
                )
                // Se guarda una sola guía técnica por competición, pero se
                // expone en cada jornada sin duplicar su fila ni su PDF.
                assets = (technicalGuide.map { [$0] } ?? []) + a.filter { $0.type != "technicalGuide" }
                self.siblings = allDays
                updateInhouseGates(raceDay: rd, siblings: allDays, stages: resultsStages)
                // Guardar siblings para cargas futuras sin flash
                await CacheManager.shared.save(allDays, forKey: CacheManager.siblingsKey(raceId))
                // Guardar incluso una lista vacía: si el Libro de Ruta se borra
                // en servidor, no debe resucitar desde una caché anterior.
                await CacheManager.shared.save(
                    technicalGuide.map { [$0] } ?? [],
                    forKey: CacheManager.technicalGuideKey(raceId)
                )
                await CacheManager.shared.save(
                    resultsStages,
                    forKey: CacheManager.resultsStagesKey(raceId)
                )
            }

            raceDay = rd
            error = nil
        } catch {
            // Si la caché nos ha dejado algo visible, no sobreescribir con error.
            if raceDay == nil {
                self.error = error.localizedDescription
            }
        }
        // Ante un fallo de red se da el gate por resuelto, sin enseñar
        // primero una barra que después pueda mutar al CTA nativo.
        areInhouseGatesResolved = true
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
        ImageRefresh.shared.refresh()
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
                async let technicalGuideResult = service.technicalGuide(byRaceId: raceId)
                async let resultsStagesResult = service.raceUciStages(raceId: raceId)

                let (r, b, a, siblings, technicalGuide, resultsStages) = try await (
                    raceResult, broadcastsResult, assetsResult, siblingsResult, technicalGuideResult, resultsStagesResult
                )
                race = r

                var allDays = siblings
                RaceLogic.annotateDoubleSectors(&allDays)
                if let match = allDays.first(where: { $0.id == rd.id }), match.stageSuffix != nil {
                    rd.stageSuffix = match.stageSuffix
                }

                allBroadcasts = b.sorted { ($0.sortOrder ?? 0) < ($1.sortOrder ?? 0) }
                broadcasts = RaceLogic.filterBroadcastsByRegion(
                    allBroadcasts,
                    allowedGroups: RegionService.shared.allowedBroadcastGroups,
                )
                assets = (technicalGuide.map { [$0] } ?? []) + a.filter { $0.type != "technicalGuide" }
                self.siblings = allDays
                updateInhouseGates(raceDay: rd, siblings: allDays, stages: resultsStages)
                await CacheManager.shared.save(allDays, forKey: CacheManager.siblingsKey(raceId))
                await CacheManager.shared.save(
                    technicalGuide.map { [$0] } ?? [],
                    forKey: CacheManager.technicalGuideKey(raceId)
                )
                await CacheManager.shared.save(
                    resultsStages,
                    forKey: CacheManager.resultsStagesKey(raceId)
                )
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

    /// Resuelve los CTAs de la etapa actual y de la anterior con la misma
    /// respuesta UCI que llega durante la carga principal.
    private func updateInhouseGates(raceDay: RaceDay, siblings: [RaceDay], stages: [RaceUciStage]) {
        let usable = stages.filter { $0.rowCount > 0 }
        func matchingStage(for day: RaceDay) -> RaceUciStage? {
            usable.first { $0.raceDayId == day.id }
                ?? usable.first { $0.raceDayId == nil && $0.stageNumber == day.stageNumber }
        }

        let current = matchingStage(for: raceDay)
        hasActualResults = current != nil
        hasInhouseResults = current != nil || raceDay.isCancelledDay
        resultsStageNumber = current?.stageNumber ?? raceDay.stageNumber

        let navigable = siblings
            .filter { !$0.isRestDay && !$0.isCancelledDay }
            .sorted {
                if let lhs = $0.stageNumber, let rhs = $1.stageNumber, lhs != rhs { return lhs < rhs }
                return $0.dateKey < $1.dateKey
            }
        if let index = navigable.firstIndex(where: { $0.id == raceDay.id }), index > 0,
           let previous = matchingStage(for: navigable[index - 1]) {
            prevHasInhouse = true
            prevResultsStageNumber = previous.stageNumber
        } else {
            prevHasInhouse = false
            prevResultsStageNumber = nil
        }
        areInhouseGatesResolved = true
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
