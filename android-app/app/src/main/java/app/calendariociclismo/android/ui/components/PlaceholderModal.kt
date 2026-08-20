package app.calendariociclismo.android.ui.components

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import android.content.Intent
import android.net.Uri
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.outlined.Language
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.core.net.toUri
import app.calendariociclismo.android.R
import app.calendariociclismo.android.data.model.Race
import app.calendariociclismo.android.data.model.RaceDay
import app.calendariociclismo.android.util.DateFormatting

/** Datos necesarios para mostrar el modal de placeholder. */
data class PlaceholderItem(
    val race: Race,
    val raceDay: RaceDay?,
    val websiteUrl: String? = null,
)

/**
 * Modal para carreras/jornadas sin información detallada (placeholders).
 * Equivalente al `PlaceholderModal.swift` de iOS.
 */
@Composable
fun PlaceholderModal(item: PlaceholderItem, onDismiss: () -> Unit) {
    val race = item.race
    val rd = item.raceDay
    val context = LocalContext.current

    val message = when {
        rd?.isCancelledDay == true -> stringResource(R.string.placeholder_cancelled_stage)
        race.isCancelled -> stringResource(R.string.placeholder_cancelled_race)
        else -> {
            val today = DateFormatting.todayKey()
            val dateKey = rd?.dateKey ?: race.startDate ?: ""
            if (today < dateKey) stringResource(R.string.placeholder_future_no_info)
            else stringResource(R.string.placeholder_no_info)
        }
    }

    val dateText = if (rd != null) {
        DateFormatting.formatDateLong(rd.dateKey)
    } else {
        DateFormatting.formatDateRange(race.startDate, race.endDate)
    }
    val detail = listOfNotNull(rd?.stageLabel?.takeIf { it.isNotEmpty() }, dateText.takeIf { it.isNotEmpty() })
        .joinToString(" · ")
    val websiteUrl = item.websiteUrl

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(race.localizedName) },
        text = { Text(if (detail.isEmpty()) message else "$detail\n\n$message") },
        confirmButton = {
            TextButton(onClick = onDismiss) { Text(stringResource(R.string.action_close)) }
        },
        dismissButton = {
            if (!websiteUrl.isNullOrEmpty()) {
                TextButton(onClick = {
                    runCatching {
                        context.startActivity(Intent(Intent.ACTION_VIEW, websiteUrl.toUri()))
                    }
                }) {
                    Text(stringResource(R.string.stage_doc_web_official))
                }
            }
        },
    )
}

/**
 * Invoca el diálogo nativo de Material cuando hay un placeholder seleccionado.
 */
@Composable
fun PlaceholderModalOverlay(item: PlaceholderItem?, onDismiss: () -> Unit) {
    item?.let { PlaceholderModal(item = it, onDismiss = onDismiss) }
}
