# Android — Status bar appearance (lección aprendida)

Documentación técnica de la barra de estado Android.

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
2. `WindowCompat.getInsetsController(window, view).isAppearanceLightStatusBars = true` desde un `DisposableEffect` en el theme Compose

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
