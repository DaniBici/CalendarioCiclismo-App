import SwiftUI

/// Renderiza Markdown sin mover cierres malformados a texto adyacente.
struct MarkdownText: View {
    let source: String
    init(_ source: String) { self.source = source }

    private static func append(_ text: String, intent: InlinePresentationIntent? = nil, underline: Bool = false, to result: inout AttributedString) {
        var piece = AttributedString(text)
        if let intent { piece.inlinePresentationIntent = intent }
        if underline { piece.underlineStyle = .single }
        result.append(piece)
    }

    private static func parseInline(_ source: String) -> AttributedString {
        var result = AttributedString()
        var index = source.startIndex
        while index < source.endIndex {
            let tail = source[index...]
            let marker: String
            let intent: InlinePresentationIntent?
            let underline: Bool
            if tail.hasPrefix("**") { marker = "**"; intent = .stronglyEmphasized; underline = false }
            else if tail.hasPrefix("__") { marker = "__"; intent = nil; underline = true }
            else if tail.hasPrefix("*") { marker = "*"; intent = .emphasized; underline = false }
            else if tail.hasPrefix("_") { marker = "_"; intent = .emphasized; underline = false }
            else { let next = source.index(after: index); append(String(source[index..<next]), to: &result); index = next; continue }
            let contentStart = source.index(index, offsetBy: marker.count)
            guard let close = source.range(of: marker, range: contentStart..<source.endIndex)?.lowerBound else {
                append(marker, to: &result); index = contentStart; continue
            }
            append(String(source[contentStart..<close]), intent: intent, underline: underline, to: &result)
            index = source.index(close, offsetBy: marker.count)
        }
        return result
    }

    private var attributedString: AttributedString {
        var result = AttributedString()
        var appended = false
        for paragraph in source.components(separatedBy: "\n\n") {
            let trimmed = paragraph.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty else { continue }
            if appended { result.append(AttributedString("\n\n")) }
            result.append(Self.parseInline(trimmed))
            appended = true
        }
        return result
    }
    var body: some View { Text(attributedString) }
}
