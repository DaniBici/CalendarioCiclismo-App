import SwiftUI

/// El refresco manual invalida también los logos visibles y los intentos fallidos.
@MainActor @Observable
final class ImageRefresh {
    static let shared = ImageRefresh()
    private(set) var revision = 0

    func refresh() { revision &+= 1 }
}

struct ImageRequest: Hashable, Sendable {
    let url: URL?
    let revision: Int
}

/// Mantiene el estado de carga fuera de las ramas de presentación de SwiftUI.
@MainActor @Observable
final class CachedImageState {
    private(set) var image: UIImage?
    private var source: URL?
    private var generation = 0
    private let fetch: @MainActor (URL, Int) async throws -> UIImage
    private let localImage: (URL) -> UIImage?

    init(
        fetch: @escaping @MainActor (URL, Int) async throws -> UIImage = { url, revision in try await ImageLoader.shared.image(for: url, revision: revision) },
        localImage: @escaping (URL) -> UIImage? = { url in
            guard let local = CacheManager.localLogoFileURL(for: url) else { return nil }
            return UIImage(contentsOfFile: local.path)
        }
    ) {
        self.fetch = fetch
        self.localImage = localImage
    }

    func load(_ request: ImageRequest) async {
        generation &+= 1
        let current = generation
        if source != request.url {
            source = request.url
            image = request.url.flatMap(localImage)
        }
        guard let url = request.url, !Task.isCancelled else { return }
        do {
            let downloaded = try await fetch(url, request.revision)
            guard current == generation, !Task.isCancelled else { return }
            image = downloaded
        } catch {
            // Conservar el respaldo local; un cambio de URL o refresco reintenta.
        }
    }
}

struct CachedAsyncImage<Placeholder: View>: View {
    let url: URL?
    let placeholder: Placeholder
    @State private var state: CachedImageState

    init(url: URL?, state: CachedImageState = CachedImageState(), @ViewBuilder placeholder: () -> Placeholder) {
        self.url = url
        _state = State(initialValue: state)
        self.placeholder = placeholder()
    }

    var body: some View {
        let request = ImageRequest(url: url, revision: ImageRefresh.shared.revision)
        Group {
            if let image = state.image {
                Image(uiImage: image).resizable()
            } else {
                placeholder
            }
        }
        .task(id: request) { await state.load(request) }
    }
}

// MARK: - Caché y deduplicación

actor ImageLoader {
    static let shared = ImageLoader()
    private let session: URLSession
    private let persist: Bool
    private var inFlight: [ImageRequest: Task<Download, Error>] = [:]
    private var latestRevision: [URL: Int] = [:]
    private var cache: [URL: Entry] = [:]
    private struct Entry {
        let image: UIImage
        let revision: Int
        let savedAt: Date
    }
    private struct Download {
        let image: UIImage
        let data: Data
    }

    init(session: URLSession = ImageLoader.makeSession(), persist: Bool = true) {
        self.session = session
        self.persist = persist
    }

    private static func makeSession() -> URLSession {
        let config = URLSessionConfiguration.default
        config.urlCache = URLCache(memoryCapacity: 10 * 1024 * 1024, diskCapacity: 50 * 1024 * 1024)
        config.httpMaximumConnectionsPerHost = 4
        config.requestCachePolicy = .useProtocolCachePolicy
        config.timeoutIntervalForRequest = 30
        config.timeoutIntervalForResource = 60
        return URLSession(configuration: config)
    }

    func image(for url: URL, revision: Int) async throws -> UIImage {
        if let entry = cache[url], entry.revision == revision, Date().timeIntervalSince(entry.savedAt) < 3600 {
            return entry.image
        }
        let key = ImageRequest(url: url, revision: revision)
        if let existing = inFlight[key] { return try await existing.value.image }
        latestRevision[url] = max(revision, latestRevision[url] ?? revision)
        let session = session
        let task = Task<Download, Error> {
            let request = URLRequest(url: url, cachePolicy: revision == 0 ? .useProtocolCachePolicy : .reloadIgnoringLocalCacheData, timeoutInterval: 30)
            let (data, response) = try await session.data(for: request)
            if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
                throw URLError(.badServerResponse)
            }
            guard let image = UIImage(data: data) else { throw URLError(.cannotDecodeContentData) }
            return Download(image: image, data: data)
        }
        inFlight[key] = task
        defer { inFlight[key] = nil }
        let downloaded = try await task.value
        if latestRevision[url] == revision {
            if cache.count >= 200, let oldest = cache.min(by: { $0.value.savedAt < $1.value.savedAt })?.key { cache[oldest] = nil }
            cache[url] = Entry(image: downloaded.image, revision: revision, savedAt: Date())
            if persist, !url.isFileURL {
                await CacheManager.shared.saveLogoData(downloaded.data, remoteURL: url)
            }
        }
        return downloaded.image
    }
}
