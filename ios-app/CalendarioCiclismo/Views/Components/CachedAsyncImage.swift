import SwiftUI

/// Carga imágenes remotas con caché en memoria y deduplicación de peticiones,
/// evitando los avisos `nw_connection` que produce `AsyncImage` al cancelar conexiones.
struct CachedAsyncImage<Placeholder: View>: View {
    let url: URL?
    let placeholder: Placeholder

    @State private var image: UIImage?
    @State private var failed = false

    init(url: URL?, @ViewBuilder placeholder: () -> Placeholder) {
        self.url = url
        self.placeholder = placeholder()
    }

    var body: some View {
        if let image {
            Image(uiImage: image)
                .resizable()
        } else if failed {
            placeholder
        } else {
            placeholder
                .task(id: url) {
                    await load()
                }
        }
    }

    private func load() async {
        guard let url else { failed = true; return }

        // Check memory cache first
        if let cached = ImageCache.shared[url] {
            self.image = cached
            return
        }

        // Bail out early if the task was already cancelled (e.g. fast scroll)
        guard !Task.isCancelled else { return }

        do {
            // Deduplicated fetch — multiple views requesting the same URL share one download
            let downloaded = try await ImageLoader.shared.image(for: url)
            ImageCache.shared[url] = downloaded
            self.image = downloaded
        } catch is CancellationError {
            // View disappeared — no action needed
        } catch {
            failed = true
        }
    }
}

// MARK: - Request deduplication

/// Ensures only one in-flight URLSession task exists per URL.
/// Additional callers for the same URL await the existing download instead of
/// opening a new TCP connection, which eliminates the `nw_connection` warnings
/// caused by redundant handshakes being cancelled.
private actor ImageLoader {
    static let shared = ImageLoader()

    private var inFlight: [URL: Task<UIImage, Error>] = [:]

    func image(for url: URL) async throws -> UIImage {
        // If a download is already running for this URL, piggy-back on it
        if let existing = inFlight[url] {
            return try await existing.value
        }

        let task = Task<UIImage, Error> {
            let request = URLRequest(
                url: url,
                cachePolicy: .returnCacheDataElseLoad,
                timeoutInterval: 30
            )
            let (data, _) = try await ImageCache.session.data(for: request)
            guard let img = UIImage(data: data) else {
                throw URLError(.cannotDecodeContentData)
            }
            return img
        }

        inFlight[url] = task
        defer { inFlight[url] = nil }

        return try await task.value
    }
}

// MARK: - Image cache

/// Caché de imágenes en memoria con URLSession configurada para disco.
private final class ImageCache: @unchecked Sendable {
    static let shared = ImageCache()

    /// URLSession con caché en disco de 50 MB, máximo 4 conexiones por host.
    static let session: URLSession = {
        let config = URLSessionConfiguration.default
        config.urlCache = URLCache(
            memoryCapacity: 10 * 1024 * 1024,   // 10 MB RAM
            diskCapacity: 50 * 1024 * 1024       // 50 MB disco
        )
        config.httpMaximumConnectionsPerHost = 4
        config.waitsForConnectivity = true
        config.requestCachePolicy = .returnCacheDataElseLoad
        config.timeoutIntervalForRequest = 30
        config.timeoutIntervalForResource = 60
        return URLSession(configuration: config)
    }()

    private let cache = NSCache<NSURL, UIImage>()

    private init() {
        cache.countLimit = 200
    }

    subscript(url: URL) -> UIImage? {
        get { cache.object(forKey: url as NSURL) }
        set {
            if let newValue {
                cache.setObject(newValue, forKey: url as NSURL)
            } else {
                cache.removeObject(forKey: url as NSURL)
            }
        }
    }
}
