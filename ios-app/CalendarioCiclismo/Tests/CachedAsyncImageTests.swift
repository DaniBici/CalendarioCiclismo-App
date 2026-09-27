import XCTest
import SwiftUI
@testable import CalendarioCiclismo

final class CachedAsyncImageTests: XCTestCase {
    @MainActor
    func testMountedViewReloadsChangedURLAfterSuccess() async {
        await checkMountedURLChange(failingFirst: false)
    }

    @MainActor
    func testMountedViewReloadsChangedURLAfterFailure() async {
        await checkMountedURLChange(failingFirst: true)
    }

    @MainActor
    private func checkMountedURLChange(failingFirst: Bool) async {
        let first = expectation(description: "Primera carga")
        let second = expectation(description: "URL actualizada")
        let oldURL = URL(string: "https://example.org/old.webp")!
        let newURL = URL(string: "https://example.org/new.webp")!
        let newImage = UIImage()
        let source = ImageSource(url: oldURL)
        let state = CachedImageState(fetch: { url, _ in
            if url == oldURL {
                first.fulfill()
                if failingFirst { throw URLError(.badServerResponse) }
                return UIImage()
            }
            second.fulfill()
            return newImage
        }, localImage: { _ in nil })
        let host = UIHostingController(rootView: ImageHarness(source: source, state: state))
        let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 100, height: 100))
        window.rootViewController = host
        window.isHidden = false
        defer { window.isHidden = true; window.rootViewController = nil }
        await fulfillment(of: [first], timeout: 3)
        // El cambio ocurre con la rama de éxito/error ya presentada.
        await Task.yield()
        source.url = newURL
        await fulfillment(of: [second], timeout: 3)
        await Task.yield()
        XCTAssertTrue(state.image === newImage)
    }

    @MainActor
    func testManualRefreshRetriesSameURLAndKeepsOfflineFallback() async {
        let url = URL(string: "https://example.org/logo.webp")!
        let fallback = UIImage()
        let updated = UIImage()
        let firstFailed = expectation(description: "Fallo inicial")
        let refreshed = expectation(description: "Logo reintentado")
        var revisions: [Int] = []
        let state = CachedImageState(fetch: { _, revision in
            revisions.append(revision)
            if revisions.count == 1 { firstFailed.fulfill(); throw URLError(.notConnectedToInternet) }
            refreshed.fulfill()
            return updated
        }, localImage: { _ in fallback })
        let source = ImageSource(url: url)
        let host = UIHostingController(rootView: ImageHarness(source: source, state: state))
        let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 100, height: 100))
        window.rootViewController = host
        window.isHidden = false
        defer { window.isHidden = true; window.rootViewController = nil }
        // Completar el primer intento antes de invalidar la imagen montada.
        await fulfillment(of: [firstFailed], timeout: 3)
        await Task.yield()
        XCTAssertTrue(state.image === fallback)
        ImageRefresh.shared.refresh()
        await fulfillment(of: [refreshed], timeout: 3)
        await Task.yield()
        XCTAssertTrue(state.image === updated)
        XCTAssertGreaterThan(revisions.last!, revisions.first!)
    }

    @MainActor
    func testLateResponseCannotRestorePreviousLogo() async {
        let started = expectation(description: "Petición anterior en curso")
        let oldURL = URL(string: "https://example.org/old.webp")!
        let newURL = URL(string: "https://example.org/new.webp")!
        let updated = UIImage()
        var pending: CheckedContinuation<UIImage, Error>?
        let state = CachedImageState(fetch: { url, _ in
            if url == oldURL {
                return try await withCheckedThrowingContinuation { pending = $0; started.fulfill() }
            }
            return updated
        }, localImage: { _ in nil })
        let previous = Task { await state.load(ImageRequest(url: oldURL, revision: 0)) }
        await fulfillment(of: [started], timeout: 3)
        await state.load(ImageRequest(url: newURL, revision: 0))
        pending?.resume(returning: UIImage())
        await previous.value
        XCTAssertTrue(state.image === updated)
    }

    @MainActor
    func testLoaderUsesNewRequestWhenRevisionChanges() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [LogoURLProtocol.self]
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel() }
        let loader = ImageLoader(session: session, persist: false)
        let url = URL(string: "https://example.org/\(UUID().uuidString).png")!
        _ = try await loader.image(for: url, revision: 0)
        _ = try await loader.image(for: url, revision: 0)
        _ = try await loader.image(for: url, revision: 1)
        let policies = LogoURLProtocol.requests.policies(for: url)
        XCTAssertEqual(policies, [.useProtocolCachePolicy, .reloadIgnoringLocalCacheData])
    }
}

@MainActor @Observable
private final class ImageSource {
    var url: URL
    init(url: URL) { self.url = url }
}

private struct ImageHarness: View {
    let source: ImageSource
    let state: CachedImageState
    var body: some View {
        CachedAsyncImage(url: source.url, state: state) { Color.clear }
    }
}

private final class LogoRequests: @unchecked Sendable {
    private let lock = NSLock()
    private var requests: [URLRequest] = []
    func record(_ request: URLRequest) {
        lock.lock(); defer { lock.unlock() }
        requests.append(request)
    }
    func policies(for url: URL) -> [URLRequest.CachePolicy] {
        lock.lock(); defer { lock.unlock() }
        return requests.filter { $0.url == url }.map(\.cachePolicy)
    }
}

private final class LogoURLProtocol: URLProtocol, @unchecked Sendable {
    static let requests = LogoRequests()
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Self.requests.record(request)
        let data = Data(base64Encoded: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aO1sAAAAASUVORK5CYII=")!
        let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: ["Content-Type": "image/png"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: data)
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}
