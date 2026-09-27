# CC-CX F1: esquemas oficiales de torneos

Consulta: 2026-09-12. Configuración de referencia: [cc-cx-points-schemes.json](cc-cx-points-schemes.json). No se cargan torneos ni se activa cálculo en F1. La configuración identifica versión y fuentes; no certifica que los reglamentos 2025-26 permanezcan sin cambios en 2026-27. La RFEC enlaza todavía su Título V de 09-09-2025 desde la [normativa técnica vigente](https://rfec.com/index.php/es/smartweb/seccion/seccion/rfec/reglamentos-tecnicos-y-particulares).

## Copa del Mundo

[UCI, Parte V, versión 01-07-2025](https://assets.ctfassets.net/761l7gh5x5an/3X0PPNdbWNAhMGaZzKly8J/7cfe482b94626424f9967d6df5cb3f38/5-CRO-20250701-E.pdf), artículos 5.3.013 y 5.3.023. [Organizador: tabla de puntos](https://www.ucicyclocrossworldcup.com/en/regulations-en).

ME/WE/MU/MJ/WJ: puestos 1–25 → **40, 30, 25, 22, 21, 20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1**. ME/WE suman todas las rondas. MU/MJ/WJ retienen cuatro mejores resultados si hay hasta siete rondas, cinco si hay ocho. El número se refiere a rondas celebradas por categoría, no al calendario élite ni a participaciones del corredor. Sin bonificaciones.

Desempate: número de primeros puestos, segundos, etc. hasta puesto 25; después puntos de la ronda más reciente. La norma no explicita cómo contar plazas descartadas en ese desempate: cotejar con general oficial antes de activar cálculo juvenil.

WU compite dentro de WE; su líder se distingue en la general femenina. No crear manga WU ficticia ni volver a numerar puestos WE al filtrar sub-23. La configuración reserva una vista derivada por edad, pendiente de cotejo oficial. La categoría de toda la temporada usa el año siguiente al de inicio (art. 5.1.001); no la edad al día de la ronda. Fecha de nacimiento e identidad deben estar verificadas.

## Superprestige

[Reglamento del organizador, 2025-26](https://www.superprestigecyclocross.be/nl/reglement).

ME y WE: puestos 1–15 → **15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1**. Suma de las ocho rondas, sin descartes. Desempates: más salidas reales; después más victorias; después mejor puesto en la última ronda. DNS no cuenta como salida; DNF sí. Sin bonificaciones. El reglamento consultado no establece generales independientes MU/WU/MJ/WJ: no aplicar automáticamente la tabla élite a esas categorías.

## X2O: corrección de unidades y modelo

[Reglamento del organizador, 2025-26](https://x2otrofee.be/wp-content/uploads/sites/133/2025/09/Reglement-X2O-Badkamers-trofee-veldrijden-2025-2026.pdf), arts. 3–5 y 8; [Rookie Trophy](https://x2otrofee.be/trimetal-rookie-trophy/).

ME/WE/MU tienen **general por tiempo**, ascendente, sumando ocho rondas, sin descartes. Penalización de 300 segundos sobre el ganador para ausencia, abandono, retirada por 80% o llegada a más de cinco minutos. Las bonificaciones ganadas se restan aparte del límite de cinco minutos. Solo entra en la general quien termina alguna ronda dentro de cinco minutos del ganador. Desempates: mejor puesto de la serie; después puesto de la última ronda; precisión de segundos, sin centésimas.

Un sprint al final de la primera vuelta: **15/10/5 segundos** para sus tres primeros. Desde 2025-26 hay además **15/10/5 segundos** a los tres corredores con vueltas más rápidas, excluyendo el bucle de salida. No son puntos. No sumar estos valores a `bonusPoints`. No hay general WU/MJ/WJ definida en este reglamento.

Corrección incorporada por indicación de Dani durante F1: `pointsScheme.categories[category].mode="time"`, `cx_results.timeSeconds` (tiempo real de meta), `bonusSeconds` (agregado positivo a restar) y `cx_tournament_standings.timeSeconds` (tiempo total computado). Se conserva `bonusPoints` para ajustes en unidades de puntos. El cálculo permanece en F5.

### Fuente de bonificaciones por ronda

El [portal de resultados X2O](https://x2otrofee.be/uitslagen/) y sus generales [ME](https://x2otrofee.be/klassement-elite-mannen/), [WE](https://x2otrofee.be/klassement-elite-vrouwen/) y [MU](https://x2otrofee.be/klassement-u23/) son los destinos oficiales para cotejo. El portal presenta la cabecera 2026-27 junto a enlaces antiguos; eso no demuestra publicación de datos de la nueva edición. La [ronda Koppenberg 2025](https://koppenbergcross.be/uitslagen-en-erelijst/) enlaza [meta ME](https://koppenbergcross.be/uitslagen-elite-mannen/) y las otras categorías, pero no publica un cuadro verificable de bonificaciones en las páginas inspeccionadas. DataRide tampoco las devuelve en esta ronda.

**Fuente automática de los seis premios por ronda pendiente de verificar.** No afirmar que DataRide ni estas páginas proporcionan los sprints. Para F5: obtener clasificación o informe oficial de cronometraje con sprint y vuelta rápida, conservar URL/edición/categoría, agregar segundos y cotejar general. Un cambio entre dos generales permite detectar un agregado discrepante, pero no prueba qué corredor ganó cada premio. Si solo se dispone de esa diferencia, usar corrección manual auditada y registrar el origen. No deducir sprint ni vuelta rápida del puesto de meta.

`bonusSeconds=NULL` significa agregado desconocido; `0` significa ausencia de bono confirmada. En X2O no recomputar una ronda con agregado desconocido. DNS/ausentes sin fila necesitan el forfait desde el ganador y el conjunto de participantes de la serie; `timeSeconds=NULL` no equivale a cero ni al forfait. `timeText` conserva la fuente; un doblado no recibe un tiempo real inventado. La fórmula F1 `sum(ganador + min(gap,300) - bonusSeconds)` corresponde a la hipótesis `retain`. Motor v3 exige `review.forfaitBonusesPolicy` por edición/categoría: `discard` no descuenta el bono ante forfait y `retain` sí. El resultado conserva el bono ganado, aunque el desglose de general lo descarte. Los DNF oficiales de las ocho rondas X2O ME/MU 2025–26 cotejan `discard` (registro F5, sección 74), con todos los tiempos/celdas coincidentes; la elegibilidad/orden íntegros siguen sin coincidir. La referencia JSON F1 sigue inactiva, sin política por omisión ni autorización para 2026–27. Confirmar sanciones especiales y regla de igualdad de vueltas rápidas en el informe oficial antes del cotejo.

## Copa de España

[RFEC, Título V, actualización 09-09-2025](https://yosoyciclista.s3.amazonaws.com/documentos/smartweb/menu/123/doc_68c7c0ddc9db25_29075634_5-Pruebas-de-Ciclo-Cross--ap-CD-20250909_b_IZDA.pdf), V-J, arts. 4, 6–8 y 14–15.

Cada categoría: puestos 1–15 → **25, 20, 16, 14, 12, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1**. Incluye ME/WE/MU/WU/MJ/WJ; cadetes y másteres quedan fuera de las seis categorías v1. Todos los resultados cuentan, sin descartes. Desempate: mejor plaza en la última prueba celebrada. Participantes extranjeros pueden figurar en la general. No hay sprints puntuables de torneo en esta norma. Incumplimiento del maillot de líder: sanción de 25 puntos, que requiere entrada auditada.

El programa puede agrupar categorías; el cálculo debe usar el puesto de la clasificación de cada categoría RFEC, no deducirlo de la fila DataRide de una manga élite agrupada. WU puede ser líder absoluta; evitar duplicar una manga de salida para representar dos generales. Cotejar las generales RFEC y resolver puestos por categoría antes del cómputo. La clase de la ronda C1/C2/NAC no cambia esta tabla. No confundirla con el ranking individual RFEC ni el ranking UCI.

## Contrato de configuración

El JSON contiene cuatro referencias con `pointsScheme` completo. Copiar ese objeto a la columna JSONB solo tras revisión de edición y categoría; no copiar todo el archivo. `perRank[n-1]` es el valor del puesto n; fuera de tabla, cero. `drops.mode="none"` suma todas; `bestResults` se resuelve por rondas realmente celebradas en esa categoría. `tieBreakers` es una secuencia ordenada, no una cadena de código.

`extras.sprints` usa `unit`, número de premios y fase; la vuelta rápida se declara separada. Modo points añade `bonusPoints` si `extras.pointAdjustments.enabled`; admite penalizaciones negativas verificadas. Modo time resta `bonusSeconds`; nunca usa `PointPcR` como entrada de torneo. Las categorías no definidas quedan ausentes. WU Copa del Mundo está marcada como derivada pendiente de cotejo; los demás esquemas tienen referencia de edición, sin autorización implícita para aplicarlos a otra temporada.

## Validación requerida antes de F2/F5

Dani autoriza iniciar F2 y continuar F3–F5 el 2026-09-12; [registro de autorización](plans/cc-ciclocross-integracion.md). F5 exige un cotejo por categoría: Copa del Mundo con descartes juveniles y WU derivada, Superprestige incluyendo DNF/DNS, X2O con sprint/vuelta rápida/forfaits, Copa de España con puestos por categoría y sanciones. Revisar reglamentos 2026-27; la autorización de ejecución no convierte estas referencias en reglas verificadas de otra edición.
