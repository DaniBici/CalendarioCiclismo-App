import SwiftUI

/// Renderiza texto Markdown básico (negrita, cursiva, subrayado) usando AttributedString.
/// Procesa párrafo a párrafo para evitar fallos cuando las marcas `**` cruzan saltos de línea.
struct MarkdownText: View {
    let source: String

    init(_ source: String) {
        self.source = source
    }

    /// Normaliza marcas `**` mal colocadas recortando espacios internos en cada par `**…**`.
    /// Ejemplos:
    ///   `**texto **siguiente`  → `**texto** siguiente`
    ///   `palabra** texto**`    → `palabra **texto**`
    ///   `** texto **`          → `**texto**`
    private static func normalizeMarkdown(_ text: String) -> String {
        guard let regex = try? NSRegularExpression(
            pattern: #"\*\*((?:(?!\*\*)[\s\S])+?)\*\*"#
        ) else { return text }

        let nsText = text as NSString
        let matches = regex.matches(
            in: text,
            range: NSRange(location: 0, length: nsText.length)
        )

        var result = text

        for match in matches.reversed() {
            let fullRange = match.range
            let contentRange = match.range(at: 1)
            let content = nsText.substring(with: contentRange)
            let trimmed = content.trimmingCharacters(in: .whitespaces)

            guard !trimmed.isEmpty, trimmed != content else { continue }

            var replacement = "**\(trimmed)**"

            // Si había espacio al inicio del contenido, preservar separación de palabras
            if content.first?.isWhitespace == true, fullRange.location > 0 {
                let before = nsText.substring(
                    with: NSRange(location: fullRange.location - 1, length: 1)
                )
                if before.rangeOfCharacter(from: .whitespacesAndNewlines) == nil {
                    replacement = " " + replacement
                }
            }

            // Si había espacio al final del contenido, preservar separación de palabras
            let afterPos = fullRange.location + fullRange.length
            if content.last?.isWhitespace == true, afterPos < nsText.length {
                let after = nsText.substring(
                    with: NSRange(location: afterPos, length: 1)
                )
                if after.rangeOfCharacter(from: .whitespacesAndNewlines) == nil {
                    replacement += " "
                }
            }

            result = (result as NSString).replacingCharacters(in: fullRange, with: replacement)
        }

        return result
    }

    private var attributedString: AttributedString {
        let paragraphs = source.components(separatedBy: "\n\n")
        var result = AttributedString()

        for (index, paragraph) in paragraphs.enumerated() {
            let trimmed = paragraph.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty else { continue }

            let normalized = Self.normalizeMarkdown(trimmed)

            if let parsed = try? AttributedString(
                markdown: normalized,
                options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)
            ) {
                result.append(parsed)
            } else {
                result.append(AttributedString(trimmed))
            }

            if index < paragraphs.count - 1 {
                result.append(AttributedString("\n\n"))
            }
        }

        return result
    }

    var body: some View {
        Text(attributedString)
    }
}
