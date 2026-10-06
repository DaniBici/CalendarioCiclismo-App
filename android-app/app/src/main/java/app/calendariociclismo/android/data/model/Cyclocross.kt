package app.calendariociclismo.android.data.model

import kotlinx.serialization.KSerializer
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonDecoder
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.decodeFromJsonElement

@Serializable
data class CxTournament(
    val id: String,
    val name: String,
    val nameEn: String? = null,
    val slug: String,
    val colorHex: String? = null,
    val logoUrl: String? = null,
    val pointsScheme: JsonObject? = null,
    val seasonKey: String? = null,
)

@Serializable
data class CxStandingState(
    val category: String,
    val status: String,
    val roundIds: List<String> = emptyList(),
    /** Desglose por ronda de la general calculada; ausente en cachés antiguas. */
    @Serializable(with = CxBreakdownListSerializer::class) val breakdown: List<CxBreakdownEntry> = emptyList(),
)

@Serializable
data class CxBreakdownEntry(val globalRiderId: String, val eligible: Boolean? = null, val rounds: List<CxBreakdownRound> = emptyList())

@Serializable
data class CxBreakdownRound(
    val raceId: String,
    /** La base de datos lo publica como texto ("40") o como número. */
    @Serializable(with = CxLenientNumberSerializer::class) val points: Double? = null,
    val retained: Boolean? = null,
    val missing: Boolean? = null,
    val sourceRank: Int? = null,
)

/** Número tolerante: acepta número o texto JSON; lo no numérico queda en null. */
object CxLenientNumberSerializer : KSerializer<Double?> {
    override val descriptor: SerialDescriptor = JsonPrimitive.serializer().descriptor
    override fun deserialize(decoder: Decoder): Double? {
        val element = (decoder as? JsonDecoder)?.decodeJsonElement() ?: return decoder.decodeDouble()
        return (element as? JsonPrimitive)?.takeUnless { it is JsonNull }?.content?.trim()?.toDoubleOrNull()?.takeIf { it.isFinite() }
    }
    override fun serialize(encoder: Encoder, value: Double?) {
        JsonPrimitive.serializer().serialize(encoder, if (value == null) JsonNull else JsonPrimitive(value))
    }
}

/** Lista de desglose tolerante: un valor que no sea lista queda vacío y las
 *  entradas mal formadas se descartan sin invalidar el estado. */
object CxBreakdownListSerializer : KSerializer<List<CxBreakdownEntry>> {
    private val list = ListSerializer(CxBreakdownEntry.serializer())
    private val lenient = Json { ignoreUnknownKeys = true }
    override val descriptor: SerialDescriptor = list.descriptor
    override fun deserialize(decoder: Decoder): List<CxBreakdownEntry> {
        val element = (decoder as? JsonDecoder)?.decodeJsonElement() ?: return list.deserialize(decoder)
        return (element as? JsonArray)?.mapNotNull { entry ->
            runCatching { lenient.decodeFromJsonElement<CxBreakdownEntry>(entry) }.getOrNull()
        } ?: emptyList()
    }
    override fun serialize(encoder: Encoder, value: List<CxBreakdownEntry>) = list.serialize(encoder, value)
}

/** Fila mínima para numerar las rondas de un torneo; espejo del select ligero web. */
@Serializable
data class CxRoundEntry(val dateKey: String? = null, val startTimeUtc: String? = null)

@Serializable
data class CxRoundRow(
    val id: String,
    val tournamentId: String? = null,
    val dateKey: String,
    val seasonKey: String? = null,
    @SerialName("cx_race_categories") val categories: List<CxRoundEntry> = emptyList(),
)

/** Número de prueba de una carrera dentro de su torneo (1-indexado). */
data class CxRound(val n: Int, val total: Int)

@Serializable
data class CxCategory(
    val category: String,
    val startTimeUtc: String? = null,
    val dateKey: String? = null,
    val sortOrder: Int = 0,
    val isCancelled: Boolean = false,
    val resultsStatus: String = "pending",
    val winnerName: String? = null,
    val durationFormat: String? = null,
    val durationRuleVersion: String? = null,
    val durationMinutes: Int? = null,
    val durationRuleSourceUrl: String? = null,
    val startlistImportedAt: String? = null,
)

/** Documento de carrera CX (Libro de Ruta / Mapa); espejo de `assets` con cxRaceId. */
@Serializable
data class CxAsset(
    val id: String? = null,
    val type: String? = null,
    val url: String? = null,
)

@Serializable
data class CxRace(
    val id: String,
    val name: String,
    val nameEn: String? = null,
    val abbrev: String? = null,
    val slug: String,
    val slugEn: String? = null,
    val seasonKey: String,
    val dateKey: String,
    val endDateKey: String? = null,
    @SerialName("class") val raceClass: String,
    val countryCode: String? = null,
    val venue: String? = null,
    val tournamentId: String? = null,
    val colorHex: String? = null,
    val logoUrl: String? = null,
    val websiteUrl: String? = null,
    val timezone: String? = null,
    val isCancelled: Boolean = false,
    val assets: List<CxAsset> = emptyList(),
    @SerialName("cx_tournaments") val tournament: CxTournament? = null,
    @SerialName("cx_race_categories") val categories: List<CxCategory> = emptyList(),
)

@Serializable
data class CxStartlistRider(
    val id: String,
    val raceId: String,
    val category: String,
    val bib: String? = null,
    val firstName: String,
    val lastName: String,
    val countryCode: String? = null,
    val teamId: String? = null,
    val globalRiderId: String? = null,
    val sortOrder: Int = 0,
)

@Serializable
data class CxTeam(
    val id: String,
    val name: String,
    val uciCode: String,
    val colorHex: String,
    val countryCode: String? = null,
    // Identidad cromática alineada con carretera (teams). Defaults = paleta
    // neutra de la base de datos: sin colores curados no se dibuja chapa.
    val headerBg: String = "#1f2937",
    val headerText: String = "#ffffff",
    val badgeTorsoCenter: String = "#ffffff",
    val badgeTorsoSides: String = "#000000",
    val badgeInnerCircle: String? = null,
    val badgeShorts: String = "#000000",
    val nameAliases: List<String>? = null,
) {
    /** Equipo en el modelo de carretera: resultados, generales y dorsales CX
     *  usan `findMatchingTeam`, `hasVisibleBadge` y `TeamColorBands` de ruta. */
    val roadTeam: Team
        get() = Team(
            id = id, name = name,
            badgeTorsoCenter = badgeTorsoCenter, badgeTorsoSides = badgeTorsoSides, badgeShorts = badgeShorts,
            badgeInnerCircle = badgeInnerCircle, headerBg = headerBg, headerText = headerText,
            nameAliases = nameAliases?.joinToString("\n"),
        )

    /** La chapa solo se muestra con colores de equipación curados (regla de carretera). */
    val hasVisibleBadge: Boolean get() = roadTeam.hasVisibleBadge
}

@Serializable
data class CxResult(
    val id: Long,
    val raceId: String,
    val category: String,
    val rank: Int? = null,
    val rankText: String? = null,
    val bib: String? = null,
    val riderDisplay: String,
    val teamName: String? = null,
    val isoCode2: String? = null,
    val timeText: String? = null,
    val gapText: String? = null,
    val points: Double? = null,
    val bonusPoints: Double? = null,
    val timeSeconds: Long? = null,
    val bonusSeconds: Int? = null,
    val irm: String? = null,
    val sortOrder: Int = 0,
)

@Serializable
data class CxStanding(
    val id: String,
    val tournamentId: String,
    val seasonKey: String,
    val category: String,
    val rank: Int,
    val riderDisplay: String,
    val teamName: String? = null,
    val isoCode2: String? = null,
    val points: Double? = null,
    val timeSeconds: Long? = null,
    val globalRiderId: String? = null,
)

@Serializable
data class CxBroadcast(
    val id: String,
    val raceId: String,
    val category: String? = null,
    val channel: String? = null,
    val startTimeUtc: String? = null,
    val url: String? = null,
    val note: String? = null,
    val country: String? = null,
    val sortOrder: Int = 0,
    val showInRevive: Boolean = false,
    val isSporza: Boolean = false,
)

@Serializable
data class CxVideo(
    val id: String,
    val raceId: String,
    val category: String? = null,
    val title: String,
    val titleEn: String? = null,
    val url: String,
    val sortOrder: Int = 0,
)

@Serializable
data class CxDetail(
    val race: CxRace,
    val startlist: List<CxStartlistRider> = emptyList(),
    val results: List<CxResult> = emptyList(),
    val broadcasts: List<CxBroadcast> = emptyList(),
    val videos: List<CxVideo> = emptyList(),
    val teams: List<CxTeam> = emptyList(),
    val standings: List<CxStanding> = emptyList(),
    val standingsState: List<CxStandingState> = emptyList(),
    val assets: List<CxAsset> = emptyList(),
)

/** Clasificaciones generales de un torneo y lo necesario para pintarlas:
 *  catálogo de equipos y carreras de sus rondas (nombre y enlace de columna). */
data class CxTournamentGeneral(
    val tournament: CxTournament?,
    val states: List<CxStandingState>,
    val standings: List<CxStanding>,
    val teams: List<CxTeam>,
    val races: List<CxRace>,
)
