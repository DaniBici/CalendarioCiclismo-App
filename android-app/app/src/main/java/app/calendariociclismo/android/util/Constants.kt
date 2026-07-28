package app.calendariociclismo.android.util

import android.content.Context
import androidx.annotation.StringRes
import app.calendariociclismo.android.R

/**
 * Constantes compartidas — port literal de `ios-app/.../Services/Constants.swift`
 * y `js/services/constants.js`.
 */
object Constants {
    // ── Categorías UCI ────────────────────────────────────────────

    /** Orden de importancia de las categorías UCI (menor = más importante). */
    val UCI_ORDER: Map<String, Double> = mapOf(
        "WC" to 1.0, "CC" to 2.0,
        "1.UWT" to 3.0, "2.UWT" to 4.0,
        "CN" to 4.5,
        "1.WWT" to 5.0, "2.WWT" to 6.0,
        "1.Pro" to 7.0, "2.Pro" to 8.0,
        "1.1" to 9.0, "2.1" to 10.0,
        "1.2" to 11.0, "2.2" to 12.0, "1.2U" to 13.0, "2.2U" to 14.0,
    )

    /** Agrupación de categorías por tier. */
    val CATEGORY_TIERS: Map<String, List<String>> = mapOf(
        "WC" to listOf("WC", "CC"),
        "WT" to listOf("1.UWT", "2.UWT", "1.WWT", "2.WWT"),
        "PRO" to listOf("1.Pro", "2.Pro", "1.1", "2.1"),
        "MINOR" to listOf("1.2", "2.2", "1.2U", "2.2U"),
    )

    // ── Tipos de etapa ────────────────────────────────────────────

    val TYPE_LABEL_RES: Map<String, Int> = mapOf(
        "flat" to R.string.stage_type_flat,
        "rolling" to R.string.stage_type_rolling,
        "cotas" to R.string.stage_type_cotas,
        "medium_mountain" to R.string.stage_type_medium_mountain,
        "high_mountain" to R.string.stage_type_high_mountain,
        "cobbles" to R.string.stage_type_cobbles,
        "sterrato" to R.string.stage_type_sterrato,
        "itt" to R.string.stage_type_itt,
        "ttt" to R.string.stage_type_ttt,
        "summit_finish" to R.string.stage_type_summit_finish,
        "uphill_finish" to R.string.stage_type_uphill_finish,
        "chrono_climb" to R.string.stage_type_chrono_climb,
    )

    /** Color hex por tipo de etapa (sin `#`). */
    val STAGE_COLORS: Map<String, Long> = mapOf(
        "flat" to 0xFF3DBA6F,
        "rolling" to 0xFFA8E6BC,
        "cotas" to 0xFFC7CF5E,
        "medium_mountain" to 0xFFE6B800,
        "high_mountain" to 0xFFE63D3D,
        "cobbles" to 0xFF8C8C8C,
        "sterrato" to 0xFFC4975A,
        "itt" to 0xFF1A5CA8,
        "ttt" to 0xFF6AAEE8,
        "chrono_climb" to 0xFF1A5CA8,
    )

    /** Etiqueta del tipo de etapa en el idioma activo. */
    fun stageTypeLabel(context: Context, type: String?): String {
        val res = TYPE_LABEL_RES[type.orEmpty()] ?: return type.orEmpty()
        return context.getString(res)
    }

    // ── Estado de TV ──────────────────────────────────────────────

    val TV_STATUS_LABEL_RES: Map<String, Int> = mapOf(
        "pending" to R.string.tv_status_pending,
        "none" to R.string.tv_status_none,
        "unavailable_es" to R.string.tv_status_unavailable_es,
    )

    fun tvStatusLabel(context: Context, status: String?): String {
        val res = TV_STATUS_LABEL_RES[status.orEmpty()] ?: return status.orEmpty()
        return context.getString(res)
    }

    // ── Assets ────────────────────────────────────────────────────

    val ASSET_LABEL_RES: Map<String, Int> = mapOf(
        "startOrder" to R.string.asset_start_order,
        "technicalGuide" to R.string.asset_technical_guide,
        "roadbook" to R.string.asset_roadbook,
        "profile" to R.string.asset_profile,
        "ports" to R.string.asset_ports,
        "pave" to R.string.asset_pave,
        "map" to R.string.asset_map,
        "live_text" to R.string.asset_live_text,
    )

    fun assetLabel(context: Context, type: String?): String {
        val res = ASSET_LABEL_RES[type.orEmpty()] ?: return type.orEmpty()
        return context.getString(res)
    }

    val ASSET_ORDER: List<String> = listOf("technicalGuide", "startOrder", "roadbook", "profile", "ports", "map", "live_text")

    // ── Países ────────────────────────────────────────────────────

    val EUROPE_COUNTRIES: Set<String> = setOf(
        "AD", "AL", "AT", "BA", "BE", "BG", "BY", "CH", "CY", "CZ", "DE", "DK", "EE", "ES",
        "FI", "FR", "GB", "GR", "HR", "HU", "IE", "IS", "IT", "LI", "LT", "LU", "LV", "MC",
        "MD", "ME", "MK", "MT", "NL", "NO", "PL", "PT", "RO", "RS", "RU", "SE", "SI", "SK",
        "SM", "TR", "UA", "VA", "XK",
    )

    val ASIA_1_COUNTRIES: Set<String> = setOf("CN", "TH", "JP", "TW", "KR", "HK", "AZ")

    // ── Filtros de categoría ──────────────────────────────────────

    enum class CategoryFilter(val id: String, @StringRes val labelRes: Int) {
        ALL("all", R.string.filter_all),
        PRO("pro", R.string.filter_pro),
        UWT("uwt", R.string.filter_uwt),
        WWT("wwt", R.string.filter_wwt),
        MALE("male", R.string.filter_male),
        FEMALE("female", R.string.filter_female);
    }
}
