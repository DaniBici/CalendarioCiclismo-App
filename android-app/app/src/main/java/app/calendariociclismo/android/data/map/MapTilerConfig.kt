package app.calendariociclismo.android.data.map

/**
 * Configuración del proveedor de tiles del mapa del recorrido.
 *
 * Migrado de MapTiler a **OpenFreeMap** (2026-06-19): MapTiler invalidó la API key
 * por exceso de uso. OpenFreeMap sirve un style.json VECTOR completo SIN API KEY y
 * con uso comercial permitido (https://openfreemap.org) → no hay clave que rotar ni
 * cuota que agotar. Mismo lenguaje que la web (js/mapa-pub.js usa los mismos estilos).
 *
 * Estilos vector con variante por tema (claro = liberty, oscuro = dark) → el mapa
 * sigue cambiando de tema cargando otro style JSON.
 *
 * iOS no usa esto: MapKit usa los tiles de Apple (gratis, sin key).
 */
object MapTilerConfig {

    /** Style JSON vector para tema claro (OpenFreeMap Liberty). */
    fun styleUrlLight(): String =
        "https://tiles.openfreemap.org/styles/liberty"

    /** Style JSON vector para tema oscuro (OpenFreeMap Dark). */
    fun styleUrlDark(): String =
        "https://tiles.openfreemap.org/styles/dark"

    /** Style según el tema actual del sistema. */
    fun styleUrl(darkTheme: Boolean): String =
        if (darkTheme) styleUrlDark() else styleUrlLight()
}
