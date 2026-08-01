import Foundation
import CryptoKit

/// Gestor de caché en disco basado en archivos JSON.
/// Almacena datos Codable con marca temporal para soporte offline.
actor CacheManager {
    static let shared = CacheManager()

    private let fileManager = FileManager.default
    private let encoder: JSONEncoder = {
        let e = JSONEncoder()
        e.dateEncodingStrategy = .iso8601
        return e
    }()
    private let decoder: JSONDecoder = {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .iso8601
        return d
    }()

    /// Directorio base de caché dentro de Application Support (no se purga como Caches).
    private var cacheDirectory: URL {
        guard let appSupport = fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask).first else {
            return fileManager.temporaryDirectory.appendingPathComponent("OfflineCache", isDirectory: true)
        }
        let dir = appSupport.appendingPathComponent("OfflineCache", isDirectory: true)
        if !fileManager.fileExists(atPath: dir.path) {
            try? fileManager.createDirectory(at: dir, withIntermediateDirectories: true)
        }
        return dir
    }

    /// Subdirectorio donde se guardan los ficheros de assets R2 descargados
    /// (rutómetros, perfiles, mapas…). Los metadatos (URL remota) van en un
    /// sidecar `<id>.url` para detectar si la URL cambió y hay que redescargar.
    private var assetsDirectory: URL {
        let dir = cacheDirectory.appendingPathComponent("Assets", isDirectory: true)
        if !fileManager.fileExists(atPath: dir.path) {
            try? fileManager.createDirectory(at: dir, withIntermediateDirectories: true)
        }
        return dir
    }

    /// Subdirectorio donde se guardan las imágenes UI (banderas de países y
    /// logos de carreras). Separado de `Assets/` para que la lógica de purga
    /// no se cruce con la de documentación R2.
    ///
    /// Nombres de fichero:
    ///   - `flag_<lowercaseCountryCode>.svg` — deterministicos, sin sidecar.
    ///   - `logo_<sha1Prefix(remoteURL)>.<ext>` — keyed por hash de URL; si el
    ///     admin cambia la URL del logo, el hash cambia y el viejo se purga.
    private var imagesDirectory: URL {
        let dir = cacheDirectory.appendingPathComponent("Images", isDirectory: true)
        if !fileManager.fileExists(atPath: dir.path) {
            try? fileManager.createDirectory(at: dir, withIntermediateDirectories: true)
        }
        return dir
    }

    // MARK: - Wrapper con timestamp

    private struct CacheEntry<T: Codable>: Codable {
        let data: T
        let savedAt: Date
    }

    // MARK: - API pública

    /// Guarda un valor Codable en disco con la clave dada.
    func save<T: Codable>(_ value: T, forKey key: String) {
        let entry = CacheEntry(data: value, savedAt: Date())
        let url = fileURL(for: key)
        do {
            let data = try encoder.encode(entry)
            try data.write(to: url, options: [.atomic, .completeFileProtection])
        } catch {
            // Fallo silencioso: la caché es best-effort
        }
    }

    /// Carga un valor del disco. Devuelve nil si no existe o no se puede decodificar.
    func load<T: Codable>(_ type: T.Type, forKey key: String) -> T? {
        let url = fileURL(for: key)
        guard let data = try? Data(contentsOf: url),
              let entry = try? decoder.decode(CacheEntry<T>.self, from: data) else {
            return nil
        }
        return entry.data
    }

    /// Devuelve la antigüedad de una entrada de caché, o nil si no existe.
    func age(forKey key: String) -> TimeInterval? {
        let url = fileURL(for: key)
        guard let data = try? Data(contentsOf: url) else { return nil }
        // Decodificar solo el campo savedAt para eficiencia
        struct TimestampOnly: Codable { let savedAt: Date }
        guard let entry = try? decoder.decode(TimestampOnly.self, from: data) else { return nil }
        return Date().timeIntervalSince(entry.savedAt)
    }

    /// Texto legible con la antigüedad de la caché (ej: "Hace 2 h").
    func ageLabel(forKey key: String) -> String? {
        guard let seconds = age(forKey: key) else { return nil }
        let minutes = Int(seconds) / 60
        if minutes < 1 { return "Hace un momento" }
        if minutes < 60 { return "Hace \(minutes) min" }
        let hours = minutes / 60
        if hours < 24 { return "Hace \(hours) h" }
        let days = hours / 24
        return "Hace \(days) d"
    }

    /// Elimina todas las entradas de caché.
    func clearAll() {
        let dir = cacheDirectory
        if let files = try? fileManager.contentsOfDirectory(atPath: dir.path) {
            for file in files {
                try? fileManager.removeItem(at: dir.appendingPathComponent(file))
            }
        }
        clearAssetFiles()
        clearImages()
    }

    /// Elimina solo los datos descargados por el modo offline
    /// (días, meses y temporada), preservando la caché normal de navegación.
    func clearOfflineData() {
        let dir = cacheDirectory
        guard let files = try? fileManager.contentsOfDirectory(atPath: dir.path) else { return }
        let offlinePrefixes = ["day_", "month_", "monthdays_", "monthview_", "season_", "races_"]
        for file in files {
            if offlinePrefixes.contains(where: { file.hasPrefix($0) }) {
                try? fileManager.removeItem(at: dir.appendingPathComponent(file))
            }
        }
        // Los assets R2 y las imágenes UI también forman parte del estado
        // offline — borrar todos.
        clearAssetFiles()
        clearImages()
    }

    /// Purga datos de días anteriores a hoy y meses pasados,
    /// manteniendo solo los datos relevantes para el modo offline.
    func purgeExpiredOfflineData(currentDateKey: String) {
        let dir = cacheDirectory
        guard let files = try? fileManager.contentsOfDirectory(atPath: dir.path) else { return }

        for file in files {
            // Purgar días anteriores a hoy
            if file.hasPrefix("day_") {
                let dateKey = file
                    .replacingOccurrences(of: "day_", with: "")
                    .replacingOccurrences(of: ".json", with: "")
                if dateKey < currentDateKey {
                    try? fileManager.removeItem(at: dir.appendingPathComponent(file))
                }
            }

            // Purgar meses anteriores al actual
            if file.hasPrefix("month_") || file.hasPrefix("monthdays_") {
                let currentMonthKey = String(currentDateKey.prefix(7)) // "YYYY-MM"
                let prefix = file.hasPrefix("month_") ? "month_" : "monthdays_"
                let monthKey = file
                    .replacingOccurrences(of: prefix, with: "")
                    .replacingOccurrences(of: ".json", with: "")
                if monthKey < currentMonthKey {
                    try? fileManager.removeItem(at: dir.appendingPathComponent(file))
                }
            }
        }
    }

    /// Tamaño total de la caché en bytes (incluye JSON + ficheros de assets R2
    /// + imágenes UI).
    func totalSize() -> Int64 {
        var total: Int64 = 0
        total += directorySize(at: cacheDirectory, recursive: false)
        total += directorySize(at: assetsDirectory, recursive: false)
        total += directorySize(at: imagesDirectory, recursive: false)
        return total
    }

    /// Suma los bytes de todos los ficheros regulares de un directorio.
    /// Si `recursive` es `true`, también incluye subdirectorios.
    private func directorySize(at dir: URL, recursive: Bool) -> Int64 {
        guard let files = try? fileManager.contentsOfDirectory(atPath: dir.path) else { return 0 }
        var total: Int64 = 0
        for file in files {
            let url = dir.appendingPathComponent(file)
            var isDir: ObjCBool = false
            if fileManager.fileExists(atPath: url.path, isDirectory: &isDir) {
                if isDir.boolValue {
                    if recursive {
                        total += directorySize(at: url, recursive: true)
                    }
                } else if let attrs = try? fileManager.attributesOfItem(atPath: url.path),
                          let size = attrs[.size] as? Int64 {
                    total += size
                }
            }
        }
        return total
    }

    /// Tamaño formateado de la caché (ej: "2,3 MB").
    func formattedSize() -> String {
        let bytes = totalSize()
        if bytes < 1024 { return "\(bytes) B" }
        let kb = Double(bytes) / 1024
        if kb < 1024 { return String(format: "%.0f KB", kb) }
        let mb = kb / 1024
        return String(format: "%.1f MB", mb)
    }

    // MARK: - Claves predefinidas

    /// Clave para datos de un día concreto (hoy, +1, +2).
    static func dayKey(_ dateKey: String) -> String { "day_\(dateKey)" }
    /// Clave para las carreras del año (usadas para placeholders en Today).
    static func yearRacesKey(_ year: Int) -> String { "races_\(year)" }
    /// Clave para los siblings (todas las etapas) de una carrera.
    static func siblingsKey(_ raceId: String) -> String { "siblings_\(raceId)" }
    /// Clave para el Libro de Ruta común a todas las jornadas de una carrera.
    /// Se guarda como lista para poder memorizar también que no existe.
    static func technicalGuideKey(_ raceId: String) -> String { "technical_guide_\(raceId)" }
    /// Clave para los datos del mes.
    static func monthKey(year: Int, month: Int) -> String { "month_\(year)-\(String(format: "%02d", month))" }
    /// Clave para las jornadas del mes.
    static func monthDaysKey(year: Int, month: Int) -> String { "monthdays_\(year)-\(String(format: "%02d", month))" }
    /// Clave para la temporada completa.
    static func seasonKey(_ year: Int) -> String { "season_\(year)" }

    // MARK: - Interno

    private func fileURL(for key: String) -> URL {
        let sanitized = key.replacingOccurrences(of: "/", with: "_")
        return cacheDirectory.appendingPathComponent("\(sanitized).json")
    }

    // MARK: - Assets R2 (ficheros descargables)

    /// Nombre de fichero donde se guarda el asset.
    private func assetFilename(for asset: Asset) -> String {
        // ID + extensión conserva el mismo filename mientras la URL exista;
        // si la URL cambia, el sidecar `.url` ya no coincidirá y se sobreescribirá.
        "\(asset.id).\(asset.fileExtension)"
    }

    /// Sidecar que guarda la última URL remota descargada para este asset.
    private func assetSidecarFilename(for assetId: String) -> String {
        "\(assetId).url"
    }

    /// Devuelve la URL local del fichero descargado para [asset] si existe Y
    /// la URL remota coincide con la última descarga (detecta si el admin
    /// re-subió el documento con URL nueva). En cualquier otro caso, nil.
    func localAssetURL(for asset: Asset) -> URL? {
        guard let remoteUrl = asset.url else { return nil }
        let fileURL = assetsDirectory.appendingPathComponent(assetFilename(for: asset))
        let sidecarURL = assetsDirectory.appendingPathComponent(assetSidecarFilename(for: asset.id))

        guard fileManager.fileExists(atPath: fileURL.path),
              let sidecarData = try? Data(contentsOf: sidecarURL),
              let sidecarStr = String(data: sidecarData, encoding: .utf8),
              sidecarStr == remoteUrl else {
            return nil
        }
        return fileURL
    }

    /// Descarga [asset] desde R2 si no existe localmente o si la URL cambió.
    /// Devuelve la URL local resultante, o nil si fracasó la descarga.
    /// Fallo silencioso: no lanza — la caché es best-effort.
    func downloadAsset(_ asset: Asset) async -> URL? {
        guard asset.isDownloadableR2,
              let urlStr = asset.url,
              let remoteURL = URL(string: urlStr) else { return nil }

        // Ya descargado con la misma URL: nada que hacer.
        if let existing = localAssetURL(for: asset) { return existing }

        do {
            let (tempURL, response) = try await URLSession.shared.download(from: remoteURL)
            defer { try? fileManager.removeItem(at: tempURL) }
            guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
                return nil
            }

            let destURL = assetsDirectory.appendingPathComponent(assetFilename(for: asset))
            let sidecarURL = assetsDirectory.appendingPathComponent(assetSidecarFilename(for: asset.id))

            // Reemplazar atómicamente
            if fileManager.fileExists(atPath: destURL.path) {
                try? fileManager.removeItem(at: destURL)
            }
            try fileManager.moveItem(at: tempURL, to: destURL)
            try? Data(urlStr.utf8).write(to: sidecarURL, options: [.atomic])
            return destURL
        } catch {
            #if DEBUG
            print("[CacheManager] Error descargando asset \(asset.id): \(error.localizedDescription)")
            #endif
            return nil
        }
    }

    /// Descarga una colección de assets con concurrencia limitada (por defecto 4
    /// descargas en paralelo). Los que ya tienen fichero local con la misma URL
    /// se saltan automáticamente dentro de `downloadAsset`.
    func downloadAssets(_ assets: [Asset], maxConcurrent: Int = 4) async {
        let downloadable = assets.filter { $0.isDownloadableR2 }
        guard !downloadable.isEmpty else { return }

        var index = 0
        await withTaskGroup(of: Void.self) { group in
            // Lanzar los primeros N; según terminan, añadir más.
            let initialBatch = min(maxConcurrent, downloadable.count)
            for _ in 0..<initialBatch {
                let asset = downloadable[index]
                index += 1
                group.addTask { [self] in
                    _ = await downloadAsset(asset)
                }
            }
            while await group.next() != nil {
                if index < downloadable.count {
                    let asset = downloadable[index]
                    index += 1
                    group.addTask { [self] in
                        _ = await downloadAsset(asset)
                    }
                }
            }
        }
    }

    /// Elimina ficheros de assets cuyos IDs NO estén en [keeping].
    /// Se usa al final del sync para purgar documentación de jornadas caídas
    /// fuera de la ventana offline.
    func purgeAssetFiles(keeping: Set<String>) {
        let dir = assetsDirectory
        guard let files = try? fileManager.contentsOfDirectory(atPath: dir.path) else { return }
        for file in files {
            // Extraer el ID del nombre (antes del primer punto).
            guard let dotIdx = file.firstIndex(of: ".") else { continue }
            let assetId = String(file[..<dotIdx])
            if !keeping.contains(assetId) {
                try? fileManager.removeItem(at: dir.appendingPathComponent(file))
            }
        }
    }

    /// Elimina TODOS los ficheros de assets R2 descargados.
    func clearAssetFiles() {
        let dir = assetsDirectory
        guard let files = try? fileManager.contentsOfDirectory(atPath: dir.path) else { return }
        for file in files {
            try? fileManager.removeItem(at: dir.appendingPathComponent(file))
        }
    }

    // MARK: - Imágenes UI (logos de carrera)

    /// Prefijo SHA-1 (20 hex chars = 80 bits) del absolute string de la URL.
    /// Colisión despreciable para <10k imágenes.
    private static func logoHash(for remoteURL: URL) -> String {
        let digest = Insecure.SHA1.hash(data: Data(remoteURL.absoluteString.utf8))
        let hex = digest.map { String(format: "%02x", $0) }.joined()
        return String(hex.prefix(20))
    }

    /// Nombre del fichero de logo para una URL remota.
    private static func logoFilename(for remoteURL: URL) -> String {
        let ext = remoteURL.pathExtension.isEmpty ? "img" : remoteURL.pathExtension.lowercased()
        return "logo_\(logoHash(for: remoteURL)).\(ext)"
    }

    /// Directorio `OfflineCache/Images/` computado sin aislamiento de actor.
    /// Se usa desde el componente SwiftUI `RaceLogo` para lectura síncrona durante el render.
    nonisolated static func imagesDirectoryURL() -> URL {
        let fm = FileManager.default
        let appSupport = fm.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? fm.temporaryDirectory
        let dir = appSupport
            .appendingPathComponent("OfflineCache", isDirectory: true)
            .appendingPathComponent("Images", isDirectory: true)
        if !fm.fileExists(atPath: dir.path) {
            try? fm.createDirectory(at: dir, withIntermediateDirectories: true)
        }
        return dir
    }

    /// URL local del logo si existe. Prioridad: bundle empaquetado → caché offline. Síncrono.
    nonisolated static func localLogoFileURL(for remoteURL: URL) -> URL? {
        let filename = logoFilename(for: remoteURL)
        // 1. Bundle empaquetado (sin red, disponible desde el primer arranque)
        let bundledURL = Bundle.main.bundleURL
            .appendingPathComponent("BundledLogos")
            .appendingPathComponent(filename)
        if FileManager.default.fileExists(atPath: bundledURL.path) {
            return bundledURL
        }
        // 2. Caché offline descargada por el sync
        let cacheURL = imagesDirectoryURL().appendingPathComponent(filename)
        return FileManager.default.fileExists(atPath: cacheURL.path) ? cacheURL : nil
    }

    /// Descarga el logo de carrera desde su URL remota.
    /// Devuelve la URL local resultante, o `nil` si la descarga falla.
    func downloadLogo(remoteURL: URL) async -> URL? {
        let destURL = imagesDirectory.appendingPathComponent(Self.logoFilename(for: remoteURL))
        if fileManager.fileExists(atPath: destURL.path) { return destURL }

        do {
            let (tempURL, response) = try await URLSession.shared.download(from: remoteURL)
            defer { try? fileManager.removeItem(at: tempURL) }
            guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
                return nil
            }
            if fileManager.fileExists(atPath: destURL.path) {
                try? fileManager.removeItem(at: destURL)
            }
            try fileManager.moveItem(at: tempURL, to: destURL)
            return destURL
        } catch {
            #if DEBUG
            print("[CacheManager] Error descargando logo \(remoteURL.absoluteString): \(error.localizedDescription)")
            #endif
            return nil
        }
    }

    /// Descarga una colección de logos con concurrencia limitada (4 por defecto).
    func downloadLogos(_ urls: Set<URL>, maxConcurrent: Int = 4) async {
        let list = Array(urls)
        guard !list.isEmpty else { return }

        var index = 0
        await withTaskGroup(of: Void.self) { group in
            let initialBatch = min(maxConcurrent, list.count)
            for _ in 0..<initialBatch {
                let url = list[index]
                index += 1
                group.addTask { [self] in
                    _ = await downloadLogo(remoteURL: url)
                }
            }
            while await group.next() != nil {
                if index < list.count {
                    let url = list[index]
                    index += 1
                    group.addTask { [self] in
                        _ = await downloadLogo(remoteURL: url)
                    }
                }
            }
        }
    }

    /// Elimina ficheros de logos cuyo hash NO esté en el set retenido. Se usa al final del sync.
    func purgeImages(keepingLogoURLs: Set<URL>) {
        let dir = imagesDirectory
        guard let files = try? fileManager.contentsOfDirectory(atPath: dir.path) else { return }

        let logoKeep: Set<String> = Set(keepingLogoURLs.map { Self.logoFilename(for: $0) })

        for file in files where file.hasPrefix("logo_") {
            if !logoKeep.contains(file) {
                try? fileManager.removeItem(at: dir.appendingPathComponent(file))
            }
        }
    }

    /// Elimina TODAS las imágenes cacheadas (banderas + logos).
    func clearImages() {
        let dir = imagesDirectory
        guard let files = try? fileManager.contentsOfDirectory(atPath: dir.path) else { return }
        for file in files {
            try? fileManager.removeItem(at: dir.appendingPathComponent(file))
        }
    }
}
