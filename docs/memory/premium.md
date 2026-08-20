# Sostenimiento voluntario y legado Premium (4.3)

## Invariantes

- Todas las funciones son gratuitas y `featuresUnlocked` permanece siempre en `true`.
- Las versiones 4.3 no muestran publicidad, no reservan espacio para ella y no inicializan SDK publicitarios.
- Premium está retirado de la venta y no se convierte en Amigo.
- Amigo y las aportaciones puntuales requieren una compra expresa.
- Fundador y Amigo solo habilitan reconocimiento e iconos cosméticos.

## Productos

| Tipo | iOS | Android | Precio inicial |
| --- | --- | --- | --- |
| Amigo mensual | `app.calendariociclismo.amigo.mensual` | `amigo` / `monthly` | 2,99 €/mes |
| Amigo anual | `app.calendariociclismo.amigo.anual` | `amigo` / `yearly` | 17,99 €/año |
| Aportación | `app.calendariociclismo.aportacion.299` | `aportacion_299` | 2,99 € |
| Aportación | `app.calendariociclismo.aportacion.599` | `aportacion_599` | 5,99 € |
| Aportación | `app.calendariociclismo.aportacion.1199` | `aportacion_1199` | 11,99 € |

Los productos Premium históricos se consultan solo para restauración y reconocimiento:

- iOS: `app.calendariociclismo.premium.mensual` y `app.calendariociclismo.premium.anual`.
- Android: `premium`.

## Estados

- `isSubscribed`: membresía Amigo activa. No controla funciones.
- `isLegacyPremiumActive`: Premium histórico todavía vigente. Impide ofrecer otra suscripción durante el periodo pagado.
- `isFounder`: existe una compra Premium histórica no revocada. Es permanente aunque expire.
- `supporterIcon`: `default`, `founder` o `friend`. El icono Amigo solo está disponible con membresía activa; Fundador permanece disponible.
- `contributionCount`: confirmación local para mostrar el agradecimiento por consumibles.

## Restauración y transiciones

1. Consultar derechos activos de Amigo y Premium.
2. Consultar el historial de Premium en iOS para recuperar Fundador aunque el plan haya expirado.
3. No comprar Amigo mientras Premium anterior siga activo.
4. Al expirar Amigo, retirar el icono temporal Amigo y recuperar la elección elegible anterior: Fundador si estaba seleccionado y sigue reconocido; Original en cualquier otro caso.
5. Al expirar Premium, conservar Fundador y permitir una nueva compra voluntaria de Amigo.
6. Una aportación puntual no desbloquea nada y se consume en Google Play para permitir repetirla.

## Presentación

- La pantalla de sostenimiento explica que la app es gratuita, abierta y sin anuncios.
- La versión 4.3 usa el gate nuevo `support_intro_v4_3_done` para mostrar una vez el anuncio a todas las instalaciones. Una clave de audiencia fijada antes del primer paso distingue instalaciones nuevas de actualizaciones: las primeras explican el sostenimiento y la autoría, mientras que las actualizaciones explican la retirada de publicidad y Fundador.
- El onboarding espera a la primera comprobación de compras antes de ofrecer Amigo; con Premium vigente o Amigo activo prioriza Continuar y no ofrece una alta duplicada.
- Ajustes contiene un enlace breve a `/apoyar/` o `/en/support/`; la explicación extensa no se duplica dentro de la app.
- Original, Fundador y Amigo se mantienen como composiciones por capas de Icon Composer; la selección siempre es expresa.
- El aviso de uso posterior no se muestra a Amigo ni mientras Premium histórico siga activo.
- Restaurar compras recupera Amigo y, en iOS, cualquier Premium histórico no revocado.

### Límite de restauración en Android

Google Play Billing Library 8.2.1 solo devuelve compras de suscripción activas mediante `queryPurchasesAsync`; no ofrece al cliente el historial de suscripciones expiradas. Android reconoce Fundador al actualizar desde una versión que conserva el estado Premium, al detectar un Premium todavía activo y al restaurar la copia de seguridad de DataStore. Una instalación limpia sin datos restaurados no puede reconstruir localmente un Premium que ya hubiera expirado antes de instalar 4.3.

La garantía estricta de restauración histórica en ese caso requiere haber almacenado previamente el token de compra en un backend asociado a una identidad recuperable. El proyecto no dispone de cuentas de usuario ni de ese registro histórico, por lo que 4.3 no puede generar ese dato de forma retroactiva.

## Operación de tienda

Los productos nuevos deben estar aprobados antes del cambio. En cada plataforma se retira Premium de la venta, se detienen sus renovaciones, se publica inmediatamente 4.3 y se activan los productos Amigo. Android requiere cancelar expresamente las renovaciones activas: desactivar un producto u oferta no basta. El procedimiento completo está en `docs/runbooks/lanzamiento-amigo-4.3.md`.
