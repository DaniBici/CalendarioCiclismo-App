import ImageIO
import UniformTypeIdentifiers
import UserNotifications

final class NotificationService: UNNotificationServiceExtension, @unchecked Sendable {

    private var contentHandler: ((UNNotificationContent) -> Void)?
    private var bestAttemptContent: UNMutableNotificationContent?

    override func didReceive(
        _ request: UNNotificationRequest,
        withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void
    ) {
        self.contentHandler = contentHandler
        self.bestAttemptContent = request.content.mutableCopy() as? UNMutableNotificationContent

        guard
            let imageUrlString = request.content.userInfo["imageUrl"] as? String,
            let imageUrl = URL(string: imageUrlString)
        else {
            if let bestAttemptContent = bestAttemptContent {
                contentHandler(bestAttemptContent)
            } else {
                contentHandler(request.content)
            }
            return
        }

        downloadAndAttachImage(from: imageUrl)
    }

    override func serviceExtensionTimeWillExpire() {
        // El sistema llama a este método cuando se agota el límite de 30 s.
        // Entregamos la notificación sin imagen para que no se pierda.
        if let contentHandler = contentHandler, let bestAttemptContent = bestAttemptContent {
            contentHandler(bestAttemptContent)
        }
    }

    private func downloadAndAttachImage(from url: URL) {
        var request = URLRequest(url: url)
        // Timeout explícito: la extensión tiene ~30 s en total; dejamos 10 s
        // para la descarga y el resto para procesar y llamar al contentHandler.
        request.timeoutInterval = 10

        URLSession.shared.dataTask(with: request) { [weak self] data, response, error in
            guard let self else { return }

            defer {
                if let contentHandler = self.contentHandler,
                   let bestAttemptContent = self.bestAttemptContent {
                    contentHandler(bestAttemptContent)
                }
            }

            #if DEBUG
            if let error {
                print("[NotificationService] Error descargando imagen: \(error.localizedDescription)")
            }
            #endif

            guard
                let data,
                (response as? HTTPURLResponse)?.statusCode == 200,
                let bestAttemptContent = self.bestAttemptContent,
                let fileURL = Self.writeAttachmentFile(from: data)
            else {
                return
            }

            do {
                bestAttemptContent.attachments = [
                    try UNNotificationAttachment(identifier: "image", url: fileURL, options: nil)
                ]
            } catch {
                #if DEBUG
                print("[NotificationService] Error adjuntando imagen: \(error.localizedDescription)")
                #endif
            }
        }.resume()
    }

    /// Lado largo máximo del adjunto. La extensión de notificaciones tiene un
    /// límite de memoria de unos 24 MB: decodificar un PNG completo con
    /// `UIImage` y recodificarlo la agotaba con capturas de varios MB.
    private static let maxPixelSize = 1200

    /// Reduce la imagen con ImageIO (sin `UIImage`) y la guarda como JPEG.
    /// Si la conversión falla, adjunta el original cuando es JPEG o PNG.
    private static func writeAttachmentFile(from data: Data) -> URL? {
        let directory = FileManager.default.temporaryDirectory
        if let jpeg = downsampledJPEG(from: data) {
            let url = directory.appendingPathComponent(UUID().uuidString).appendingPathExtension("jpg")
            if (try? jpeg.write(to: url)) != nil { return url }
        }

        let signature = [UInt8](data.prefix(4))
        let ext: String
        if signature == [0x89, 0x50, 0x4E, 0x47] {
            ext = "png"
        } else if signature.starts(with: [0xFF, 0xD8]) {
            ext = "jpg"
        } else {
            return nil
        }
        let url = directory.appendingPathComponent(UUID().uuidString).appendingPathExtension(ext)
        return (try? data.write(to: url)) != nil ? url : nil
    }

    private static func downsampledJPEG(from data: Data) -> Data? {
        let sourceOptions = [kCGImageSourceShouldCache: false] as CFDictionary
        guard let source = CGImageSourceCreateWithData(data as CFData, sourceOptions) else { return nil }

        let thumbnailOptions: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceShouldCacheImmediately: true,
            kCGImageSourceThumbnailMaxPixelSize: maxPixelSize,
        ]
        guard let thumbnail = CGImageSourceCreateThumbnailAtIndex(
            source, 0, thumbnailOptions as CFDictionary
        ) else { return nil }

        // El JPEG no admite transparencia: se compone sobre blanco en sRGB.
        guard
            let colorSpace = CGColorSpace(name: CGColorSpace.sRGB),
            let context = CGContext(
                data: nil,
                width: thumbnail.width,
                height: thumbnail.height,
                bitsPerComponent: 8,
                bytesPerRow: 0,
                space: colorSpace,
                bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue
            )
        else { return nil }
        let rect = CGRect(x: 0, y: 0, width: thumbnail.width, height: thumbnail.height)
        context.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
        context.fill(rect)
        context.draw(thumbnail, in: rect)
        guard let flattened = context.makeImage() else { return nil }

        let output = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(
            output, UTType.jpeg.identifier as CFString, 1, nil
        ) else { return nil }
        CGImageDestinationAddImage(
            destination,
            flattened,
            [kCGImageDestinationLossyCompressionQuality: 0.8] as CFDictionary
        )
        guard CGImageDestinationFinalize(destination) else { return nil }
        return output as Data
    }
}
