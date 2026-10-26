package app.calendariociclismo.android.ui.components

import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.text
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.TextMeasurer
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextOverflow

/**
 * Texto de hasta dos líneas que nunca parte una palabra: la palabra que no cabe
 * en la primera línea pasa a la segunda y, si tampoco cabe allí, la segunda
 * línea termina en puntos suspensivos. Solo se admite corte entre palabras o
 * tras un guion. `Text` con `maxLines = 2` parte por caracteres la palabra más
 * ancha que la línea; por eso las líneas se componen aquí.
 */
@Composable
fun WholeWordText(
    text: String,
    style: TextStyle,
    modifier: Modifier = Modifier,
    fontWeight: FontWeight? = null,
) {
    val measurer = rememberTextMeasurer()
    val effectiveStyle = if (fontWeight != null) style.copy(fontWeight = fontWeight) else style
    BoxWithConstraints(modifier) {
        val maxWidthPx = constraints.maxWidth
        val lines = remember(text, effectiveStyle, maxWidthPx) {
            wholeWordLines(text, maxWidthPx, measurer, effectiveStyle)
        }
        Column(modifier = Modifier.clearAndSetSemantics { this.text = AnnotatedString(text) }) {
            lines.forEach { line ->
                Text(
                    text = line,
                    style = effectiveStyle,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}

/**
 * Reparte [text] en una o dos líneas por palabras enteras. La segunda línea
 * recoge todo el resto (el `Text` que la pinta la corta con puntos suspensivos).
 */
internal fun wholeWordLines(text: String, maxWidthPx: Int, measurer: TextMeasurer, style: TextStyle): List<String> {
    val clean = text.trim()
    if (clean.isEmpty() || maxWidthPx <= 0 || maxWidthPx == Int.MAX_VALUE) return listOf(clean)
    fun fits(s: String) = measurer.measure(s.trimEnd(), style, maxLines = 1, softWrap = false).size.width <= maxWidthPx
    if (fits(clean)) return listOf(clean)
    // Fragmentos que terminan en espacio o guion: puntos donde se permite cortar.
    val pieces = clean.split(Regex("(?<=[\\s-])"))
    var first = ""
    var index = 0
    while (index < pieces.size && fits(first + pieces[index])) {
        first += pieces[index]
        index++
    }
    // Ni la primera palabra cabe: se queda sola en la primera línea (con puntos suspensivos).
    if (index == 0) return listOf(pieces[0].trimEnd(), pieces.drop(1).joinToString("")).filter { it.isNotBlank() }
    val rest = pieces.drop(index).joinToString("")
    return listOf(first.trimEnd(), rest).filter { it.isNotBlank() }
}
