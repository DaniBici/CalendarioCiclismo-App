# Histórico — Saneo de inconsistencias en resultados UCI (2026-06-11)

Este documento conserva decisiones y resultados de las pasadas de 2026-06-11. No es
una instrucción activa. Para auditorías usar `cc-saneo-resultados`; para reparaciones
autorizadas usar `cc-reparacion-resultados`. Trasladar a esas skills únicamente reglas
reutilizables y mantener aquí los casos, conteos y backups históricos.

Sistema de agentes para **encontrar y reparar** inconsistencias en los datos que el cron
de resultados vuelca a `race_uci_*` (creado 2026-06-11; primera pasada completa sobre 2026
ese mismo día; segunda pasada WT↔filial + cross-género + renames hispanos el mismo día,
ver secciones nuevas abajo). Las cuatro clases de problema que cubre:

1. **Equipos de startlist sin asociar** (`startlist_teams.teamId IS NULL`): selecciones
   nacionales en mayúsculas (AUSTRALIA, INDIA…) sin equipo en el catálogo, o equipos que
   SÍ existen pero no se enlazaron (Efapel ↔ "Efapel Cycling").
2. **Fichas de corredor duplicadas**: la UCI publica el nombre oficial LARGO
   ("VAN 'T GELOOF Maria Apolonia") que no casa con la ficha de uso ("Marjolein van 't
   Geloof") → la resolución por nombre crea/enlaza una ficha paralela.
3. **Filas de resultados desalineadas con la startlist**: `globalRiderId` NULL (sin
   enlazar) o apuntando a una ficha que no está en la startlist de la carrera (mal
   enlazada → el corredor sale sin equipo/chapa en `/resultados/`).
4. **Clasificaciones/startlists malformadas**: startlists con nombres vacíos, jornadas
   CRE enteras sin enlazar por `isTeamEvent` mal puesto, filas basura ("Race Cancelled").

## Cómo re-ejecutar la detección

Usar la skill `cc-saneo-resultados` (solo lectura, devuelve manifiesto de
hallazgos con veredicto por ítem). Requiere leer antes `cc-nucleo`:

```
Usa `cc-saneo-resultados` para auditar los resultados UCI de 2026 sin modificar datos.
```

3 detectores SQL en paralelo → jueces por lotes (selecciones con colores, fusiones con
superviviente, plan por carrera). La **reparación se decide después** leyendo el
manifiesto — no se aplica nada en esa pasada.

## Convenciones de reparación (obligatorias)

- **Backups**: toda fusión registra la ficha borrada como jsonb en
  `saneo_*_rider_merges` (p. ej. `saneo_0611_rider_merges`); las startlists tocadas se
  copian antes a `saneo_*_startlist_bak`. Rollback = restaurar desde ahí.
- **Alias de identidad (migración 094)**: toda fusión INSERTA el `identityKey` de la
  ficha borrada en `rider_identity_aliases` apuntando a la superviviente. Sin esto, el
  siguiente volcado por nombre RE-CREA el duplicado (el match por subconjunto de la 091
  no cubre "Marjolein" vs "Maria Apolonia"). `resolve_uci_results_by_name` y
  `resolve_riders` consultan los alias antes de crear ficha.
- **Superviviente de una fusión** = la ficha con el **nombre de uso** (la que un
  aficionado reconocería), limpia y con acentos, y mejores datos
  (verified > external_import/manual > startlist_auto) — **no** la que más referencias tenga
  (repuntar cuesta lo mismo). Repuntar SIEMPRE: `race_uci_results.globalRiderId`,
  `startlist_riders.globalRiderId`, `rider_team_affiliations.riderId` (con dedupe por
  equipo+año). `start_order_entries.riderId` NO referencia fichas (es
  `startlist_riders.id`).
- **PROHIBIDO `resolve_uci_results` "a pelo"** en carreras con filas legítimas por
  nombre (sin bib, o bib ausente de la startlist: Albania 318, Hungría dorsales
  141-146…): el RPC hace LEFT JOIN y ANULA esas filas. Los relinks van con **UPDATEs
  dirigidos** por dorsal/fila.
- **`isTeamEvent`**: solo true en `classKind='teams'`. Las clasificaciones con filas de
  corredor van false aunque el día sea CRE (precedente Dauphiné E3). El fetcher
  (`dataride-results-fetch.mjs`) ya lo deriva así desde 2026-06-11 — DataRide marca
  IsTeamEvent=true en TODO el día CRE y en carreras enteras mal tipadas (Ses Salines).
- **Sustituciones reales** (otra persona corrió con ese dorsal; Lituania, Tour du Jura):
  el RESULTADO es la verdad — no se repunta hacia la startlist; se anota la discrepancia
  de startlist para corregirla en el editor.
- **Regla de oro**: dos fichas que co-aparecen en la misma carrera son personas
  DISTINTAS (gemelos/homónimos: van Dijke, Prieto, Miralrio, Ma).
- **Selecciones nacionales**: `teams.category NTM/NTW`, nombre del país en inglés
  ("Australia"), `countryCode` iso2 minúscula, colores de la equipación nacional en
  `badgeTorsoCenter/Sides/Shorts` + `headerBg/headerText`, id `team_ntm_<pais>`.
  El trigger genera slug y foldedNames; `sync_team_to_season` crea su team_season.

## Equipos WT/WWT/PT ↔ filial (Academia/Devo) — reglas (2.ª pasada 2026-06-11)

- **Decisión de producto (Dani)**: si en una MISMA carrera coinciden el senior y su
  filial (Academia/Devo/Development/U23/Rookies/Gen-Z…), TODOS los corredores de ambos
  bloques van al `startlist_teams` del **senior** (corren como squad mixto). Mover
  `startlist_riders.teamId` al bloque senior y borrar la fila filial. **NO tocar**
  `rider_team_affiliations` ni `riders_*.currentTeamId` (el contrato sigue siendo el de
  la filial). Validación previa: patrón "invitados" — bloques combinados ≤ 8 corredores;
  cero solapes de dorsal/globalRiderId entre bloques.
- **Filial corriendo SOLA** (sin el senior) = correcta como **equipo propio**: debe
  enlazar a SU entrada de catálogo filial (todas existen: `team_devo_*`,
  `team_red_bull_rookies`, `team_lotto_wanty`, Hagens Berman Jayco, EF Education-Aevolo,
  Groupama-FDJ United CT, Lidl-Trek Future Racing, Liv AlUla Jayco Women's Continental,
  Canyon//SRAM Generation…), NUNCA al senior.
- **`Lotto - Groupe Wanty` ES la filial de Lotto Intermarché** (juicio 2026-06-11: 24/39
  carreras compartidas con el senior con patrón invitados, edad media 21.1 vs 25.0 del
  senior, nombre = los dos sponsors). Sin keyword devo en el nombre — no inferible por
  regex.
- **Causa raíz (mig. 095)**: `fold_team_name` elimina los stopwords development/team/
  continental/women → el nombre UCI de la filial pliega IGUAL que el senior y el match
  exacto (LIMIT 1) elegía al senior; además el match no filtraba género ("LIDL - TREK"
  femenino → equipo masculino). `resolve_uci_startlist` lleva desde la 095 filtro de
  género + guard anti-filial en exacto y contención. Las selecciones femeninas tienen ya
  NTW propias (13 creadas: Spain/Italy/Greece/United States/Ukraine/Colombia/China/
  Ecuador/Indonesia/Malaysia/Thailand/Uzbekistan/Austria) + NTM Colombia/Thailand.
- Backups de esa pasada: `saneo_0611_wtdevo_plan` (142 merge + 308 relink + 18 link_null
  + 1 unlink, auditable por fila), `saneo_0611_wtdevo_st_teams_bak`,
  `saneo_0611_wtdevo_st_riders_bak`.
- **Falso positivo corregido (sesión posterior, 2026-06-11)**: 18 bloques con `teamName`
  crudo "INEOS GRENADIERS" (= marca senior, sin keyword filial) en carreras ene–abr
  estaban enlazados a `team_devo_ineos` — herencia del matcher pre-095 que la pasada
  marcó `action='ok'` (old=new=devo) sin contrastar el nombre crudo contra la entidad.
  Lección: el juicio "filial sola = equipo propio" exige que el `teamName` crudo lleve
  keyword filial (devo/academy/development/u23…) O que el roster apunte a la filial por
  `currentTeamId`; nombre = marca senior limpia → bloque del senior. Detección rápida:
  `t.id LIKE 'team_devo%' AND st."teamName" !~* '(devo|development|academy|u23|gen[ -]?z|rookies|future|aevolo|generation|wanty|continental|wcc)'`.
  **Al re-enlazar un bloque senior, respetar la ERA del maillot**: ene–abr 2026 →
  specialEdition "INEOS Grenadiers" (`team_1776703502014_xcx66a`, ValidTo 2026-04-30,
  como sus 10 carreras hermanas Down Under→Romandía); mayo+ → "Netcompany INEOS"
  (padre `team_1777379215624_qymkfj`). Enlazar al padre en marzo habría mostrado
  "Netcompany INEOS" en una carrera donde esa denominación no existía. En Coppi e
  Bartali el bloque senior coexistía con la Academy real (dorsales intercalados 51–57,
  3+4) → fusión invitados bajo el senior. Backups: `saneo_0611_ineos_fp_st_teams_bak`
  (19 filas) + `saneo_0611_ineos_fp_st_riders_bak` (4).

## Dobles nombres/apellidos hispanos — receta de rename (2026-06-11)

Nacionalidades es/co/ec/mx/ar/cl/pe/ve/uy/py/bo/cr/gt/hn/ni/pa/sv/do/pr/cu (**NUNCA**
pt/br: convención de apellidos distinta). El nombre oficial UCI largo ("Daniel Felipe
Martínez Poveda") se normaliza al nombre de uso recortando el **segundo apellido**
(particle-aware: `de/del/la/san/van…` cuentan con su apellido — "del Teso Olaizola" →
"del Teso"; "Sanz de Galdeano" es UN apellido compuesto → NO tocar). Los **nombres de
pila compuestos se conservan** ("Daniel Felipe", "Xabier Mikel", "Jefferson Alexander" —
es la forma fuente externa). Mecánica OBLIGATORIA por ficha:

1. Backup jsonb en `saneo_*_rider_renames` ANTES del rename.
2. El rename dispara el trigger que recalcula `identityKey` → guardar el ikey VIEJO e
   insertarlo en `rider_identity_aliases` apuntando a la **MISMA ficha** (sin esto el
   siguiente volcado UCI con el nombre largo re-crea el duplicado).
3. El nombre largo completo va a `otherNames` (append multilínea).
4. **`unique_violation` en el rename = SEÑAL**, una a una: fecha de nacimiento o
   nacionalidad distinta → homónimos → se queda la forma larga (Mario Silva Baeza vs
   Mário Silva pt; Rubén Sánchez Estévez 2003 vs Rubén Sánchez 2006); misma fecha/nat →
   duplicado → fusión con la receta de arriba (Azparren Irurzun → Azparren; Torrico
   Ortiz → Torrico). OJO: el handler de excepción revierte la subtransacción entera —
   registrar las colisiones FUERA o detectarlas por diff posterior.
5. `verified=true` NO se toca sin verificación web (las curó Dani; sus dobles apellidos
   son intencionales: García Pierna, García Cortina, los dos Jefferson Cepeda…).

## Gap `currentTeamId` NULL + afiliaciones bloqueadas (3.ª pasada, 2026-06-11)

Pasada "teamgap": fichas que corren 2026 en bloques WT/PT (resolviendo specialEdition →
padre) o WWT/PRW con `currentTeamId` NULL → sin ficha pública pese al gate. 48 casos
(45♂+3♀). Backups `saneo_0611_teamgap_*` (riders/st_riders/st_teams/affils) + fusiones
en `saneo_0611_rider_merges`. Reglas aplicadas y lecciones:

- **Clasificar antes de rellenar**: (a) solo bloques de UN equipo senior → fill directo;
  (b) bloques filial+senior mezclados → el contrato es la FILIAL (fill con la CT, sin
  ficha pública: correcto); (c) 1 sola aparición → sospechar DUPLICADO de una ficha
  verified existente (7 cazados: Øxenberg, Hellemose, Riesebeek, Magagnotti, A. Mayer,
  Marivoet Scholiers, Scala Jr.) → fusión con receta 094, no fill; (d) fechas de carrera
  IMPOSIBLES para una persona (Monseré 22-mar + Catalunya 23-mar) → DOS personas
  compartiendo ficha → split de filas por carrera (nielsen-magnus ↔ nielsen-magnus-lorents).
- **Bloques mentirosos detectados por la categoría de la carrera**: un PT/WT no puede
  correr clase .2 → "BAHRAIN" en una 2.2 = selección nacional (NTM creada), "Caja
  Rural-Seguros RGA" en una 1.2 = filial amateur HOMÓNIMA del PT → desenlazar (sus 6
  corredores quedan sin equipo a propósito: no tienen contrato pro). Bloque marca-senior
  en carrera 2.2 con roster 100% devo por `currentTeamId` → re-enlazar a la filial
  (Visma en Alpes Isère).
- **⚠️ GOTCHA — id determinista de `rider_team_affiliations`** (`rider__team__year`):
  el trigger 077 upsertea con `ON CONFLICT (id) DO UPDATE` que **NO actualiza
  `riderId`**. Las fusiones antiguas repuntaron `riderId` SIN regenerar el `id` → si el
  rider del prefijo existe (dup vivo), su upsert choca con esa fila y la afiliación
  correcta queda **bloqueada en silencio** (caso Tarling/Ribeiro: el fill parecía no
  crear la afiliación; los conteos "fantasma" eran esto, NO corrupción de índice — el
  REINDEX no arregló nada). **Al repuntar afiliaciones en una fusión, regenerar también
  el `id`** al canónico del superviviente.
- **`id NOT LIKE riderId||'__%'` es un DETECTOR de dups vivos**: las filas desalineadas
  cuyo prefijo Y riderId existen ambos como ficha = par duplicado (así cayeron
  tarling-joshua↔tarling-josh, ribeiro-bravo-henrique↔bravo-henrique, Finlay Tarling,
  Jack Ward). Excepción: cepeda-jefferson↔cepeda-jefferson-alexander son los DOS
  Jefferson Cepeda reales (homónimos curados) — NO fusionar. Las desalineadas con
  riderId vivo y prefijo muerto (~305) son repuntes legítimos, benignas.
- **Afiliaciones colgantes** (riderId sin ficha en ninguna tabla): 14 halladas de
  fusiones/renames pre-alias; si la gemela viva ya tiene su fila canónica → borrar; si
  tiene equipo pero SIN fila (trigger nunca disparó) → repuntar riderId+id (Aranguren,
  Messemer, Ostolaza). Query detector en `saneo_0611_teamgap_affils_bak.reason`.
- Frankfurt 2026-05-01 corrió aún como specialEdition "INEOS Grenadiers" (confirmado
  Dani) → `specialEditionValidTo` extendido a 2026-05-01.

## Estado tras la pasada 2026-06-11

Ver memoria `project_results_consistency_saneo` y el commit de esa fecha. Resumen:
21 fusiones globales + fusiones race-local de la cirugía, 6 referencias colgantes
reparadas (208 filas, incl. Mavi García), 5 startlists con nombres vacíos rellenadas
desde resultados (Clàssica CV 1969, Llucmajor, Castellón, Terres de l'Ebre, Palma),
3 jornadas CRE re-enlazadas (París-Niza E3, Feminin E1, Japón E4: 1.019 filas),
Ses Salines re-resuelta (146 filas + startlist sembrada, era una CRE real de un día),
selecciones nacionales creadas y enlazadas, `races.gender` de la Volta a Portugal
Feminina corregido a `female`.
