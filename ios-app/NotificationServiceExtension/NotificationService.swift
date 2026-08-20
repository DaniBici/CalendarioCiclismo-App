import UserNotifications
import UIKit

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

        URLSession.shared.dataTask(with: request) { [weak self] data, _, error in
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
                let image = UIImage(data: data),
                let jpegData = image.jpegData(compressionQuality: 0.8),
                let bestAttemptContent = self.bestAttemptContent
            else {
                return
            }

            let tmpURL = FileManager.default.temporaryDirectory
                .appendingPathComponent(UUID().uuidString)
                .appendingPathExtension("jpg")

            do {
                try jpegData.write(to: tmpURL)
                let attachment = try UNNotificationAttachment(
                    identifier: "image",
                    url: tmpURL,
                    options: nil
                )
                bestAttemptContent.attachments = [attachment]
            } catch {
                #if DEBUG
                print("[NotificationService] Error adjuntando imagen: \(error.localizedDescription)")
                #endif
            }
        }.resume()
    }
}
