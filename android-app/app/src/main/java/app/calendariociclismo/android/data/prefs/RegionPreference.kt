package app.calendariociclismo.android.data.prefs

/**
 * Bucket continental de la región del usuario.
 *
 * No se elige manualmente: se detecta a partir de la zona horaria del
 * dispositivo ([app.calendariociclismo.android.util.RegionDetector.suggestedRegion]).
 * Se conserva como valor de `push_subscriptions.region`, cuyo CHECK en la base
 * de datos acepta exactamente estos seis valores.
 */
enum class RegionPreference {
    SPAIN,
    EUROPE,
    AMERICAS,
    ASIA,
    AFRICA,
    ALL,
}
