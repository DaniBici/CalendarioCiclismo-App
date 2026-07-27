package app.calendariociclismo.android.ui.components

import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withStyle

/**
 * Renderiza texto Markdown básico (negrita, cursiva, subrayado) usando AnnotatedString.
 *
 * Port de MarkdownText.swift (iOS). Procesa párrafo a párrafo para evitar
 * fallos cuando las marcas cruzan saltos de línea. Soporta:
 *   **negrita**   → FontWeight.Bold
 *   *cursiva*     → FontStyle.Italic
 *   _cursiva_     → FontStyle.Italic
 *   __subrayado__ → TextDecoration.Underline
 */
@Composable
fun MarkdownText(
    source: String,
    modifier: Modifier = Modifier,
    style: TextStyle = LocalTextStyle.current,
    color: Color = Color.Unspecified,
) {
    val annotated = remember(source) { buildMarkdownAnnotatedString(source) }
    Text(
        text = annotated,
        modifier = modifier,
        style = style,
        color = color,
    )
}

// ─── Parser ───────────────────────────────────────────────────────────────────

/**
 * Divide el texto en párrafos, normaliza marcas `**` mal colocadas y
 * parsea el Markdown inline de cada párrafo en un AnnotatedString.
 */
fun buildMarkdownAnnotatedString(source: String): AnnotatedString {
    val paragraphs = source.split("\n\n")
    return buildAnnotatedString {
        paragraphs.forEachIndexed { index, paragraph ->
            val trimmed = paragraph.trim()
            if (trimmed.isEmpty()) return@forEachIndexed
            append(parseInline(trimmed))
            if (index < paragraphs.lastIndex) append("\n\n")
        }
    }
}

/**
 * Normaliza marcas `**` con espacios internos, igual que en iOS.
 * Ejemplo: `** texto **` → `**texto**`
 */
private val boldRegex = Regex("""\*\*((?:(?!\*\*)[\s\S])+?)\*\*""")

private fun normalizeMarkdown(text: String): String {
    return boldRegex.replace(text) { match ->
        val content = match.groupValues[1]
        val trimmed = content.trim()
        if (trimmed.isEmpty() || trimmed == content) return@replace match.value

        var replacement = "**$trimmed**"

        // Preservar separación de palabra si había espacio al inicio
        if (content.first().isWhitespace() && match.range.first > 0) {
            val before = text[match.range.first - 1]
            if (!before.isWhitespace()) replacement = " $replacement"
        }

        // Preservar separación de palabra si había espacio al final
        val afterPos = match.range.last + 1
        if (content.last().isWhitespace() && afterPos < text.length) {
            val after = text[afterPos]
            if (!after.isWhitespace()) replacement += " "
        }

        replacement
    }
}

/**
 * Parsea Markdown inline en un AnnotatedString.
 * Comprueba `**` antes de `*`, y `__` antes de `_`, para evitar
 * conflictos entre los delimitadores de dos caracteres y los de uno.
 */
private fun parseInline(text: String): AnnotatedString = buildAnnotatedString {
    var i = 0
    while (i < text.length) {
        when {
            text.startsWith("**", i) -> {
                val end = text.indexOf("**", i + 2)
                if (end != -1) {
                    withStyle(SpanStyle(fontWeight = FontWeight.Bold)) {
                        append(text.substring(i + 2, end))
                    }
                    i = end + 2
                } else {
                    append(text[i]); i++
                }
            }
            text.startsWith("__", i) -> {
                val end = text.indexOf("__", i + 2)
                if (end != -1) {
                    withStyle(SpanStyle(textDecoration = TextDecoration.Underline)) {
                        append(text.substring(i + 2, end))
                    }
                    i = end + 2
                } else {
                    append(text[i]); i++
                }
            }
            text[i] == '*' -> {
                val end = text.indexOf('*', i + 1)
                if (end != -1) {
                    withStyle(SpanStyle(fontStyle = FontStyle.Italic)) {
                        append(text.substring(i + 1, end))
                    }
                    i = end + 1
                } else {
                    append(text[i]); i++
                }
            }
            text[i] == '_' -> {
                val end = text.indexOf('_', i + 1)
                if (end != -1) {
                    withStyle(SpanStyle(fontStyle = FontStyle.Italic)) {
                        append(text.substring(i + 1, end))
                    }
                    i = end + 1
                } else {
                    append(text[i]); i++
                }
            }
            else -> {
                append(text[i]); i++
            }
        }
    }
}
