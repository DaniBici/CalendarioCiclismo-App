package app.calendariociclismo.android.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import app.calendariociclismo.android.ui.theme.categoryBadgeColor
import app.calendariociclismo.android.util.LocaleHolder

/**
 * Badge de categoría UCI ("1.UWT", "WC", "1.Pro", …).
 *
 * Equivalente compose-nativo de `ios-app/.../Views/Components/CategoryBadge.swift`.
 */
@Composable
fun CategoryBadge(category: String?, modifier: Modifier = Modifier) {
    if (category.isNullOrBlank()) return
    val colors = categoryBadgeColor(category)
    Text(
        text = category.uppercase(LocaleHolder.currentState),
        style = MaterialTheme.typography.labelSmall,
        fontWeight = FontWeight.SemiBold,
        color = colors.foreground,
        modifier = modifier
            .background(
                color = colors.background,
                shape = RoundedCornerShape(3),
            )
            .padding(horizontal = 8.dp, vertical = 3.dp),
    )
}
