# Android — Status bar appearance (lección aprendida)

Documentación técnica de la barra de estado Android.

## Implementación vigente desde Android 513

- `MainActivity` llama a `WindowCompat.enableEdgeToEdge(window)` (AndroidX Core
  1.17.0). El fondo se dibuja mediante una `Surface` del color `background` que
  ocupa toda la ventana; no se colorean las barras con `Window`.
- El contenido de navegación y onboarding comparte un `safeDrawingPadding()`:
  aplica y consume los insets de barras, cámara y teclado una sola vez. El
  `Scaffold` principal solo añade el espacio de las pestañas y la barra inferior
  ya no añade otro `navigationBarsPadding()`.
- Los diálogos se gestionan en su propia ventana. `PaywallSheet` usa
  `WindowInsets.safeDrawing`, sin desactivar esos márgenes, y aplica el contraste
  mediante `SystemBarsAppearance` sobre su `DialogWindowProvider`. Esto evita que
  el tema del sistema imponga iconos negros sobre una hoja oscura.
- El contenido del onboarding de sostenimiento admite desplazamiento cuando no
  cabe en horizontal; los botones de continuar permanecen fuera del desplazamiento.
- Se conservan `windowLightStatusBar` y `windowLightNavigationBar` en los temas
  XML claro/oscuro. El arranque aplica la apariencia sobre `decorView`; el cambio
  dinámico de tema la reaplica con `WindowInsetsControllerCompat` y, desde API 30,
  el controlador nativo. Las reaplicaciones pendientes se cancelan al cambiar el
  efecto Compose.
- No restaurar `Window.statusBarColor`, `Window.navigationBarColor` ni manipular
  `systemUiVisibility` desde el tema. Android 15+ impone transparencia con nuestro
  target SDK y esas llamadas no sustituyen el fondo ni la gestión de insets.

Referencias: [WindowCompat](https://developer.android.com/reference/androidx/core/view/WindowCompat),
[insets en Compose](https://developer.android.com/develop/ui/compose/system/insets).

Validación de la build 513 (2026-09-06): APK release en emulador Pixel 10 Pro XL,
Android 36.1, en vertical y horizontal, con navegación de tres botones. Se
comprobaron las rutas principal/secundaria y el onboarding; el texto de
sostenimiento se alcanza mediante desplazamiento. Con la app oscura y el sistema
claro, la hoja mantiene iconos blancos y `dumpsys window` muestra una región de
apariencia sin `LIGHT_STATUS_BARS`.

La build 513 / 4.4.1 quedó instalada por USB en el Pixel 9a (API 37) el mismo
día. La versión 510 usaba la firma de Google Play; se desinstaló con autorización
expresa de Dani y se instaló el APK de firma local. El proceso arranca; la
comprobación visual en el dispositivo queda pendiente de desbloquear el PIN.

Los apartados siguientes documentan el diagnóstico histórico del contraste.

## El problema (versionCode 117 y anteriores)

En modo claro, los iconos del sistema (hora, batería, cobertura, wifi) aparecían **claros sobre fondo claro**, prácticamente invisibles. La batería se distinguía solo porque tiene su propio fondo verde.

Síntoma típico: el usuario no puede leer la hora ni la batería en su pantalla principal.

## La causa real (NO obvia)

En API 35 sobre Pixel 9a (y probablemente otros dispositivos / OEMs), **el flag `isAppearanceLightStatusBars` aplicado solo desde código se ignora**. El sistema lo registra como `0` (`mAppearance=0`) aunque la llamada se ejecute sin error.

Lo confirmamos comparando:
- Logs Compose: `lightIcons=true` → la app *creía* que lo aplicaba
- `adb shell dumpsys window | grep mAppearance` sobre la app: vacío (= 0)
- Idem sobre Settings de Android (que SÍ funciona): `mAppearance=24` (8 + 16 = LIGHT_STATUS + LIGHT_NAV)

Los dos puntos del código que NO bastaron por sí solos:
1. `enableEdgeToEdge(SystemBarStyle.light(...))` en `MainActivity.onCreate`
2. `WindowCompat.getInsetsController(window, view).isAppearanceLightStatusBars = true` desde un `DisposableEffect` en el theme Compose histórico

Triple control con `WindowInsetsController` nativo (API 30+) y `setSystemBarsAppearance` tampoco resolvió.

## La solución

**Declarar `windowLightStatusBar` en el theme XML** como ancla. El sistema lee el valor del theme primero y desde ahí respeta cambios posteriores.

`app/src/main/res/values/themes.xml`:
```xml
<style name="Theme.CalendarioCiclismo" parent="Theme.Material3.DayNight.NoActionBar">
    <item name="android:windowLightStatusBar">true</item>
</style>
```

`app/src/main/res/values-night/themes.xml`:
```xml
<style name="Theme.CalendarioCiclismo" parent="Theme.Material3.DayNight.NoActionBar">
    <item name="android:windowLightStatusBar">false</item>
</style>
```

Con eso solo, el problema desaparece. Las llamadas desde código (`MainActivity.onCreate` + `Theme.kt` `DisposableEffect`) siguen presentes para que el cambio dinámico de tema (Ajustes → Apariencia) tenga efecto sin reiniciar la app.

## Reglas para evitar volver a perder días

1. **Nunca confíes solo en código para `isAppearanceLightStatusBars`.** Siempre declarar también `windowLightStatusBar` en `values/themes.xml` (true) y `values-night/themes.xml` (false).

2. **Verificación obligatoria al tocar la status bar:**
   ```bash
   ~/Library/Android/sdk/platform-tools/adb -s <serial> shell dumpsys window | grep -A 1 mLastStatusBarAppearanceRegions
   ```
   Si `AppearanceRegion{ bounds=...}` aparece sin `appearance=N` → el flag NO se aplica. Si dice `appearance=8` → iconos oscuros activos. `appearance=24` → iconos oscuros + nav bar oscura.

3. **Logs de Compose mienten en este caso.** Que `Log.d` confirme `lightIcons=true` no garantiza que `WindowInsetsController` haya escrito el flag al sistema. Validar siempre con `dumpsys`.

4. **El emulador puede ocultar el problema.** El emulador con notch/cámara renderizada puede no mostrar status bar visible y disimular el bug. Verificar SIEMPRE en dispositivo físico.

5. **`enableEdgeToEdge()` no exime de declarar `windowLightStatusBar`.** A pesar de que la documentación de Google sugiere que es suficiente, en la práctica no lo es para Pixel 9a / API 35.

## Cómo instalar localmente para probar (sin Play Store)

Teléfono con Depuración USB activada (Ajustes → Información → tocar 7× "Número de compilación" → Sistema → Opciones para desarrolladores → Depuración USB).

```bash
cd android-app
~/Library/Android/sdk/platform-tools/adb devices
# Si la app de Play Store está instalada, desinstalarla primero (firmas distintas):
~/Library/Android/sdk/platform-tools/adb -s <serial> uninstall app.calendariociclismo.android

# Build sin lint (lint pre-existente bloquea con OfflineAssets/):
./gradlew :app:assembleRelease -x lintVitalAnalyzeRelease -x lintVitalReportRelease -x lintVitalRelease

# Instala
~/Library/Android/sdk/platform-tools/adb -s <serial> install -r app/build/outputs/apk/release/app-release.apk
```
