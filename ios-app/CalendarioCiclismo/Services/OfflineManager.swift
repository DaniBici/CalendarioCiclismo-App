import Foundation
import Network
import WidgetKit

/// Monitor de conectividad de red. Observable desde SwiftUI para decidir si
/// mostrar modales de "sin conexión" al tocar enlaces/assets.
@MainActor
@Observable
final class NetworkMonitor {
    static let shared = NetworkMonitor()

    /// `true` cuando hay una ruta de red satisfactoria (wifi, celular, ethernet).
    var isOnline: Bool = true

    private let monitor = NWPathMonitor()
    private let queue = DispatchQueue(label: "app.calendariociclismo.network-monitor")

    private init() {
        monitor.pathUpdateHandler = { [weak self] path in
            let online = path.status == .satisfied
            Task { @MainActor in
                self?.isOnline = online
            }
        }
        monitor.start(queue: queue)
    }

    deinit {
        monitor.cancel()
    }
}

/// Gestiona el modo sin conexión: estado, descarga proactiva y purgado de datos.
/// Descarga diariamente los próximos 14 días, el mes actual y siguiente,
/// y la temporada completa para uso offline.
@MainActor
@Observable
final class OfflineManager {
    static let shared = OfflineManager()

    // MARK: - Estado público

    /// Indica si el modo offline está activado.
    var isEnabled: Bool {
        get { UserDefaults.standard.bool(forKey: "offline_mode_enabled") }
        set { UserDefaults.standard.set(newValue, forKey: "offline_mode_enabled") }
    }

    /// Indica si el usuario ha completado el onboarding de modo offline.
    var hasCompletedOnboarding: Bool {
        get { UserDefaults.standard.bool(forKey: "offline_onboarding_completed") }
        set { UserDefaults.standard.set(newValue, forKey: "offline_onboarding_completed") }
    }

    /// Indica si se está realizando una sincronización.
    var isSyncing = false

    /// Progreso de la sincronización (0.0 a 1.0).
    var syncProgress: Double = 0

    /// Texto descriptivo del paso actual de sincronización.
    var syncStatusText: String?

    /// Fecha de la última sincronización completada.
    var lastSyncDate: Date? {
        get {
            let interval = UserDefaults.standard.double(forKey: "offline_last_sync")
            return interval > 0 ? Date(timeIntervalSince1970: interval) : nil
        }
        set {
            UserDefaults.standard.set(newValue?.timeIntervalSince1970 ?? 0, forKey: "offline_last_sync")
        }
    }

    /// Texto legible con la fecha de última sincronización.
    var lastSyncLabel: String? {
        guard let date = lastSyncDate else { return nil }
        let seconds = Date().timeIntervalSince(date)
        let minutes = Int(seconds) / 60
        if minutes < 1 { return "Hace un momento" }
        if minutes < 60 { return "Hace \(minutes) min" }
        let hours = minutes / 60
        if hours < 24 { return "Hace \(hours) h" }
        let days = hours / 24
        return "Hace \(days) d"
    }

    /// Indica si ha pasado más de 24 horas desde la última sincronización.
    var needsSync: Bool {
        guard isEnabled else { return false }
        guard let last = lastSyncDate else { return true }
        return Date().timeIntervalSince(last) > 86400 // 24 horas
    }

    /// Versión del esquema de caché offline. Se incrementa cuando introducimos
    /// nuevos tipos de artefactos (docs R2, banderas, logos…) para que los
    /// usuarios que ya tenían el modo offline activo disparen un sync completo
    /// en la primera apertura tras actualizar la app — si no, tendrían datos
    /// incompletos hasta el siguiente sync periódico.
    ///
    /// Historial:
    ///   - 0 → inicial (solo JSON de días/meses/temporada).
    ///   - 1 → añade descarga de docs R2 (PDFs, mapas, perfiles…).
    ///   - 2 → añade descarga de banderas + logos de carrera.
    static let cacheSchemaVersion: Int = 2

    /// Versión guardada localmente; `0` si no existe (primer arranque o app
    /// pre-migración).
    var storedCacheSchemaVersion: Int {
        get { UserDefaults.standard.integer(forKey: "offline_cache_schema_version") }
        set { UserDefaults.standard.set(newValue, forKey: "offline_cache_schema_version") }
    }

    /// `true` si el usuario tiene offline activo y la caché local es de una
    /// versión previa — hay que forzar un sync para recoger los nuevos tipos
    /// de artefactos.
    var needsMigrationSync: Bool {
        isEnabled && storedCacheSchemaVersion < Self.cacheSchemaVersion
    }

    /// `true` si la fecha (formato `YYYY-MM-DD`) cae dentro de la ventana que
    /// el sync mantiene al día: mes en curso o mes siguiente. Los 14 días de
    /// la vista "Hoy" siempre caen dentro, así que no hace falta comprobarlos
    /// aparte. El sync de temporada solo descarga `races`, no `race_days`, por
    /// lo que NO lo consideramos "rango" para pull-to-refresh de jornadas.
    func isInOfflineRange(dateKey: String) -> Bool {
        let parts = dateKey.split(separator: "-")
        guard parts.count >= 2,
              let year = Int(parts[0]),
              let month = Int(parts[1]) else { return false }
        let cal = Calendar(identifier: .iso8601)
        let now = Date()
        let currentYear = cal.component(.year, from: now)
        let currentMonth = cal.component(.month, from: now)
        let nextMonth: Int
        let nextMonthYear: Int
        if currentMonth == 12 {
            nextMonth = 1
            nextMonthYear = currentYear + 1
        } else {
            nextMonth = currentMonth + 1
            nextMonthYear = currentYear
        }
        return (year == currentYear && month == currentMonth)
            || (year == nextMonthYear && month == nextMonth)
    }

    private init() {}

    // MARK: - API pública

    /// Activa el modo offline y realiza la descarga inicial.
    func enable() async {
        isEnabled = true
        await performSync()
    }

    /// Desactiva el modo offline y elimina los datos descargados.
    func disable() async {
        isEnabled = false
        lastSyncDate = nil
        syncProgress = 0
        syncStatusText = nil
        await CacheManager.shared.clearOfflineData()
    }

    /// Realiza la sincronización diaria: descarga datos y purga los obsoletos.
    /// Se llama automáticamente al abrir la app si ha pasado > 24h.
    func performSync() async {
        guard isEnabled, !isSyncing else { return }
        isSyncing = true
        syncProgress = 0

        let cache = CacheManager.shared
        let today = DateFormatting.todayKey()
        let cal = Calendar(identifier: .iso8601)
        let currentYear = cal.component(.year, from: Date())
        let currentMonth = cal.component(.month, from: Date())

        // Calcular mes siguiente
        let nextMonth: Int
        let nextMonthYear: Int
        if currentMonth == 12 {
            nextMonth = 1
            nextMonthYear = currentYear + 1
        } else {
            nextMonth = currentMonth + 1
            nextMonthYear = currentYear
        }

        // Total de pasos: 14 días + 2 meses + 1 temporada + 1 descarga R2 +
        // 1 descarga imágenes UI + 1 purga = 19
        let totalSteps = 19.0
        var completedSteps = 0.0

        /// IDs de assets R2 retenidos en esta pasada — se usan al final para
        /// purgar ficheros de jornadas que ya no están en la ventana offline.
        var retainedAssetIds = Set<String>()
        var assetsToDownload: [Asset] = []

        /// URLs remotas de logos de carrera a descargar (hash del absoluteString → nombre de fichero).
        var retainedLogoURLs = Set<URL>()

        do {
            // 1. Descargar los próximos 14 días (vista Hoy)
            syncStatusText = "Descargando agenda diaria…"
            for offset in 0..<14 {
                guard let dateKey = DateFormatting.dayOffset(from: today, by: offset) else { continue }
                let cacheKey = CacheManager.dayKey(dateKey)

                var dayData: DayData?

                // Solo descargar si no hay datos recientes (< 12h)
                if let age = await cache.age(forKey: cacheKey), age < 43200 {
                    dayData = await cache.load(DayData.self, forKey: cacheKey)
                    completedSteps += 1
                    syncProgress = completedSteps / totalSteps
                } else {
                    do {
                        let data = try await SupabaseService.shared.loadDayComplete(dateKey: dateKey)
                        await cache.save(data, forKey: cacheKey)
                        dayData = data
                    } catch {
                        #if DEBUG
                        print("[OfflineManager] Error sincronizando día \(dateKey): \(error.localizedDescription)")
                        #endif
                    }
                    completedSteps += 1
                    syncProgress = completedSteps / totalSteps
                }

                // Acumular los assets R2 de esta jornada (aunque vengan de caché,
                // hay que retenerlos para que no los purgue el paso final).
                if let data = dayData {
                    for enriched in data.raceDays {
                        for asset in enriched.assets where asset.isDownloadableR2 {
                            retainedAssetIds.insert(asset.id)
                            assetsToDownload.append(asset)
                        }
                    }
                    // Logos de todas las carreras del mapa (incluye placeholders y expandidas por jornada).
                    for race in data.raceMap.values {
                        Self.collectArtwork(from: race, logos: &retainedLogoURLs)
                    }
                }
            }

            // 2. Descargar mes actual (vista Mes)
            syncStatusText = "Descargando mes actual…"
            await downloadMonth(year: currentYear, month: currentMonth, cache: cache, logos: &retainedLogoURLs)
            completedSteps += 1
            syncProgress = completedSteps / totalSteps

            // 3. Descargar mes siguiente (vista Mes)
            syncStatusText = "Descargando mes siguiente…"
            await downloadMonth(year: nextMonthYear, month: nextMonth, cache: cache, logos: &retainedLogoURLs)
            completedSteps += 1
            syncProgress = completedSteps / totalSteps

            // 4. Descargar temporada completa (vista Temporada)
            syncStatusText = "Descargando temporada…"
            let seasonKey = CacheManager.seasonKey(currentYear)
            do {
                let races = try await SupabaseService.shared.racesByYear(currentYear)
                await cache.save(races, forKey: seasonKey)
                for race in races {
                    Self.collectArtwork(from: race, logos: &retainedLogoURLs)
                }
            } catch {
                #if DEBUG
                print("[OfflineManager] Error sincronizando temporada \(currentYear): \(error.localizedDescription)")
                #endif
            }
            completedSteps += 1
            syncProgress = completedSteps / totalSteps

            // 5. Descargar los ficheros R2 (PDFs, mapas, perfiles) de las jornadas
            //    cacheadas arriba. Esto hace que la documentación sea accesible
            //    sin conexión desde el detalle de etapa. URLs externas (live_text,
            //    TV oficial) se ignoran automáticamente vía `isDownloadableR2`.
            syncStatusText = "Descargando documentación… (puede tardar 1-2 min)"
            // Deduplicar por asset.id (la misma jornada aparece solo una vez,
            // pero un asset puede repetirse si se re-evaluó entre días).
            var seen = Set<String>()
            let uniqueAssets = assetsToDownload.filter { seen.insert($0.id).inserted }
            await cache.downloadAssets(uniqueAssets)
            completedSteps += 1
            syncProgress = completedSteps / totalSteps

            // 6. Descargar logos de carrera (R2) para los que aún no están en el
            //    bundle empaquetado (carreras nuevas añadidas tras el último build).
            //    Las banderas van ya en el asset catalog — no se descargan.
            syncStatusText = "Descargando logos…"
            await cache.downloadLogos(retainedLogoURLs)
            completedSteps += 1
            syncProgress = completedSteps / totalSteps

            // 7. Purgar datos obsoletos — JSON fuera de ventana + ficheros de
            //    assets cuyas jornadas ya no están cacheadas + imágenes UI de
            //    carreras que ya no están en la ventana.
            syncStatusText = "Limpiando datos antiguos…"
            await cache.purgeExpiredOfflineData(currentDateKey: today)
            await cache.purgeAssetFiles(keeping: retainedAssetIds)
            await cache.purgeImages(keepingLogoURLs: retainedLogoURLs)
            completedSteps += 1
            syncProgress = completedSteps / totalSteps

            lastSyncDate = Date()
            // Marca el esquema de caché al día — los próximos arranques ya no
            // disparan la migración.
            storedCacheSchemaVersion = Self.cacheSchemaVersion
            syncStatusText = nil

            // Actualizar widget con los datos recién sincronizados de hoy
            let todayKey = DateFormatting.todayKey()
            if let dayData: DayData = await CacheManager.shared.load(
                DayData.self, forKey: CacheManager.dayKey(todayKey)
            ) {
                writeWidgetPayload(items: dayData.raceDays, nextDateKey: nil, dateKey: todayKey)
            }
        }

        isSyncing = false
        syncProgress = 1.0
    }

    /// Comprueba si es necesario sincronizar y lo hace automáticamente.
    /// Llamar al iniciar la app.
    ///
    /// Dispara sync si toca por tiempo (>24 h) o por migración de esquema
    /// (nuevos tipos de artefactos añadidos a la caché offline).
    func syncIfNeeded() async {
        guard needsSync || needsMigrationSync else { return }
        await performSync()
    }

    // MARK: - Privado

    /// Descarga los datos de un mes completo para la vista de Mes.
    /// Acumula en `logos` las URLs de logos a descargar en el paso 6 del sync.
    private func downloadMonth(year: Int,
                               month: Int,
                               cache: CacheManager,
                               logos: inout Set<URL>) async {
        let cacheKey = CacheManager.monthKey(year: year, month: month)
        let needsFetch: Bool
        if let age = await cache.age(forKey: cacheKey), age < 43200 {
            needsFetch = false
        } else {
            needsFetch = true
        }

        // Estructura compatible con MonthViewModel.MonthCache.
        struct MonthCache: Codable {
            let raceDays: [RaceDay]
            let races: [Race]
        }

        if !needsFetch {
            // Incluso con caché fresca, hay que recolectar logos de sus
            // carreras para retenerlos durante la purga.
            if let existing = await cache.load(MonthCache.self, forKey: cacheKey) {
                for race in existing.races {
                    Self.collectArtwork(from: race, logos: &logos)
                }
            }
            return
        }

        let neededMonth = String(format: "%04d-%02d", year, month)
        let cal = Calendar(identifier: .iso8601)
        let firstOfMonth = cal.date(from: DateComponents(year: year, month: month, day: 1)) ?? Date()
        let daysInMonth = cal.range(of: .day, in: .month, for: firstOfMonth)?.count ?? 30
        let startKey = "\(neededMonth)-01"
        let endKey = String(format: "%@-%02d", neededMonth, daysInMonth)

        do {
            async let daysResult = SupabaseService.shared.raceDays(from: startKey, to: endKey)
            async let racesResult = SupabaseService.shared.racesByYear(year)

            let (publishedDays, races) = try await (daysResult, racesResult)

            await cache.save(MonthCache(raceDays: publishedDays, races: races), forKey: cacheKey)

            // También cachear las carreras del año
            let yearKey = CacheManager.yearRacesKey(year)
            await cache.save(races, forKey: yearKey)

            for race in races {
                Self.collectArtwork(from: race, logos: &logos)
            }
        } catch {
            #if DEBUG
            print("[OfflineManager] Error sincronizando mes \(month)/\(year): \(error.localizedDescription)")
            #endif
        }
    }

    /// Extrae la URL del logo de una carrera hacia el set acumulador.
    /// Las banderas van en el asset catalog — no se gestionan aquí.
    static func collectArtwork(from race: Race, logos: inout Set<URL>) {
        if let logo = race.logoUrl, let url = URL(string: logo) {
            logos.insert(url)
        }
    }
}
