package app.calendariociclismo.android.ui.map

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color as AndroidColor
import android.graphics.Paint
import android.graphics.Typeface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import app.calendariociclismo.android.data.map.MapTilerConfig
import app.calendariociclismo.android.util.LatLng
import app.calendariociclismo.android.util.RoutePoint
import org.maplibre.android.MapLibre
import org.maplibre.android.camera.CameraUpdateFactory
import org.maplibre.android.geometry.LatLng as MlLatLng
import org.maplibre.android.geometry.LatLngBounds
import org.maplibre.android.maps.MapView
import org.maplibre.android.maps.Style
import org.maplibre.android.style.layers.LineLayer
import org.maplibre.android.style.layers.PropertyFactory
import org.maplibre.android.style.layers.SymbolLayer
import org.maplibre.android.style.sources.GeoJsonSource
import org.maplibre.geojson.Feature
import org.maplibre.geojson.FeatureCollection
import org.maplibre.geojson.LineString
import org.maplibre.geojson.Point

/** Un marcador a pintar sobre el mapa: coordenada + estilo del pin + callout. */
data class MapMarker(
    val id: String,
    val coord: LatLng,
    val fillColor: Int,      // ARGB
    val glyph: String,       // texto centrado del pin ("1", "S", "▶", "🏁"…)
    val calloutTitle: String,
    val calloutSubtitle: String?,
)

/** Info del marcador tocado + su posición en pantalla (px) para anclar el popup. */
data class TappedMarker(val title: String, val subtitle: String?, val screenX: Float, val screenY: Float)

private const val ROUTE_SOURCE = "route-src"
private const val ROUTE_CASING_LAYER = "route-casing"
private const val ROUTE_LINE_LAYER = "route-line"
private const val MARKER_SOURCE = "marker-src"
private const val MARKER_LAYER = "marker-layer"
private const val PROP_ICON = "icon"
private const val PROP_TITLE = "title"
private const val PROP_SUBTITLE = "subtitle"

/**
 * MapView de MapLibre embebido en Compose vía AndroidView (MapLibre no tiene API
 * Compose oficial). Pinta UNA polilínea (casing blanco + trazo del color de la
 * carrera) y los marcadores como SymbolLayer con iconos rasterizados a Bitmap.
 *
 * Ciclo de vida atado al LifecycleOwner (MapView exige onStart/onResume/… o
 * filtra el contexto GL). Estilo vector de OpenFreeMap según el tema (sin API key).
 */
@Composable
fun MapLibreView(
    points: List<RoutePoint>,
    markers: List<MapMarker>,
    routeColor: Int,
    darkTheme: Boolean,
    modifier: Modifier = Modifier,
    onMarkerTap: (TappedMarker?) -> Unit = {},
) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current

    // MapLibre.getInstance debe llamarse una vez antes de inflar el MapView.
    val mapView = remember {
        MapLibre.getInstance(context)
        MapView(context)
    }

    // Atar el ciclo de vida del MapView al del composable.
    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_CREATE -> mapView.onCreate(null)
                Lifecycle.Event.ON_START -> mapView.onStart()
                Lifecycle.Event.ON_RESUME -> mapView.onResume()
                Lifecycle.Event.ON_PAUSE -> mapView.onPause()
                Lifecycle.Event.ON_STOP -> mapView.onStop()
                Lifecycle.Event.ON_DESTROY -> mapView.onDestroy()
                else -> {}
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        mapView.onCreate(null)
        mapView.onStart()
        mapView.onResume()
        onDispose {
            lifecycleOwner.lifecycle.removeObserver(observer)
            mapView.onPause()
            mapView.onStop()
            mapView.onDestroy()
        }
    }

    AndroidView(
        factory = { mapView },
        modifier = modifier,
        update = { mv ->
            mv.getMapAsync { map ->
                map.setStyle(Style.Builder().fromUri(MapTilerConfig.styleUrl(darkTheme))) { style ->
                    drawRoute(style, points, routeColor)
                    drawMarkers(style, markers)
                    // Encuadrar a la región del GPX. `newLatLngBounds` necesita el
                    // tamaño del viewport; en el callback de setStyle el MapView
                    // aún puede medir 0×0 → diferir al layout con post().
                    mv.post { fitToRoute(map, points) }
                }
                // Tap sobre el mapa: consultar la capa de marcadores en el punto.
                // Si hay un símbolo, devolver su callout (popup en Compose); si
                // no, devolver null (cierra el popup). Espejo del bindPopup web.
                map.addOnMapClickListener { latLng ->
                    val screen = map.projection.toScreenLocation(latLng)
                    val feats = map.queryRenderedFeatures(screen, MARKER_LAYER)
                    val f = feats.firstOrNull()
                    val geom = f?.geometry()
                    if (f != null && geom is Point) {
                        val title = f.getStringProperty(PROP_TITLE) ?: ""
                        val sub = if (f.hasProperty(PROP_SUBTITLE)) f.getStringProperty(PROP_SUBTITLE) else null
                        // Posición en pantalla del CENTRO del pin (su geometría),
                        // no del punto donde cayó el dedo → popup clavado al pin.
                        val pinScreen = map.projection.toScreenLocation(
                            MlLatLng(geom.latitude(), geom.longitude())
                        )
                        onMarkerTap(TappedMarker(title, sub, pinScreen.x, pinScreen.y))
                        true   // consumir el toque (no propagar al mapa)
                    } else {
                        onMarkerTap(null)
                        false
                    }
                }
            }
        },
    )
}

/** Polilínea única: casing blanco grueso debajo + trazo del color encima. */
private fun drawRoute(style: Style, points: List<RoutePoint>, routeColor: Int) {
    if (points.size < 2) return
    val line = LineString.fromLngLats(points.map { Point.fromLngLat(it.lon, it.lat) })
    val src = GeoJsonSource(ROUTE_SOURCE, Feature.fromGeometry(line))
    style.addSource(src)

    val casing = LineLayer(ROUTE_CASING_LAYER, ROUTE_SOURCE).withProperties(
        PropertyFactory.lineColor(AndroidColor.WHITE),
        PropertyFactory.lineWidth(7f),
        PropertyFactory.lineCap(org.maplibre.android.style.layers.Property.LINE_CAP_ROUND),
        PropertyFactory.lineJoin(org.maplibre.android.style.layers.Property.LINE_JOIN_ROUND),
    )
    val main = LineLayer(ROUTE_LINE_LAYER, ROUTE_SOURCE).withProperties(
        PropertyFactory.lineColor(routeColor),
        PropertyFactory.lineWidth(4f),
        PropertyFactory.lineCap(org.maplibre.android.style.layers.Property.LINE_CAP_ROUND),
        PropertyFactory.lineJoin(org.maplibre.android.style.layers.Property.LINE_JOIN_ROUND),
    )
    style.addLayer(casing)
    style.addLayer(main)
}

/** Marcadores como SymbolLayer; cada pin se rasteriza a un Bitmap único. */
private fun drawMarkers(style: Style, markers: List<MapMarker>) {
    if (markers.isEmpty()) return
    val features = ArrayList<Feature>(markers.size)
    markers.forEachIndexed { i, m ->
        val imageId = "pin-$i"
        style.addImage(imageId, pinBitmap(m.fillColor, m.glyph))
        val f = Feature.fromGeometry(Point.fromLngLat(m.coord.lon, m.coord.lat))
        f.addStringProperty(PROP_ICON, imageId)
        f.addStringProperty(PROP_TITLE, m.calloutTitle)
        m.calloutSubtitle?.let { f.addStringProperty(PROP_SUBTITLE, it) }
        features.add(f)
    }
    style.addSource(GeoJsonSource(MARKER_SOURCE, FeatureCollection.fromFeatures(features)))
    style.addLayer(
        SymbolLayer(MARKER_LAYER, MARKER_SOURCE).withProperties(
            PropertyFactory.iconImage("{$PROP_ICON}"),
            PropertyFactory.iconAllowOverlap(true),
            PropertyFactory.iconIgnorePlacement(true),
        ),
    )
}

/** Encuadra la cámara a toda la traza con un margen (instantáneo). */
private fun fitToRoute(map: org.maplibre.android.maps.MapLibreMap, points: List<RoutePoint>) {
    if (points.isEmpty()) return
    val builder = LatLngBounds.Builder()
    points.forEach { builder.include(MlLatLng(it.lat, it.lon)) }
    val bounds = runCatching { builder.build() }.getOrNull() ?: return
    // Vía 1: newLatLngBounds (usa el tamaño del viewport, ya medido tras post()).
    val ok = runCatching {
        map.moveCamera(CameraUpdateFactory.newLatLngBounds(bounds, 80))
    }.isSuccess
    // Vía 2 (respaldo): si el viewport aún no estuviese medido, getCameraForLatLngBounds
    // calcula la posición sin depender de easeCamera y la aplicamos directamente.
    if (!ok) {
        runCatching {
            map.getCameraForLatLngBounds(bounds, intArrayOf(80, 80, 80, 80))?.let {
                map.moveCamera(CameraUpdateFactory.newCameraPosition(it))
            }
        }
    }
}

/**
 * Rasteriza un pin circular: halo blanco + círculo de color + glyph centrado.
 * Mismo lenguaje visual que los círculos del perfil y que el pin de iOS.
 */
private fun pinBitmap(fillColor: Int, glyph: String): Bitmap {
    val sizePx = 72                      // ~24dp a densidad media; nítido en symbol
    val bmp = Bitmap.createBitmap(sizePx, sizePx, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bmp)
    val cx = sizePx / 2f
    val cy = sizePx / 2f

    val halo = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = AndroidColor.WHITE }
    canvas.drawCircle(cx, cy, sizePx * 0.46f, halo)

    val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = fillColor }
    canvas.drawCircle(cx, cy, sizePx * 0.40f, fill)

    val text = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = AndroidColor.WHITE
        textAlign = Paint.Align.CENTER
        typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
        // Glyphs largos ("HC") más pequeños para que quepan.
        textSize = if (glyph.length > 1) sizePx * 0.32f else sizePx * 0.42f
    }
    val fm = text.fontMetrics
    val baseline = cy - (fm.ascent + fm.descent) / 2f
    canvas.drawText(glyph, cx, baseline, text)
    return bmp
}
