# Data Safety Form — Google Play Console
## Calendario Ciclismo (`app.calendariociclismo.android`)

Documento de referencia para rellenar la sección **"Data safety"** en Play Console
→ App content → Data safety.

---

## 1. Pregunta inicial: ¿recopila o comparte datos la app?

**¿La app recopila o comparte datos de usuario requeridos por la política de Play?**
→ **Sí**

---

## 2. Cifrado en tránsito

**¿Todos los datos recopilados están cifrados en tránsito?**
→ **Sí.** Toda la comunicación va por HTTPS/TLS (Supabase, Firebase, FCM).

**¿Los usuarios pueden solicitar la eliminación de sus datos?**
→ **Sí.**
- Token FCM: el usuario desactiva las notificaciones push en Ajustes → se elimina
  de Supabase (`push_subscriptions`).
- Datos de Analytics: el usuario desactiva Analytics en Ajustes → se detiene
  la recolección. No hay datos anteriores que borrar (no se almacenan en servidores
  propios, se procesan en Firebase/GA4).

---

## 3. Tipos de datos recopilados

### 3a. Información personal y del dispositivo

| Tipo | ¿Recopilado? | Detalles |
|------|-------------|---------|
| Nombre | No | — |
| Dirección de email | No | — |
| Información de identificación personal | No | — |
| Dirección postal | No | — |
| Número de teléfono | No | — |
| Raza y etnia | No | — |
| Creencias políticas / religiosas | No | — |
| Orientación sexual | No | — |
| Otra información personal | No | — |

### 3b. Información financiera

| Tipo | ¿Recopilado? |
|------|-------------|
| Información de usuario y pagos | No |
| Historial de compras | No |
| Puntuaciones de crédito | No |
| Otro contenido financiero | No |

### 3c. Salud y fitness

No recopilado.

### 3d. Mensajes

No recopilado.

### 3e. Fotos y vídeos

No recopilado. (La app descarga imágenes de carrera desde CDN público; no accede
a la galería del usuario.)

### 3f. Archivos y documentos

No recopilado.

### 3g. Calendario

No recopilado. (La app abre Google Calendar vía Intent para **añadir** una
suscripción iCal; no **lee** ningún dato del calendario del usuario.)

### 3h. Contactos

No recopilado.

### 3i. Actividad en la app ✅ RECOPILADO

**Tipo exacto:** Interacciones en la app (vistas de pantalla)
**Finalidad:** Analytics
**¿Es opcional?** Sí — requiere aceptación explícita en el onboarding y puede
  desactivarse en Ajustes → Privacidad → Estadísticas de uso.
**¿Se comparte con terceros?** Sí — con Google (Firebase Analytics / GA4).
**¿Está vinculado a la identidad del usuario?** No.
**¿Se usa para rastrear al usuario?** No.

> Rellenar en Play Console:
> - Tipo de dato: "App interactions"
> - ¿Recopilado?: Sí
> - ¿Compartido?: Sí (Google/Firebase)
> - Finalidad: Analytics
> - Opcional: Sí (el usuario puede optar por no participar)
> - ¿Vinculado a identidad?: No
> - ¿Tracking?: No

### 3j. Historial de navegación web

No recopilado.

### 3k. Información de la app y rendimiento

| Tipo | ¿Recopilado? | Nota |
|------|-------------|------|
| Registros de errores / crashlytics | No | No se usa Firebase Crashlytics |
| Datos de diagnóstico | No | — |
| Otros datos de rendimiento | No | — |

### 3l. Identificadores de dispositivo ✅ RECOPILADO

**Tipo exacto:** Token FCM (Firebase Cloud Messaging)
**Finalidad:** Notificaciones push (funcionalidad de la app)
**¿Es opcional?** Sí — el usuario debe activar las notificaciones push en el
  onboarding o en Ajustes. Sin activarlas, no se recopila ningún token.
**¿Se comparte con terceros?** Sí — con Google (FCM API) para el envío de
  notificaciones. Nuestro backend (Supabase) almacena el token para poder
  invocar FCM.
**¿Está vinculado a la identidad del usuario?** No — se vincula al dispositivo,
  no a ninguna cuenta de usuario (la app no tiene login).
**¿Se usa para rastrear al usuario?** No.

> Rellenar en Play Console:
> - Tipo de dato: "Device or other IDs"
> - ¿Recopilado?: Sí
> - ¿Compartido?: Sí (Google/FCM + backend Supabase)
> - Finalidad: App functionality (push notifications)
> - Opcional: Sí (el usuario elige activar push)
> - ¿Vinculado a identidad?: No
> - ¿Tracking?: No

---

## 4. Prácticas de seguridad

| Pregunta | Respuesta |
|----------|-----------|
| ¿Datos cifrados en tránsito? | **Sí** (HTTPS/TLS en todos los endpoints) |
| ¿Se siguen las Prácticas recomendadas de seguridad de Play? | **Sí** |

---

## 5. Resumen para el formulario (vista rápida)

```
Datos recopilados:
  ✅ App interactions     — Analytics — Opcional — No vinculado a identidad
  ✅ Device or other IDs  — Push notif — Opcional — No vinculado a identidad

Datos NO recopilados:
  ✗ Información personal (nombre, email, teléfono, dirección…)
  ✗ Información financiera
  ✗ Salud y fitness
  ✗ Mensajes
  ✗ Fotos / vídeos / archivos
  ✗ Calendario (solo escribe vía Intent, no lee)
  ✗ Contactos
  ✗ Historial de navegación
  ✗ Crashlytics / logs de error

Cifrado en tránsito: Sí
Eliminación de datos a petición: Sí
```

---

## 6. Cómo obtener el SHA-256 del keystore (para assetlinks.json)

### Opción A — Google Play App Signing (recomendado)

Si usas Google Play App Signing (la opción por defecto en apps nuevas), Google
gestiona la clave de firma. El SHA-256 está en:

```
Play Console → (tu app) → Setup → App signing
→ "App signing key certificate" → SHA-256 certificate fingerprint
```

Copia ese valor (formato: `AB:CD:EF:…:12:34`) y pégalo en
`.well-known/assetlinks.json` sustituyendo el placeholder, usando el formato
sin dos puntos: `ABCDEF…1234`.

### Opción B — Keystore propio

Si gestionas tú el keystore:

```bash
keytool -list -v \
  -keystore release.jks \
  -alias <alias> \
  -storepass <contraseña>
```

La línea `SHA256:` del output es el valor a usar (sin los dos puntos).

---

## 7. Formato final de assetlinks.json

Una vez tengas el SHA-256, el fichero `.well-known/assetlinks.json` debe quedar:

```json
[
  {
    "relation": ["delegate_permission/common.handle_all_urls"],
    "target": {
      "namespace": "android_app",
      "package_name": "app.calendariociclismo.android",
      "sha256_cert_fingerprints": [
        "AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67"
      ]
    }
  }
]
```

El formato **con dos puntos** (`:`) es el que usa assetlinks.json.

### Validar antes de publicar

```bash
# Verificar que el fichero es JSON válido
cat .well-known/assetlinks.json | python3 -m json.tool

# Verificar que Netlify lo sirve correctamente (tras el deploy)
curl -s https://calendariociclismo.app/.well-known/assetlinks.json | python3 -m json.tool
```

Google también tiene un verificador oficial:
https://developers.google.com/digital-asset-links/tools/generator
