# Fichas duplicadas de corredores (2026-10-08)

Manifiesto de auditoría (`cc-saneo-resultados`) y plan de reparación
(`cc-reparacion-resultados`). Proyecto `bcecwlkynpgovnzhbpah`, rol `cc_agent`
(`scripts/db/sql.mjs`), migración con `scripts/db/apply-migration.mjs`.

Estado: ítems 1 y 2 aplicados el 2026-10-08 con autorización de Dani
(sección «Ejecución»); anexo C cruzado en la sección «Anexo C: resolución».

## Alcance

- Catálogo de carretera: `riders_men` (9.999 fichas) y `riders_women` (3.360).
- Fuera de alcance: catálogo de ciclocross (`cx_riders_*`), homónimos con
  nacimiento distinto sin otra evidencia, pares del anexo C.

## Método

1. Generación de pares por bloques: mismo `uciProfileId` o licencia; mismo
   conjunto de tokens del nombre plegado (`fold_name`); nombre contenido en
   otro (dos apellidos, nombre compuesto, `otherNames`); mismo nacimiento con
   apellido común y nombre parecido; erratas a distancia de edición ≤ 2.
2. Descarte automático: 116 pares cuyas fichas coinciden en una misma carrera
   (inscritos o resultados), lo que prueba personas distintas.
3. Clasificación: A (mismo nacimiento o perfil UCI, sin contradicción, 162
   pares), B (nacimiento en una sola ficha, 30), Y (país distinto, 19), Z
   (nacimiento distinto, 77).
4. Revisión manual de cada par con equipo, carrera, dorsal y nombre de la
   lista de origen. Se aceptan los A salvo excepciones y los B/Y/Z con
   evidencia adicional (mismo equipo, ficha sin referencias con grafía
   alternativa, día y mes invertidos).
5. Rechazados: Meccia/Sica (equipos distintos), cruces entre los gemelos José
   Antonio y José Juan Prieto de Luna, y 91 pares B/Y/Z sin evidencia.

## Resultado

| Concepto | Valor |
|---|---:|
| Grupos de fusión | 168 |
| Fichas retiradas | 174 (124 hombres, 50 mujeres) |
| Filas de inscritos repuntadas | 220 |
| Filas de resultados repuntadas | 1.448 |
| Afiliaciones trasladadas / descartadas por duplicadas | 14 / 34 |
| Alias repuntados / creados | 10 / 305 |
| Fichajes afectados | 0 |
| Pares pendientes (anexo C) | 17 |

## Ítem 1. Pseudoequipos creados como club — reparable

`ensure_startlist_team` creó como `CLUBW` cinco entradas que no son clubes, y
el trigger de plantillas generó afiliaciones `startlist_club` a ellas.

| Pseudoequipo | Inscritos | Afiliaciones | Corrección |
|---|---|---:|---|
| Ukrajinský Národní Tým | Gracia Orlová 2026 | 3 | `team_ntw_ukraine` |
| Švédský Národní Tým | Gracia Orlová 2026 | 2 | `team_ntw_sweden` |
| Polský Národní Tým | Gracia Orlová 2026 | 1 | `team_1785562320031_2t109k` (Poland) |
| Norský Národní Tým | Gracia Orlová 2026 | 0 | `team_ntw_norway` |
| Independiente | CN España línea femenino y sub23 femenino 2026 | 3 | sin equipo (`teamId` NULL) |

Acción, en este orden:

1. Migración `startlist_placeholder_independiente`: añade `independiente` y
   `unattached` a `is_startlist_no_team_placeholder`. Sin ella,
   `auto_link_startlist_team` vuelve a enlazar «Independiente» y el trigger de
   plantillas recrea el club con el mismo id determinista.
2. Relink de los 6 `startlist_teams` y de 4 `team_link_decisions`; borrado de
   2 decisiones de «Independiente», 9 afiliaciones, 5 `team_name_aliases`,
   5 `team_seasons` y 5 `teams`. Alta de 4 `team_selection_aliases` con los
   nombres checos para que las próximas importaciones usen la selección.
3. Efecto: 8 corredoras pierden un `currentTeamId` que apuntaba a un
   pseudoequipo; el trigger lo recalcula con sus afiliaciones restantes.

Respaldo: `private.pseudoequipos_selecciones_20261008_backup`.

Barrido global: ningún corredor tiene afiliación ni `currentTeamId` a equipos
`NTM`/`NTW` o `teamKind=selection`. «Cyclo Tým Havířov», «Tým Morava»,
«Servicio Nacional Aeronaval» y «PSKK Vassil-Levski» son clubes reales.

## Ítem 2. Fusión de fichas duplicadas — reparable

Superviviente: la ficha con el nombre de uso (la más presente en inscritos y
resultados), salvo errata evidente: `cowan-quentin`, `vollmuth-aidan`,
`mancebo-francisco` y `kim-gukhyun` sustituyen a la grafía más referenciada.
La superviviente absorbe de las retiradas `uciProfileId`, licencia,
nacimiento y nacionalidad cuando le faltan, y sus grafías en `otherNames`.

Por grupo, en una transacción:

- Aserción: fichas presentes y ninguna pareja del grupo en la misma carrera.
- `startlist_riders`: `globalRiderId` y nombre sincronizado con la
  superviviente (dorsales intactos, de modo que `resolve_uci_results` no
  deshace el cambio).
- `race_uci_results`: `globalRiderId`.
- `rider_team_affiliations`: se descarta la de la retirada si el grupo ya
  tiene el mismo equipo, año y tipo; el resto se traslada con el id
  determinista regenerado.
- `rider_transfers` y `rider_identity_aliases`: repunte.
- Alias nuevos con `identityKey` e `id` de cada ficha retirada.
- Borrado de las fichas retiradas y verificación de cero referencias
  colgantes.

Respaldo: `private.fusion_corredores_duplicados_20261008_backup`
(`entity`, `row_key`, `row_data`, `action`): supervivientes antes del cambio,
fichas retiradas completas, filas repuntadas y alias insertados.

Rollback: reinsertar las fichas `deleted`, restaurar las columnas de las
supervivientes desde `survivor_before`, devolver `globalRiderId`, nombre y
afiliaciones según `row_data` y borrar los alias `inserted`.

Efectos colaterales previstos: avisos de cambio a las dos webs externas
suscritas si alguna de sus carreras contiene filas repuntadas; afiliaciones
`startlist_club` nuevas para supervivientes inscritas con un club.

## Ejecución

1. Migración `20261008065807_startlist_placeholder_independiente`.
2. Pseudoequipos: 6 `startlist_teams` (4 relink a selección, 2 sin equipo),
   4 decisiones relink y 2 borradas, 9 afiliaciones, 5 alias de nombre,
   5 temporadas y 5 equipos retirados, 4 `team_selection_aliases` nuevos.
   Respaldo: 8 corredoras con `currentTeamId` previo.
3. Fusiones: 174 fichas retiradas (124 hombres, 50 mujeres), 220 filas de
   inscritos y 1.448 de resultados repuntadas, 14 afiliaciones trasladadas y
   34 descartadas, 10 alias repuntados y 305 claves de alias registradas.

Verificación posterior: fichas 9.875 hombres y 3.310 mujeres; cero
referencias de inscritos, resultados, afiliaciones y alias a fichas
retiradas; detector 7 de `cc-saneo-resultados` a cero; «Independiente» sin
`teamId` en sus dos carreras.

## Anexo C: resolución

Cruce con UCI DataRide (resultados con fecha de nacimiento), uci.org,
fuente externa y listas oficiales. Autorización de Dani para aplicar los
cambios a medida que se verifican. Respaldos:
`private.fusion_corredores_anexo_c_20261008_backup`, `…_anexo_c2_…` y
`…_anexo_c3_…`.

| Par | Veredicto | Evidencia | Acción |
|---|---|---|---|
| `adam-cameron` / `harrison-cameron` | misma persona | Poyang Lake: el resultado del dorsal 134 es «HARRISON Cameron» | fusión en `harrison-cameron` |
| `morris-william` / `cooper-morris-william` | misma persona | Poyang Lake: el dorsal 132 es «COOPER William» | fusión; nombre de uso William Cooper |
| `barrientos-diego` / `barrios-mazariegos-diego` | misma persona | Vuelta Bantrab: «BARRIOS MAZARIEGOS Diego» | fusión en `barrios-mazariegos-diego` |
| `biberg-bruno` / `martins-lemes-bruno` | misma persona | Volta de São Paulo: «MARTINS LEMES Bruno» | fusión en `martins-lemes-bruno` |
| `perez-lopez-cesar` / `perez-cesar` | misma persona | resultados 2026: «PEREZ LOPEZ Cesar» (Kern Pharma) | fusión en `perez-cesar` |
| `marte-roger` / `marte-valdez-roger` | misma persona | DataRide 78124, 78982: 2004-07-07 | fusión; nacimiento 2004-07-07 |
| `pimentel-jesus` / `pimentel-abrego-jesus` | misma persona | DataRide 78385; fuente externa Gran Prix Chitré: 2005-09-29 | fusión; nacimiento 2005-09-29 |
| `juan-lopez-1997` / `lopez-salcedo-juan-jose` | misma persona | DataRide 78836, 72335: 2005-07-22; 1997-04-23 es de Juan Diego López Ochoa (DataRide 38900) | fusión; nacimiento 2005-07-22 |
| `barbosa-salgueiro-jose-miguel` / `salgueiro-jose` | misma persona | DataRide 77547, 77881: 2007-05-03; licencia 10112039327 | fusión en `salgueiro-jose`; licencia UCI |
| `garcia-olaya-jose` / `garcia-jose-armando` | misma persona | DataRide 77371, 78836: Colombia, 2003-02-01 | fusión en `garcia-jose-armando`; nacionalidad CO |
| `herrera-mariana` / `herrera-karol-mariana` | personas distintas | Vuelta a Colombia Femenina: dorsal 115 Herrera Serrano (2001-01-12), dorsal 125 Herrera Aguiar (2005-01-22) | dorsal 125 (1 inscrito, 24 resultados) a `herrera-karol-mariana` |
| `silva-mario` / `silva-baeza-mario` | personas distintas | GP Torres Vedras: dorsal 103 de Caja Rural - Alea, ES | dorsal 103 (1 inscrito, 9 resultados) a `silva-baeza-mario` |
| `raus-jerome` / `raus-jerome-2007` | personas distintas | DataRide 77802, 77880: 2007-03-02 en Ixina Classic y CN CRI sub23 | 1 inscrito y 2 resultados a `raus-jerome-2007` |
| `bolton-max` / `bufton-max` | personas distintas | DataRide 77600, 79275 | nacimiento de Bufton 2006-09-28 |
| `jorgensen-emil` / `toudal-emil` | personas distintas | equipos, lugar de nacimiento y talla distintos | sin cambios |
| `artuso-marco` / `guercilena-marco` | personas distintas | ambos en el Giro del Veneto 2026; misma fecha oficial | sin cambios |
| `zhang-han` / `zhang-hanyu` | personas distintas | equipos distintos (Prowheel, Joyrun) | sin cambios |

Otros cambios: `otherNames` de Melsey Pérez sin «Vega» (ninguna fuente lo
publica; DataRide confirma 2005-03-11) y sin salto de línea. Tres alias
huérfanos repuntados a `guatibonza-jonathan`, `mancebo-francisco` y
`martinez-dani`.

Verificación: 10 fichas retiradas, cero referencias colgantes, detector 7 a
cero, cero alias sin ficha.

Nacimiento de Emil Jørgensen: se conserva el de DataRide (1996-05-28),
idéntico al de Toudal; fuente externa da 1998-02-21. Decisión de Dani: sin
cambios.

## Hallazgos fuera de alcance

- Tres alias apuntaban a fichas inexistentes tras renombrados anteriores
  (`alexander-becerra-guatibonza-jonathan`, `francisco-mancebo-perez`,
  `daniel-felipe-martinez-poveda`). Resuelto en «Anexo C: resolución».
- `raus-jerome` (2003) figuraba en Ixina Classic con Dovy Keukens, equipo de
  `raus-jerome-2007`. Resuelto en «Anexo C: resolución».
- Melsey Pérez: las fichas tenían día y mes invertidos; DataRide confirma
  2005-03-11, la fecha conservada.
- Zahra Rezayee: nacionalidad FR en la ficha usada y AF en la del catálogo UCI.
  Dani confirma AF; corregida (respaldo `nationality_before` en `…_anexo_c3_…`).

## Segunda ronda (2026-10-08)

Autorización de Dani para continuar y para corregir inscritos y otros campos.

### Detectores nuevos

- Clave fonética y transliteración (y/i, kh/h, w/v, dobles letras), mismo
  nacimiento con cualquier apellido común, ficha sin nacimiento con nombre y
  apellido próximos.
- Nombre de pila ausente de todos los resultados oficiales de la ficha.
- Detector 3 de `cc-saneo-resultados` en todo el catálogo: dorsal del
  resultado enlazado a otra ficha que la de inscritos.
- Corrección del criterio de la primera ronda: coincidir en una carrera solo
  prueba personas distintas con dorsales distintos. Inscritos con una ficha y
  resultado del mismo dorsal con otra es un duplicado; una coincidencia con
  dorsal 0 no prueba nada.

### Aplicado

| Lote | Respaldo `private.` | Contenido |
|---|---|---|
| Nombre de pila erróneo | `fusion_corredores_ronda2_20261008_backup` | 18 fusiones (Andino, Courtot, Escalera, Gunnarsdóttir, Imaz, Akovobahou, Buijk, Clark, Tilli, Hadzistoyanov, McGeough, Miller, Nisbet, Poulard, Scaroni, Hojda, Iriarte, Vanhuffel); 83 fichas basura con nombre numérico (dorsales de Kreiz Breizh, sin referencias); grafías Vanhuffel y McGeough |
| Mismo dorsal o dorsal 0 | `fusion_corredores_ronda2b_20261008_backup` | 28 fusiones (Walsh, Holmes, Berastegui, Reissner, Hierro Alzola, Sušnik, Threels, Van der Poel, Valgonen, Ghebreigzabhier, López Llull, Williams, Martins, De Marigny-Lagesse, Codony, Dyrhovden, Homme-Gabrielsen, Puigdefábregas, Røed, Steen Enstad, Verhoeff, Wais, Amundrud, Tildheim Andersen, Nordal Brixen, Praxmajer, Stokbro Nielsen, Madsen Nielsen); 4 referencias a fichas inexistentes (Callejas, Møller Andersen, Bastiaens, Dversnes Lavik); Røed a NO |
| Verificados en DataRide | `fusion_corredores_ronda2c_20261008_backup` | 6 fusiones (Bos, McLain, Winther Hulbæk Petersen, Hiciano Ortega, Sbahi, Lucamba); nombres Pascal Akovobahou, Baptiste Poulard, Sofía Cabarico, Danna Sánchez, Pauline Lavignac; nacimiento de Catrine Porsdal 2005-06-07; McLain NZ, Lucamba AO |
| Alias erróneos | `limpieza_alias_erroneos_20261008_backup` | 24 alias y 15 variantes de `otherNames` con nombres falsos de listas de inscritos (Matthew Miller, William Morris, Cameron Adam…), que podían enlazar a otras personas |
| Separación Latriglia | `separacion_latriglia_20261008_backup` | Deshace la fusión de la primera ronda de las gemelas María Paula y María Valentina Latriglia Alarcón (Vuelta a Colombia Femenina, dorsales 4 y 164) |
| Dorsales según resultado | `dorsales_resultado_oficial_20261008_backup` | 41 carreras con lista provisional de dorsales permutados o sustituciones: 96 dorsales, 148 sustituciones, 29 no salidos a dorsal 0, 17 altas en equipos inscritos, 1.557 filas de resultados reenlazadas |

Verificación: cero referencias a fichas inexistentes en resultados,
inscritos, afiliaciones, fichajes y alias. Filas de resultados con apellido
ajeno a la ficha enlazada: de 395 a 21. Detector 3: de 135 pares a 87.

### Homónimos, Matthew Walls y segundo lote de dorsales

| Lote | Respaldo `private.` | Contenido |
|---|---|---|
| Martins y Alves | `homonimos_martins_alves_20261008_backup` | Segundo João Martins (Vuelta al Alentejo, dorsal 161) y segundo Francisco Alves (CN Portugal sub23, dorsal 17) sin ficha; 19 filas de resultados desenlazadas de `martins-joao` |
| Matthew Walls | `walls_matthew_20261008_backup` | Dos corredores: GB 1998 (UCI 101710, Team Storck - MRW Bau) e IE 2007 (UCI 1179705, APS Pro Cycling by Team Cadence Cyclery), según las afiliaciones UCI. 14 inscripciones y 86 filas de resultados reasignadas por equipo; Campeonato de Irlanda en línea al irlandés. Vuelta a Alemania (Solution Tech Nippo Rali) sin cambios |
| Homónimos | `homonimos_inscritos_2_20261008_backup` | Cepeda de EF a `cepeda-jefferson-alexander` (4 carreras), Samuel Fernández Heres (Vuelta a Asturias), Roel van Sintmaartensdijk (Scheldeprijs), Alexander Nørskov Larsen (Ringerike y Sundvolden GP); fila duplicada de Elisabeth Højgaard (Argenta Classic) |
| Dorsales según resultado (2) | `dorsales_resultado_oficial_2_20261008_backup` | 16 carreras (Tour de Limburgo, CN Polonia CRI sub23, Vuelta a Colonia, Tour du Jura, Boucles de l'Aulne, BW Classic…): 59 dorsales, 38 sustituciones, 3 no salidos, 5 altas |
| Alta Austria, United Shipping | `alta_austria_united_shipping_20261008_backup` | La lista provisional tenía a Nikačević, Stojnić, Campean, Drakos, Kardos y Pakot con dorsal 0 tras el primer lote; corrieron Schuran, Fetter, Palumby, Endrédi, Tóth y Vas (resultado oficial 201-206, afiliaciones UCI 2026). Alta Austria queda sin desajustes; Hamun y Petrič (Pogi Team, no salieron) con dorsal 0 |

Verificación final: cero fichas inscritas dos veces en una carrera, cero
dorsales de resultado enlazados a otra ficha que la de inscritos (detector 3),
cero referencias a fichas inexistentes, detector 7 a cero.

Sin cambios por falta de evidencia: Riahi, Berg-Jacobsen, Jonsson y Myhre en
el Tour de Lituania (la fuente cambia sus dorsales entre etapas), equipos
ausentes de la lista y altas en contrarrelojes de campeonato.

## Tercera ronda: barrido de cierre (2026-10-08)

Todas las reglas de las dos rondas sobre el catálogo actual, con el criterio
de dorsal corregido.

| Concepto | Pares |
|---|---:|
| Generados | 307 |
| Descartados: misma carrera con dorsales distintos | 102 |
| Descartados: nacimiento distinto | 167 |
| Descartados: perfiles UCI distintos | 9 |
| Ya revisados y declarados distintos | 27 |
| Nuevos | 2 |

Fusionados (respaldo `private.fusion_corredores_ronda3_20261008_backup`):
`gardiner-rebecca` en `gardiner-becky` (KDM-Pack; su resultado de GP
Schellebelle dice «GARDINER Becky») y `jantschgi-jenny` en
`jantschgi-jennifer`.

Revisión de los 167 descartados por nacimiento: 46 comparten nombre y país;
2 tienen fechas próximas o de relleno sin perfiles UCI distintos (Charlie Hoy
y Charlie Hoyle; Maxime Louis y Maxime Luzi) y son personas distintas según
el resultado oficial y el equipo.

Residual conocido: duplicados sin coincidencia de nombre, nacimiento ni
perfil UCI (nombre completamente distinto en cada ficha) no son detectables
por estas reglas; el detector 3 (dorsal del resultado con otra ficha que la
de inscritos) queda a cero y es la vía para que aparezcan en futuras cargas.

## Anexo A. Grupos de fusión — mujeres (48 grupos, 50 fichas)

| Superviviente | Fichas retiradas | Evidencia |
|---|---|---|
| `al-sayegh-safia` Safia Al Sayegh (AE) 2001-09-23 UCI 513136 | `alsayegh-safia` Safia Alsayegh (AE) 2001-09-23 | mismo nacimiento |
| `asgodom-hadush-merhawit` Hadush Merhawit Asgodom (ET) 2005-04-09 UCI 1562296 | `asgodom-merhawit` Merhawit Asgodom (ET) 2005-04-09 | mismo nacimiento, mismo equipo |
| `balboa-castells-raquel` Raquel Balboa Castells (AD) 1996-01-29 | `balboa-castello-raquel` Raquel Balboa (AD) | nacimiento en una |
| `bertramsen-emma-nyholm` Emma Nyholm Bertramsen (DK) | `bertramsen-emma` Emma Bertramsen (DK) 2007-11-05 | nacimiento en una, mismo equipo |
| `beti-marta` Marta Beti (ES) 2004-04-03 | `beti-perez-marta` Marta Beti Perez (ES) 2004-04-03 UCI 377225 | mismo nacimiento |
| `bye-camilla-ranes` Camilla Rånes Bye (NO) 2004-11-17 UCI 202978 | `bye-ranes-camillia` Camillia Bye Ranes (NO) 2004-11-17 | mismo nacimiento, mismo equipo |
| `canela-karen-emelina` Karen Emelina Canela (HN) 1993-09-21 | `canales-euseda-karen` Karen Canales Euseda (HN) 1993-09-21 | mismo nacimiento |
| `coraboeuf-lea` Léa Coraboeuf (FR) 2006-11-06 | `corraboeuf-lea` Léa Corraboeuf (FR) | nacimiento en una, mismo equipo |
| `curnis-valeria` Valeria Curnis (IT) 1995-02-11 UCI 1078812 | `curinis-valeria` Valeria Curinis (IT) 1995-02-11 | mismo nacimiento, mismo equipo |
| `gierveld-heleen` Heleen Gierveld (NL) 1996-05-14 | `giervald-heleen` Heleen Giervald (NL) 1996-05-14 | mismo nacimiento, mismo equipo |
| `glover-hannah-lucy` Hannah Lucy Glover (GB) 2006-02-08 UCI 1322009 | `glover-lucy` Lucy Glover (GB) | nacimiento en una, mismo equipo |
| `guirado-axelle` Axelle Guirado (FR) 2001-06-18 | `guirao-axelle` Axelle Guirao (FR) 2001-06-18 | mismo nacimiento, mismo equipo |
| `heredia-ane` Ane Heredia (ES) 2007-05-31 | `beltran-de-heredia-fernandez-ane` Ane Beltrán de Heredia (ES) 2007-05-31 | mismo nacimiento, mismo equipo |
| `jager-jette-marie` Jette Marie Jäger (DE) 2007-05-02 UCI 1057767 | `jette-jaeger-2026` Jette Jäger (DE) 2007-05-02 | mismo nacimiento, mismo equipo |
| `jeffers-emma` Emma Jeffers (IE) 2004-11-11 UCI 577179 | `jeffers-susan-emma` Susan Emma Jeffers (IE) 2004-11-11 | mismo nacimiento, mismo equipo |
| `kazakova-yelizaveta` Yelizaveta Kazakova (UA) 2006-10-31 | `kozakova-yelizaveta` Yelizaveta Kozakova (UA) 2006-10-31<br>`kozakova-yelyzaveta` Yelyzaveta Kozakova (UA) 2006-10-31 | mismo nacimiento |
| `ketelsen-ida-krickau` Ida Krickau Ketelsen (DK) 2006-06-15 UCI 587988 | `krickau-ida` Ida Krickau (DE) 2006-06-15 | mismo nacimiento, país distinto, mismo equipo |
| `kononenko-valeriia` Valeriia Kononenko (UA) 1990-05-14 UCI 38365 | `kononenko-valeriya` Valeriya Kononenko (UA) 1990-05-14 | mismo nacimiento, mismo equipo |
| `latriglia-maria-valentina` Maria Valentina Latriglia (CO) 1999-06-09 | `latriglia-maria` María Latriglia (CO) 1999-06-09 | mismo nacimiento |
| `lee-lopez-cynthia-eugenia` Cynthia Eugenia Lee Lopez (GT) 1993-04-09 | `lee-cynthia` Cynthia Lee (GT) 1993-04-09 | mismo nacimiento |
| `lewis-tegan-sophie` Tegan Sophie Lewis (GB) 2002-06-17 UCI 861362 | `lewis-sophie` Sophie Lewis (GB) | nacimiento en una, mismo equipo |
| `londono-angie` Angie Londoño (CO) 2005-08-26 | `londono-posada-angie` Angie Londoño Posada (CO) 2005-08-26 UCI 1054933 | mismo nacimiento |
| `lyu-han` Han Lyu (CN) 2003-11-02 UCI 1553933 | `lv-han` Han Lv (CN) 2003-11-02 | mismo nacimiento |
| `markl-jule` Jule Märkl (DE) 2005-03-07 UCI 438023 | `markl-julie` Julie Märkl (DE) 2005-03-07 | mismo nacimiento, mismo equipo |
| `messemer-joelle` Joëlle Messemer (DE) 2006-10-10 UCI 461148 | `messemmer-joelle-amelie` Joelle Amelie Messemmer (DE) 2006-10-10 | mismo nacimiento, mismo equipo |
| `mira-laura-maria` Laura María Mira (ES) | `mira-juarez-laura-maria` Laura Maria Mira Juarez (ES) 2004-10-25 UCI 377196 | nacimiento en una |
| `mohammad-khaled-samah` Samah Mohammad Khaled (JO) 1992-05-01 | `khaled-samah` Samah Khaled (JO) 1992-05-01 | mismo nacimiento |
| `mwamikazi-jazilla` Jazilla Mwamikazi (RW) 2004-09-09 UCI 1072682 | `mwamkazi-jazilla` Jazilla Mwamkazi (RW) 2004-09-09 | mismo nacimiento, mismo equipo |
| `niewiadoma-kasia` Kasia Niewiadoma (PL) 1994-09-29 UCI 86824 | `niewiadoma-phinney-katarzyna` Katarzyna Niewiadoma-Phinney | nacimiento en una |
| `olesen-emilie-adelheid` Emilie Adelheid Olesen (DK) 2002-08-12 | `olesen-emilie` Emilie Olesen (DK) 2002-08-12 | mismo nacimiento, mismo equipo |
| `perez-vega-melsey-yamely` Melsey Yamely Pérez (DO) 2005-03-11 | `perez-melsey` Melsey Pérez (DO) 2005-11-03 | nacimiento distinto, mismo equipo |
| `posada-mendoza-maria-paula` Maria Paula Posada (NI) 1996-06-18 | `posada-maria` María Posada (NI) 1996-06-18 | mismo nacimiento, mismo equipo |
| `putri-anatasya-andini` Andini Putri Anatasya (ID) 2006-02-13 | `anastasya-andini-putri` Andini Putri Anastasya (ID) 2006-02-13 | mismo nacimiento, mismo equipo |
| `quesada-dixiana` Dixiana Quesada (CR) 2003-06-12 | `quesada-yendry-dixiana` Yendry Dixiana Quesada (CR) 2003-06-12<br>`quesada-yendry` Yendry Quesada (CR) 2003-06-12 | mismo nacimiento, mismo equipo |
| `ramsay-annabel` Annabel Ramsay (GB) 2003-10-03 | `ramsay-jayne-annabel` Jayne Annabel Ramsay (GB) 2003-10-03 UCI 975318 | mismo nacimiento, mismo equipo |
| `reda-eyerusalem-haftu` Eyerusalem Haftu Reda (ET) 1999-06-04 UCI 920769 | `reda-eyerusalem` Eyerusalem Reda (ET) 1999-06-04 | mismo nacimiento, mismo equipo |
| `retana-sonia-liseth` Sonia Liseth Retana (SV) 1984-03-24 | `retana-sonia` Sonia Retana (SV) 1984-03-24 | mismo nacimiento, mismo equipo |
| `revelo-natalie` Natalie Revelo (EC) 2006-02-12 | `revelo-veronica` Verónica Revelo (EC) 2006-02-12 UCI 971714 | mismo nacimiento, mismo equipo |
| `rezayee-zahra` Zahra Rezayee (FR) | `rezayee-zahra-2` Zahra Rezayee (AF) 2003-01-03 UCI 1187842 | nacimiento en una, país distinto |
| `rhyne-kate` Kate Rhyne (US) 1987-10-22 | `rhyne-katherine` Katherine Rhyne (US) 1987-10-22 | mismo nacimiento |
| `riis-madsen-gertrud` Gertrud Riis Madsen (DK) 2004-07-25 | `madsen-gertrud` Gertrud Madsen (DK) 2004-07-25 | mismo nacimiento, mismo equipo |
| `san-justo-claudia` Claudia San Justo (ES) 2003-10-03 | `san-justo-mantecon-claudia` Claudia San Justo Mantecon (ES) 2003-10-03 UCI 420921 | mismo nacimiento |
| `schach-caroline-kirk` Caroline Kirk Schach (DK) 1997-04-01 | `schad-caroline-kirk` Caroline Kirk Schad (DK) | nacimiento en una, mismo equipo |
| `shaw-eilidh` Eilidh Shaw (GB) 2004-12-27 UCI 822285 | `shaw-cameron-eilidh` Cameron Eilidh Shaw (GB) 2004-12-27 | mismo nacimiento, mismo equipo |
| `van-gisel-ines` Ines Van Gisel (FR) 1998-04-17 | `van-gysel-ines` Ines Van Gysel (FR) | nacimiento en una |
| `vasquez-natalia` Natalia Vásquez (EC) 2004-04-07 | `vasquez-amaya-natalia` Natalia Vasquez Amaya (EC) 2004-04-07 UCI 896009 | mismo nacimiento, mismo equipo |
| `vasquez-puac-andrea` Andrea Vásquez Puac (GT) 2007-05-18 | `vasquez-andrea` Andrea Vásquez (GT) 2007-05-18 | mismo nacimiento |
| `zayed-ahmed-mohamed-ebtissam` Ebtissam Zayed Ahmed Mohamed (EG) 1996-09-25 | `zayed-ahmed-mohamed-ebtiss` Ebtiss Zayed Ahmed Mohamed (EG) 1996-09-25 | mismo nacimiento |

## Anexo B. Grupos de fusión — hombres (120 grupos, 124 fichas)

| Superviviente | Fichas retiradas | Evidencia |
|---|---|---|
| `ajpacaja-sabino-ramon` Sabino Ramon Ajpacaja (GT) 2001-08-21 | `ajpacaja-tax-sabino` Sabino Ajpacaja Tax (GT) 2001-08-21 | mismo nacimiento |
| `alemayo-tekle` Tekle Alemayo (ET) 2006-11-19 | `alemayo-tsegay` Tsegay Alemayo (ET) 2006-11-19 UCI 1645408 | mismo nacimiento, mismo equipo |
| `alyami-majed` Majed Alyami (SA) 2005-10-12 | `alyami-fahad-majed` Fahad Majed Alyami (SA) 2005-10-12 | mismo nacimiento, mismo equipo |
| `araya-nahom` Nahom Araya (ER) 2002-09-12 | `zeray-nahom` Nahom Zeray (ER) 2002-09-12 UCI 962601 | mismo nacimiento, mismo equipo |
| `arbolella-canor` Canor Arbolella (ES) 2007-08-07 | `arboleya-del-valle-canor` Canor Arboleya (ES) | nacimiento en una |
| `ates-adem` Adem Ates (TR) 2004-08-09 | `ates-can-adem` Can Adem Ates (TR) 2004-08-09 UCI 1186321 | mismo nacimiento, mismo equipo |
| `azanos-diego-neftaly` Diego Neftaly Azanos (GT) 2003-01-11 | `azanos-moreira-diego` Diego Azaños Moreira (GT) 2003-01-11 | mismo nacimiento |
| `baudry-julian` Julian Baudry (AU) 2006-09-20 UCI 1369497 | `baudry-willem-julian` Willem Julian Baudry (AU) 2006-09-20 | mismo nacimiento, mismo equipo |
| `belohvosciks-kristians` Kristians Belohvosciks (LV) 2002-02-01 UCI 521844 | `belhovosciks-kristians` Kristians Belhovosciks (LV) 2002-02-01 | mismo nacimiento, mismo equipo |
| `bettles-carter` Carter Bettles (AU) 1998-09-02 UCI 878353 | `bettles-alan` Alan Bettles (AU) 1998-09-02 | mismo nacimiento, mismo equipo |
| `biesterbos-frits` Frits Biesterbos (NL) 2002-02-14 UCI 232930 | `besterbos-frits` Frits Besterbos (NL) 2002-02-14 | mismo nacimiento, mismo equipo |
| `bruno-andrea-alfio` Andrea Alfio Bruno (IT) 2003-02-04 UCI 289708 | `bruno-andrea` Andrea Bruno (IT) 2003-02-04 | mismo nacimiento |
| `bruun-bak-tristan` Tristan Bruun Bak (DK) 2006-03-31 | `bak-tristan` Tristan Bak (DK) 2006-03-31 | mismo nacimiento, mismo equipo |
| `bustamante-adrian` Adrian Bustamante (CO) 1998-06-10 | `bustamante-ruda-adrian-camilo` Adrian Camilo Bustamante Ruda (CO) 1998-06-10 UCI 101975 | mismo nacimiento, mismo equipo |
| `calderon-jeronimo` Jerónimo Calderón (CO) 2007-01-08 | `calderon-palacio-jeromino` Jeromino Calderon Palacio (CO) 2007-01-08 UCI 1438752 | mismo nacimiento, mismo equipo |
| `camargo-pineda-yeferson-cebastian` Yeferson Cebastian Camargo Pineda (CO) 2004-11-10 UCI 1159919 | `camargo-yeferson` Yeferson Camargo (CO) 2004-11-10 | mismo nacimiento, mismo equipo |
| `cambareri-bernardo-gaston` Bernardo Cambareri (AR) 2005-05-09 UCI 909005 | `campaner-bernardo` Bernardo* Campaner | nacimiento en una |
| `campbell-max` Max Campbell (AU) 2001-05-15 UCI 1248486 | `campbell-augustus` Augustus Campbell (AU) 2001-05-15 | mismo nacimiento, mismo equipo |
| `carstensen-magnus` Magnus Carstensen (DK) 2006-01-01 UCI 1139912 | `carstenten-magnus` Magnus Carstenten (DK) 2006-01-01 | mismo nacimiento, mismo equipo |
| `carvalho-sousa-bruno` Bruno Carvalho (BR) 2002-03-25 | `sousa-bruno` Bruno Sousa (BR) 2002-03-25 | mismo nacimiento |
| `cicek-mehmet` Mehmet Cicek (TR) 2006-02-02 | `cicek-emin-mehmet` Emin Mehmet Cicek (TR) 2006-02-02 UCI 1134990 | mismo nacimiento, mismo equipo |
| `collell-vallelado-marc` Marc Collell (ES) 2005-05-27 | `collell-vallellado-marc` Marc Collell Vallellado (ES) 2005-05-27 | mismo nacimiento |
| `coque-anthony-sebastian` Anthony Coque (EC) 2007-10-27 UCI 1227337 | `coque-guerra-anthony` Anthony Coque Guerra (EC) 2007-10-27 | mismo nacimiento |
| `corella-rene` Rene Corella (MX) 1991-09-30 | `corella-braun-rene-guillermo` Rene Guillermo Corella Braun (MX) 1991-09-30 UCI 65012 | mismo nacimiento, mismo equipo |
| `cowan-quentin` Quentin Cowan (CA) 2003-11-25 UCI 617591 | `cowen-quentin` Quentin Cowen (CA) 2003-11-25 | mismo nacimiento |
| `da-silva-tiano` Tiano Da Silva (ZA) 2001-04-17 UCI 745476 | `silva-tiano` Tiano Silva (ZA) 2001-04-17 | mismo nacimiento, mismo equipo |
| `daumas-remi` Rémi Daumas (FR) 2006-03-12 UCI 707502 | `dumas-remi` Rémi Dumas (FR) 2006-03-12 | mismo nacimiento, mismo equipo |
| `de-oliveira-pereira-gustavo-xavier` Gustavo Xavier (BR) 2001-10-13 | `oliveira-gustavo` Gustavo Oliveira (BR) 2001-10-13 | mismo nacimiento |
| `de-paula-victor-cesar` Victor Cesar De Paula (BR) 2003-06-12 UCI 1046132 | `paula-victor` Victor Paula (BR) 2003-06-12 | mismo nacimiento, mismo equipo |
| `de-rezende-junior-edson-gilmar` Edson Rezende Junior (BR) 1997-01-24 UCI 95843 | `rezende-edson` Edson Rezende (BR) 1997-01-24 | mismo nacimiento, mismo equipo |
| `diaz-garcia-juan-miguel` Juan Miguel Diaz Garcia (CO) 2006-09-03 | `diaz-juan-miguel` Juan Miguel Díaz (CO) 2006-09-03 | mismo nacimiento, mismo equipo |
| `dogan-ibrahim-halil` Ibrahim Halil Dogan (TR) 2000-10-06 UCI 532908 | `dogan-halil` Halil Dogan (TR) 2000-10-06 | mismo nacimiento, mismo equipo |
| `duque-cano-mateo` Mateo Duque Cano (AR) 2005-09-13 | `duque-mateo` Mateo Duque (AR) 2005-09-13 | mismo nacimiento, mismo equipo |
| `fernandes-peterson` Peterson Fernandes (BR) 2005-10-12 | `senegaglea-fernandes-peterson` Peterson Senegaglea (BR) 2005-10-12 | mismo nacimiento, mismo equipo |
| `feurstein-kilian` Kilian Feurstein (AT) 2003-06-06 UCI 351244 | `feurteins-kilian` Kilian Feurteins (AT) 2003-06-06 | mismo nacimiento, mismo equipo |
| `font-biel` Biel Font (ES) 2004-12-08 | `font-grandio-biel` Biel Font Grandio (ES) 2004-12-08 | mismo nacimiento, mismo equipo |
| `franquesa-adria` Adria Franquesa (ES) 2004-01-16 UCI 883648 | `franqueza-andria` Andria Franqueza (PT) 2004-01-16 | mismo nacimiento, país distinto, mismo equipo |
| `garcia-carlos-alfonso` Carlos Alfonso García (MX) 2003-11-21 | `garcia-carlos` Carlos García (MX) 2003-11-21<br>`garcia-trejo-carlos-alfonso` Carlos Alfonso García Trejo (MX) 2003-11-21 UCI 899703 | mismo nacimiento, mismo equipo |
| `gardner-thomas` Thomas Gardner (GB) | `gardner-arthur-thomas` Arthur Thomas Gardner (GB) 2004-02-06 | nacimiento en una, mismo equipo |
| `ghebregergish-habteab-yoel` Habteab Yoel Ghebregergish (ER) 2004-03-26 UCI 1188593 | `habteab-yoel` Yoel Habteab (ER) 2004-03-26 | mismo nacimiento, mismo equipo |
| `gil-sanchez-angel-alexander` Angel Alexander Gil Sanchez (CO) 1992-09-25 | `sanchez-angel` Angel Sanchez (CO) 1992-09-25 UCI 146720<br>`gil-angel` Ángel Gil (CO) 1992-09-25 | mismo nacimiento |
| `gonzalez-dasiel` Dasiel González (CU) 2005-07-04 | `gonzales-fuentes-dasiel` Dasiel Gonzales Fuentes (CU) 2005-07-04 | mismo nacimiento |
| `gonzalez-jyven` Jyven Gonzalez (BZ) 2002-03-23 | `gonzalez-felix-jahir-jyven` Felix Jahir Jyven Gonzalez (BZ) 2002-03-23 UCI 843078 | mismo nacimiento, mismo equipo |
| `guld-ridwan-daniel` Ridwan Daniel Guld (DK) 2000-12-09 UCI 543600 | `guld-daniel` Daniel Guld (DK) 2000-12-09 | mismo nacimiento, mismo equipo |
| `hadzistoyanov-borislav` Borislav Hadzistoyanov (BG) 2005-11-03 | `hadzhistoyanov-borislav` Borislav Hadzhistoyanov (BG) 2005-11-03 | mismo nacimiento |
| `halim-shahmir-aiman` Shahmir Aiman Halim (MY) 2000-04-24 UCI 597147 | `abd-halim-shahmir-aiman` Shahmir Aiman Abd Halim (MY) 2000-04-24 | mismo nacimiento, mismo equipo |
| `henriquez-alexis` Alexis Henriquez (PA) 1986-08-01 | `heriquez-joshep-alexis-gaspar` Alexis Gaspar Heriquez Joshep (PA) 1986-08-01 | mismo nacimiento |
| `jimenez-eleazar` Eleazar Jiménez (ES) 2006-09-23 | `jimenez-martinez-eleazar` Eleazar Jimenez Martinez (ES) 2006-09-23 | mismo nacimiento, mismo equipo |
| `jones-toby` Toby Jones (AU) 2007-10-28 UCI 1475298 | `jones-midge` Midge Jones (AU) 2007-10-28 | mismo nacimiento, mismo equipo |
| `just-pedersen-carl-emil` Carl Emil Just Pedersen (DK) 2006-01-16 UCI 594655 | `pedersen-carl-emil` Carl Emil Pedersen (DK) 2006-01-16<br>`pedersen-carl` Carl Pedersen (DK) 2006-01-16 | mismo nacimiento, mismo equipo |
| `kamstrup-rossel-alexander` Alexander Kamstrup Rossel (DK) 2007-06-28 | `rossel-alexander` Alexander Røssel (DK) 2007-06-28 | mismo nacimiento, mismo equipo |
| `kim-gukhyun` Gukhyun Kim (KR) 1999-03-15 UCI 713643 | `kim-kookhyun` Kookhyun Kim (KR) 1999-03-15 | mismo nacimiento, mismo equipo |
| `kyriakidis-ioannis` Ioannis Kyriakidis (GR) 1998-07-14 | `kiriakidis-ioannis` Ioannis Kiriakidis (GR) 1998-07-14 | mismo nacimiento, mismo equipo |
| `landsberg-stian` Stian Landsberg (ZA) 2006-05-29 UCI 1381309 | `landeberg-stian` Stian Landeberg (ZA) 2006-05-29 | mismo nacimiento, mismo equipo |
| `lesueur-dufrene-louka` Louka Lesueur Dufrene (FR) 2004-06-02 UCI 675931 | `lesueur-louka` Louka Lesueur (FR) 2004-06-02 | mismo nacimiento, mismo equipo |
| `linarez-leangel` Leangel Linarez (VE) 1997-08-07 UCI 896630 | `meneses-leangel` Leangel Meneses (VE) 1997-08-07 | mismo nacimiento, mismo equipo |
| `luis-strasser` Luis Strasser (DE) 2006-05-07 UCI 1283422 | `straber-luis` Luis Straber (DE) 2006-05-07 | mismo nacimiento, mismo equipo |
| `mancebo-francisco` Paco Mancebo (ES) 1976-03-09 UCI 546559 | `mancebo-francisco-2` Francisco Mancebo (ES) 1976-03-09 | mismo nacimiento, mismo equipo |
| `marenzi-lorenzo` Lorenzo Marenzi (HR) 1998-10-08 UCI 152596 | `merenzi-lorenzo` Lorenzo Merenzi (HR) 1998-10-08 | mismo nacimiento, mismo equipo |
| `martinsen-georg-rydningen` Georg Rydningen Martinsen (NO) 2005-09-17 UCI 941259 | `rydningen-martissen-georg` Georg Rydningen Martissen (NO) 2005-09-17 | mismo nacimiento, mismo equipo |
| `mc-dunphy-conn` Conn Mc Dunphy (IE) 1997-02-03 UCI 160271 | `mcdunphy-conn` Conn McDunphy (IE) 1997-02-03 | mismo nacimiento, mismo equipo |
| `melo-alex` Alex Melo (BR) 1993-11-17 | `ferreira-de-melo-alex` Alex Ferreira (BR) 1993-11-17 | mismo nacimiento, mismo equipo |
| `mirbagheri-nabi-seyyed-mohammad-nabi` Nabi Seyyed Mohammad Nabi Mirbagheri (IR) 2007-04-14 UCI 1440830 | `mirbagheri-firoozabadi-seyyed-mohammad-nabi` Seyyed Mohammad Nabi Mirbagheri Firoozabadi (IR) 2007-04-14 | mismo nacimiento, mismo equipo |
| `morales-ferlandy-eliu` Ferlandy Eliu Morales (GT) 2007-12-16 | `morales-garcia-ferlandy` Ferlandy Morales Garcia (GT) 2007-12-16 | mismo nacimiento |
| `mulubrhan-henok` Henok Mulubrhan (ER) 1999-11-11 UCI 235007 | `mulueberhan-henok` Henok Mulueberhan (ER) 1999-11-11 | mismo nacimiento, mismo equipo |
| `mulugeta-yafiet` Yafiet Mulugeta (ER) 2005-02-06 | `teweldebrhan-mulugeta-yaffiet` Yaffiet Teweldebrhan Mulugeta (ER) 2005-02-06 | mismo nacimiento |
| `naudi-rubio-miquel` Miquel Naudi Rubio (AD) 2005-07-02 | `naudi-miquel` Miquel Naudí (AD) 2005-07-02 | mismo nacimiento |
| `neaves-jadian` Jadian Neaves (TT) 2006-03-28 | `naeves-jadian` Jadian Naeves (TT) 2006-03-28 | mismo nacimiento |
| `nieto-edgar` Edgar Nieto (ES) 1986-07-28 UCI 520186 | `nohales-edgar` Edgar Nohales (ES) 1986-07-28 | mismo nacimiento, mismo equipo |
| `nilsson-julien-oscar` Julien Oscar Nilsson (FR) 2002-01-10 UCI 505276 | `nilson-julien-oscar` Oscar Nilson Julien (FR) 2002-01-10 | mismo nacimiento, mismo equipo |
| `ogando-jonathan` Jonathan Ogando (DO) 1985-07-16 | `ogando-reynoso-jonatan` Jonatan Ogando Reynoso (DO) 1985-07-16 | mismo nacimiento |
| `ong-tone-alexis-noah` Alexis Noah Ong Tone (MU) 2005-05-23 | `ong-tone-noah` Noah Ong Tone (MU) 2005-05-23 | mismo nacimiento |
| `panjoj-adonias-nelson` Adonias Nelson Panjoj (GT) 2002-10-24 | `panjoj-ajquijay-nelson` Nelson Panjoj Ajquijay (GT) 2002-10-24 | mismo nacimiento |
| `park-gyeongmin` Gyeongmin Park (KR) 2000-06-15 UCI 1000958 | `park-kyungmin` Kyungmin Park (KR) 2000-06-15 | mismo nacimiento |
| `paumann-david` David Paumann (AT) 2003-11-19 UCI 350365 | `pauman-david` David Pauman | nacimiento en una |
| `peretz-hardeball-matar` Matar Peretz Hardeball (IL) 2005-10-06 UCI 1191173 | `peretz-herdevall-matar` Matar Peretz Herdevall (IL) 2005-10-06 | mismo nacimiento, mismo equipo |
| `peter-luis` Luís Peter (BR) 2001-04-06 | `garbozza-peter-luis-eduardo` Luís Eduardo Garbozza (BR) 2001-04-06 | mismo nacimiento |
| `pita-hidrobo-alejandro` Alejandro Pita (EC) 2004-08-08 | `bladi-alejandro` Alejandro Bladi (EC) 2004-08-08 | mismo nacimiento |
| `prado-vitor` Vitor Prado (BR) 2003-11-05 | `pompeu-vitor-eduardo` Vitor Eduardo dos Santos (BR) 2003-11-05 | mismo nacimiento, mismo equipo |
| `prieto-jose-antonio` Jose Antonio Prieto (MX) 2004-01-01 | `prieto-de-luna-jose-antonio` José Antonio Prieto de Luna (MX) 2004-01-01 UCI 796060 | mismo nacimiento |
| `prieto-jose-juan` Jose Juan Prieto (MX) 2004-01-01 | `prieto-de-luna-jose-juan` José Juan Prieto de Luna (MX) 2004-01-01 UCI 796059 | mismo nacimiento |
| `proietti-mattia` Mattia Proietti (IT) 2007-08-01 UCI 314849 | `gagliardoni-mattia` Mattia Proietti Gagliardoni (IT) 2007-08-01 | mismo nacimiento, mismo equipo |
| `riera-casanovas-marti` Marti Riera Casanovas (AD) 1992-03-13 | `riera-marti` Martí Riera (AD) 1992-03-13 | mismo nacimiento |
| `riesebeek-oscar` Oscar Riesebeek (NL) 1992-12-23 UCI 72917 | `riesebek-oscar` Oscar Riesebek (NL) 1992-12-23 | mismo nacimiento, mismo equipo |
| `roberts-john-shaw` John Shaw Roberts (GB) 2003-07-23 | `roberts-john` John Roberts (GB) 2003-07-23 UCI 836715 | mismo nacimiento, mismo equipo |
| `romeo-abad-sergio-2` Sergio Romeo (ES) 2005-02-05 UCI 418883 | `romeo-abad-sergio` Sergio ROMEO ABAD (ES) | nacimiento en una |
| `rosario-brito-leandro` Leandro Rosário Brito (CV) 2006-02-03 | `rosario-leandro` Leandro Rosario (IT) 2006-02-03<br>`brito-leandro` Leandro Brito (CV) 2006-02-03 | mismo nacimiento, país distinto |
| `rubio-edwin-fabian` Edwin Fabian Rubio (CO) 2005-06-21 | `rubio-sierra-edwin-fabian` Edwin Fabian Rubio Sierra (CO) 2005-06-21 | mismo nacimiento |
| `rundva-richard` Richard Ründva (EE) 2006-05-16 UCI 768722 | `ruendva-richard` Richard Ruendva | nacimiento en una |
| `sahiri-ali-zakaria` Ali Zakaria Sahiri (DZ) 2005-09-08 UCI 1034753 | `sahiri-zakaria` Zakaria Sahiri (DZ) 2005-09-08 | mismo nacimiento, mismo equipo |
| `salanic-edwin-valentin` Edwin Valentin Salanic (GT) 2006-01-16 | `salanic-xiloj-edwyn` Edwyn Salanic Xiloj (GT) 2006-01-16 | mismo nacimiento |
| `sanchez-navia-mario` Mario Sánchez Navia (BO) 2007-03-25 | `sanchez-mario` Mario Sanchez (BO) 2007-03-25 UCI 1294181 | mismo nacimiento |
| `sancho-jose-pablo` Jose Pablo Sancho (CR) 2006-01-25 | `sancho-porras-jose` Jose Sancho Porras (CR) 2006-01-25 | mismo nacimiento |
| `santos-domingos-bruno-eduardo` Bruno Eduardo dos Santos (BR) 2007-01-19 | `santos-bruno` Bruno Santos (BR) 2007-01-19 | mismo nacimiento |
| `sarmiento-alvarez-andres-jose` Andres Jose Sarmiento Alvarez (EC) 2004-08-07 UCI 896163 | `sarmiento-jose-andres` Jose Andres Sarmiento (EC) 2004-08-07 | mismo nacimiento, mismo equipo |
| `schandorff-iwersen-emil` Emil Schandorff Iwersen (DK) 2002-08-15 UCI 438462 | `iwersen-emil` Emil Iwersen (DK) 2002-08-15 | mismo nacimiento, mismo equipo |
| `scott-cameron` Cameron Scott (AU) 1998-01-04 UCI 106649 | `scott-nicholas` Nicholas Scott (AU) 1998-01-04 | mismo nacimiento, mismo equipo |
| `sherwin-matthew` Matthew Sherwin (AU) 1985-11-11 UCI 131675 | `sherwin-matt` Matt Sherwin (AU) 1985-11-11 | mismo nacimiento |
| `shin-byeonghoon` Byeonghoon Shin (KR) 2004-05-30 UCI 1341551 | `sin-byeonghoon` Byeonghoon Sin (KR) 2004-05-30 | mismo nacimiento |
| `silva-davi` Davi Silva (BR) 2002-05-28 | `da-silva-vieira-davi-gabriel` Davi Gabriel da Silva Vieira (BR) 2002-05-28 | mismo nacimiento |
| `stenning-oliver` Oliver Stenning (AU) 1998-02-27 UCI 979176 | `stenning-frederick` Frederick Stenning (AU) 1998-02-27 | mismo nacimiento, mismo equipo |
| `syelhan-muhammad` Muhammad Syelhan (ID) 2005-04-21 UCI 922841 | `nurrahmat-muhammad-syelhan` Muhammad Syelhan Nurrahmat (ID) 2005-04-21 | mismo nacimiento |
| `tenniglo-niels` Niels Tenniglo (NL) 2004-05-18 | `tenninglo-niels` Niels Tenninglo (NO) 2004-05-18 | mismo nacimiento, país distinto, mismo equipo |
| `teweldemedhn-desta-amaniel` Amaniel Teweldemedhn Desta (ET) 2005-09-19 UCI 1562289 | `desta-teweldemedhn` Teweldemedhn Desta (ET) 2005-09-19 | mismo nacimiento, mismo equipo |
| `tijani-quwam` Quwam Tijani (NG) 2005-12-02 | `tijiani-quwam-afolajomi` Quwam Afolajomi Tijiani (NG) 2005-12-02 | mismo nacimiento, mismo equipo |
| `uncilla-aldasoro-mikel` Mikel Uncilla (ES) 2004-10-26 | `uncilla-aldaroso-mikel` Mikel Uncilla Aldaroso (ES) 2004-10-26 | mismo nacimiento |
| `urian-david` David Urian (CO) 2005-04-13 | `urian-caro-david-juan` David Juan Urian Caro (CO) 2005-04-13 UCI 1060082 | mismo nacimiento, mismo equipo |
| `valenti-luke` Luke Valenti (CA) 2004-06-05 | `valenti-luke-david` Luke David Valenti (CA) 2004-06-05 UCI 543248 | mismo nacimiento |
| `van-der-wal-rik` Rik van der Wal (NL) 2003-10-02 UCI 234422 | `van-de-wal-rik` Rik van de Wal | nacimiento en una |
| `velez-cristian` Cristian Vélez (CO) 2005-02-16 | `velez-riveros-cristian-damian` Cristian Damian Velez Riveros (CO) 2005-02-16 UCI 352448 | mismo nacimiento, mismo equipo |
| `veslum-sebastian` Sebastian Veslum (NO) 2005-10-22 UCI 739387 | `velsum-sebastian` Sebastian Velsum (NO) 2005-10-22 | mismo nacimiento |
| `vittinghus-stokbro-sylvester` Sylvester Vittinghus Stokbro (DK) 2007-07-16 UCI 1247042 | `stokbro-sylvester` Sylvester Stokbro (DK) 2007-07-16 | mismo nacimiento, mismo equipo |
| `vollmuth-aidan` Aidan Vollmuth (US) 2007-09-18 UCI 1222520 | `vollmuth-daidan` Daidan Vollmuth (US) 2007-09-18 | mismo nacimiento, mismo equipo |
| `walsh-liam` Liam Walsh (AU) 2001-05-29 UCI 728761 | `walsh-derek` Derek Walsh (AU) 2001-05-29 | mismo nacimiento, mismo equipo |
| `weigelt-mikkel-bang-fredso` Mikkel Bang Fredso Weigelt (DK) 2007-11-05 | `bang-fredsoo-weigelt-mikkel` Mikkel Bang Fredsoo Weigelt (DK) 2007-11-05 | mismo nacimiento, mismo equipo |
| `werf-sven` Sven van der Werf (NL) 2004-11-16 | `der-werf-sven` Sven der Werf (NL) 2004-11-16 | mismo nacimiento, mismo equipo |
| `wessling-gianluca` Gianluca Weßling (DE) | `weissling-gianluca` Gianluca Weissling (DE) 2003-11-14 | nacimiento en una, mismo equipo |
| `wikander-tord` Tord Wikander (NO) 2004-10-18 | `wikander-tord-aasgaard` Tord Aasgaard Wikander (NO) 2004-10-18 UCI 1368198 | mismo nacimiento, mismo equipo |
| `zabelinskiy-bogdan` Bogdan Zabelinskiy (CY) 2005-01-12 UCI 843954 | `zabelinsky-bogdan` Bogdan Zabelinsky (CY) 2005-01-12 | mismo nacimiento, mismo equipo |
| `zarate-anima-michael` Michael Zárate Ánima (MX) 2004-03-11 | `zarate-animas-michael` Michael Zarate Animas | nacimiento en una |

## Anexo C. Pares pendientes (17)

| Par | Motivo |
|---|---|
| `artuso-marco` Marco Artuso (IT) 2006-08-24<br>`guercilena-marco` Marco Guercilena (IT) 2006-08-24 | apellidos distintos; mismo nacimiento y país; sin equipo común |
| `barrientos-diego` Diego Barrientos (GT) 2007-01-18<br>`barrios-mazariegos-diego` Diego Barrios Mazariegos (GT) 2007-01-18 | Barrientos frente a Barrios Mazariegos; mismo nacimiento y país |
| `biberg-bruno` Bruno Biberg (BR) 1996-12-13<br>`martins-lemes-bruno` Bruno Lemes (BR) 1996-12-13 UCI 98398 | apellidos distintos; mismo nacimiento y equipo (Localiza, dorsal 1); verificar «Biberg» en la lista de la Volta SP |
| `jorgensen-emil` Emil Jørgensen (DK) 1996-05-28<br>`toudal-emil` Emil Toudal (DK) 1996-05-28 UCI 97671 | apellidos distintos; mismo nacimiento y país |
| `barbosa-salgueiro-jose-miguel` Jose Miguel Barbosa Salgueiro (PT) 2007-05-03<br>`salgueiro-jose` José Salgueiro (PT) | José Salgueiro (Teis) sin nacimiento; Barbosa Salgueiro en equipos portugueses |
| `bolton-max` Max Bolton (GB) 2002-10-07<br>`bufton-max` Max Bufton (GB) | Bolton frente a Bufton (Surne Bilbao); sin dato común |
| `perez-cesar` César Pérez (ES) 2004-11-23 UCI 409362<br>`perez-lopez-cesar` Cesar PEREZ LOPEZ (ES) | ficha sin referencias; segundo apellido no verificado |
| `zhang-han` Han Zhang (CN) 1992-11-15 UCI 1685829<br>`zhang-hanyu` Hanyu Zhang (CN) | Han frente a Hanyu; nacimiento solo en una |
| `garcia-jose-armando` José Armando García (EC) 2003-02-01<br>`garcia-olaya-jose` Jose Garcia Olaya (CO) 2003-02-01 | EC frente a CO; mismo nacimiento |
| `herrera-karol-mariana` Karol Mariana Herrera (CO) 2005-01-22<br>`herrera-mariana` Mariana Herrera (CO) 2001-01-12 | mismo equipo; nacimientos 2005-01-22 y 2001-01-12 |
| `adam-cameron` Cameron Adam (GB) 2005-09-09<br>`harrison-cameron` Cameron Harrison (AU) 2006-07-04 UCI 1361408 | mismo equipo; GB 2005 frente a AU 2006 |
| `cooper-morris-william` Morris William Cooper (AU) 2004-03-05 UCI 1245485<br>`morris-william` William Morris (GB) 2009-02-02 | mismo equipo; AU 2004 frente a GB 2009 |
| `juan-lopez-1997` Juan López (CO) 1997-04-23<br>`lopez-salcedo-juan-jose` Juan José López Salcedo (CO) 2005-07-22 | mismo equipo; nacimientos 1997 y 2005 |
| `marte-roger` Roger Marte (DO) 2004-07-05<br>`marte-valdez-roger` Roger Marte Valdez (DO) 2004-07-07 | nacimientos 2004-07-05 y 2004-07-07 |
| `pimentel-abrego-jesus` Jesus Pimentel Abrego (PA) 2005-09-29<br>`pimentel-jesus` Jesus Pimentel (PA) 2005-12-15 | nacimientos 2005-09-29 y 2005-12-15 |
| `raus-jerome` Jérôme Raus (BE) 2003-06-25 UCI 666830<br>`raus-jerome-2007` Jérôme Raus (BE) 2007-03-02 | personas distintas (2003 y 2007); posible enlace erróneo de raus-jerome en Ixina Classic (Dovy Keukens) |
| `silva-baeza-mario` Mario Silva Baeza (ES) 2003-06-27 UCI 1248830<br>`silva-mario` Mário Silva (PT) 1993-01-01 | mismo equipo; ES 2003 frente a PT 1993-01-01 |
