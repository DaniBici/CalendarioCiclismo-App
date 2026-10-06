# Apps — registros históricos

Registros fechados y diagnósticos extraídos el 2026-09-28 de las notas de apps al unificarlas en la [referencia de apps](../memory/apps.md). Describen el estado en su fecha y no se actualizan.

## Android: diagnóstico del contraste de la barra de estado

### El problema (versionCode 117 y anteriores)

En modo claro, los iconos del sistema (hora, batería, cobertura, wifi) aparecían **claros sobre fondo claro**, prácticamente invisibles. La batería se distinguía solo porque tiene su propio fondo verde.

Síntoma típico: el usuario no puede leer la hora ni la batería en su pantalla principal.

### La causa real (NO obvia)

En API 35 sobre Pixel 9a (y probablemente otros dispositivos / OEMs), **el flag `isAppearanceLightStatusBars` aplicado solo desde código se ignora**. El sistema lo registra como `0` (`mAppearance=0`) aunque la llamada se ejecute sin error.

Lo confirmamos comparando:
- Logs Compose: `lightIcons=true` → la app *creía* que lo aplicaba
- `adb shell dumpsys window | grep mAppearance` sobre la app: vacío (= 0)
- Idem sobre Settings de Android (que SÍ funciona): `mAppearance=24` (8 + 16 = LIGHT_STATUS + LIGHT_NAV)

Los dos puntos del código que NO bastaron por sí solos:
1. `enableEdgeToEdge(SystemBarStyle.light(...))` en `MainActivity.onCreate`
2. `WindowCompat.getInsetsController(window, view).isAppearanceLightStatusBars = true` desde un `DisposableEffect` en el theme Compose histórico

Triple control con `WindowInsetsController` nativo (API 30+) y `setSystemBarsAppearance` tampoco resolvió.

### La solución

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

## Android: validación de la build 513

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

## iOS: contador de Xcode Cloud

**Contador efectivo (2026-09-07):** Xcode Cloud ha alcanzado la build **1343**. Dani fija **1344** como siguiente compilación de iOS, manteniendo marketing **4.4.1**. Los valores locales de `CURRENT_PROJECT_VERSION` se han sincronizado a **1344** en `project.yml` y el proyecto Xcode para la corrección de marca en carga y Ajustes. Comprobar el contador de Cloud antes de posteriores incrementos.

**Contador efectivo (2026-10-06):** la última build de Xcode Cloud es **1450** (2026-10-01, Xcode 27). La integración de 5.0.13 dispara la **1451** en Xcode Cloud, compilada con Xcode 27; la build enviada es la **1452**, archivada y subida en local con Xcode 27.1 porque Xcode Cloud no ofrece todavía esa versión. La siguiente build automática de Xcode Cloud tomaría **1452** y chocaría con la subida local: fijar en Xcode Cloud → Ajustes el siguiente número de build en **1453** o superior antes del próximo cambio en `ios-app/`. La corrección de gestos de 5.0.13 (Fichajes al desbloquear y deslizamiento lateral de Resultados) fija `CURRENT_PROJECT_VERSION` en **1453**.

**Contador efectivo (2026-10-06, noche):** la integración de los arreglos de gestos disparó la **1452** en Xcode Cloud, que falló al chocar con la 1452 subida en local. App Store Connect rechazó esa 1452 local por estar compilada con Xcode 27.1 beta (27A9269). La build enviada a revisión es la **1453**, archivada y subida en local con Xcode 27.1 RC (27A9275), instalada como `/Applications/Xcode-27.1-RC.app`. El siguiente número de Xcode Cloud queda fijado en **1454** (Xcode Cloud → Ajustes → Número de la compilación).
