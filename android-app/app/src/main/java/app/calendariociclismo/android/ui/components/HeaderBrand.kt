package app.calendariociclismo.android.ui.components

import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.width
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.calendariociclismo.android.R

private val GoogleSansMedium = FontFamily(
    Font(R.font.google_sans_medium, weight = FontWeight.Medium),
)

/** Símbolos de Calendario Ciclismo sin fondo ni tratamiento de botón. */
@Composable
fun CCHeaderMark(
    modifier: Modifier = Modifier,
    width: Dp = 46.dp,
) {
    Image(
        painter = painterResource(R.drawable.ic_cc_header),
        contentDescription = null,
        modifier = modifier
            .width(width)
            .height(width * 32f / 74f),
    )
}

/** Firma completa de la cabecera de Hoy, equivalente a la marca de la web. */
@Composable
fun CCHeaderBrand(
    modifier: Modifier = Modifier,
    title: String = "Calendario Ciclismo",
    markWidth: Dp = 60.dp,
) {
    Row(
        modifier = modifier,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        CCHeaderMark(width = markWidth)
        Text(
            text = title,
            color = MaterialTheme.colorScheme.onSurface,
            fontFamily = GoogleSansMedium,
            fontWeight = FontWeight.Medium,
            fontSize = 18.sp,
            lineHeight = 22.sp,
            maxLines = 1,
            overflow = TextOverflow.Clip,
        )
    }
}
