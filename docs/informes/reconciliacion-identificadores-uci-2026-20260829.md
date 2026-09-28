# Reconciliación de identificadores UCI 2026 — 2026-08-29

> **Nota de contrato vigente (2026-08-30):** este runbook es histórico. En aquella operación `uciId` se utilizó para el perfil interno `/rider-details/<id>`. El contrato actual separa ese dato en `uciProfileId` y reserva `uciId` al código UCI de licencia de 11 cifras. El detalle de la migración y el saneo global está en [`limpieza-global-uci-ids-20260830.md`](limpieza-global-uci-ids-20260830.md).

## Alcance y semántica

Operación dirigida sobre los 233 candidatos que quedaron sin identificador tras el censo del roster UCI 2026. El campo `uciId` de `riders_men` y `riders_women` conserva el identificador interno numérico de la ficha oficial (`/rider-details/<id>`). No es el código UCI de licencia de 11 dígitos que DataRide muestra en algunas clasificaciones (`UciId`). Esta operación no escribe códigos de licencia ni modifica resultados: esa equivalencia requiere un campo y una fuente específica.

El censo de partida obtuvo 277 equipos UCI válidos, 4.236 entradas de roster y 4.212 perfiles internos únicos. Frente a 4.208 afiliaciones 2026 y 4.198 corredores únicos enlazados, quedaron 233 candidatos sin ficha UCI asignada. Las fichas UCI consultadas devolvieron HTTP 200, fecha y nacionalidad para 232 candidatos; `1610729` devolvió HTTP 404.

Fuentes reproducibles: roster oficial `https://www.uci.org/team-details/<teamId>`; ficha oficial `https://www.uci.org/rider-details/<uciId>`; catálogo de corredores y afiliaciones de Supabase consultados antes de escribir. Huellas SHA-256 de los artefactos de auditoría local:

- `cc-uci-rosters-2026.json`: 2825df66a976de9220ee91109a420ba6f7acf45dbd21487e3031cdb66e0046c4
- `cc-pending-uci-details-2026.json`: e23683e40a0fb55dbcb11252b300cc694e87769699a312061854629db87c81d3
- `cc-pending-uci-smart-2026.json`: 30a4866c4f50abf1b0ac3ef6a00263df3e6cb26c70a0b69cc4240e846e025e84

## Decisiones autorizadas

- 165 candidatos se asignan a una ficha existente por nombre UCI, fecha de nacimiento UCI y género; las diferencias de equipo o nacionalidad se conservan como evidencia y no se sobrescriben.
- 27 candidatos se asignan manualmente a fichas existentes por evidencia nominal, fecha, nacionalidad, equipo o variante de uso. Solo se modifica `uciId`; no se corrigen en este lote fechas o nacionalidades discrepantes.
- 40 candidatos se dan de alta como fichas mínimas `catalog_gold` con nombre separado del roster UCI, fecha y nacionalidad UCI, `verified=true` y sin afiliación, startlist ni resultado nuevo.
- 1 candidato se excluye: `1610729`, Cj Williams. La ficha UCI no es accesible y no hay fecha de nacimiento; una fuente externa lo identifica como miembro del staff de L39ION en 2026, por lo que no se crea una ficha de corredor.

## Actualizaciones a fichas existentes — 192

| UCI perfil | Género | Nombre en UCI | Fecha UCI | País | Ficha seleccionada | Decisión |
|---:|:---:|:---|:---:|:---:|:---|:---|
| 28896 | M | Victor MARTINEZ GARCIA | 1985-01-28 | es | `martinez-garcia-victor` | exacta UCI |
| 32469 | M | Bayron GUAMA | 1985-06-14 | ec | `guama-bayron` | exacta UCI |
| 58628 | M | Stefan PÖLL | 1986-07-28 | at | `poll-stefan` | manual |
| 60032 | M | Lawrence WARBASSE | 1990-06-28 | us | `warbasse-lawrence` | manual |
| 68789 | M | Rafael REIS | 1992-07-15 | pt | `reis-rafael` | exacta UCI |
| 71688 | M | Sandro JENNEWEIN | 1991-08-18 | at | `jennewein-sandro` | exacta UCI |
| 86938 | M | Maximilian SCHACHMANN | 1994-01-09 | de | `schachmann-max` | exacta UCI |
| 87061 | M | Fabio JAKOBSEN | 1996-08-31 | nl | `jakobsen-fabio` | exacta UCI |
| 87140 | M | Nassim SAIDI | 1994-12-09 | dz | `saidi-nassim` | manual |
| 88660 | F | Kimberley LE COURT DE BILLOT - PIENAAR | 1996-03-23 | mu | `le-court-pienaar-kim` | exacta UCI |
| 90493 | M | Vasili STROKAU | 1995-10-09 | by | `strokau-vasili` | exacta UCI |
| 91152 | F | Alexandra MANLY | 1996-02-28 | au | `manly-alex` | exacta UCI |
| 92264 | M | Daniel Felipe MARTINEZ POVEDA | 1996-04-25 | co | `martinez-dani` | manual |
| 94163 | M | Willem Jakobus SMIT | 1992-12-29 | za | `smit-willie` | exacta UCI |
| 94953 | F | Maria Apolonia VAN 'T GELOOF | 1996-03-27 | nl | `van-t-geloof-marjolein` | exacta UCI |
| 97939 | M | Edward DUNBAR | 1996-09-01 | ie | `dunbar-edward` | exacta UCI |
| 100859 | M | Nikita KIRZHAYKIN | 1993-10-04 | ru | `kirzhaykin-nikita` | exacta UCI |
| 100895 | M | William BARTA | 1996-01-04 | us | `barta-will` | exacta UCI |
| 109960 | M | William Lyndhurst Christopher HARPER | 1994-11-23 | au | `harper-chris` | exacta UCI |
| 111686 | M | William Harrison SWEENY | 1998-07-09 | au | `sweeny-harry` | exacta UCI |
| 131675 | M | Matt SHERWIN | 1985-11-11 | au | `sherwin-matthew` | exacta UCI |
| 146941 | M | Krzysztof PARMA | 1987-03-08 | pl | `parma-krzysztof` | exacta UCI |
| 148716 | M | Tegshbayar BATSAIKHAN | 1998-06-01 | mn | `batsaikhan-tegsh-bayar` | exacta UCI |
| 148938 | M | Hugo NUNES | 1996-11-17 | pt | `nunes-hugo` | exacta UCI |
| 150212 | M | Nahum Fredd MATUTE | 1985-10-26 | hn | `matute-fredd` | exacta UCI |
| 153275 | M | Alfred Brockwell WRIGHT | 1999-06-13 | gb | `wright-fred` | exacta UCI |
| 153513 | M | Juan Pedro LOPEZ PEREZ | 1997-07-31 | es | `lopez-juan-pedro` | exacta UCI |
| 156215 | M | Emanuel DUARTE | 1997-01-24 | pt | `duarte-emanuel` | exacta UCI |
| 156216 | M | Gonçalo LEAÇA | 1997-10-29 | pt | `leaca-goncalo` | exacta UCI |
| 171563 | M | Liam O BRIEN | 2005-03-16 | ie | `o-brien-liam` | exacta UCI |
| 174924 | F | Caoimhe O BRIEN | 2002-04-17 | ie | `o-brien-caoimhe` | exacta UCI |
| 195755 | F | Rikke Steen ENSTAD | 2002-12-26 | no | `steen-enstad-rikke` | exacta UCI |
| 198733 | M | Henrik E. FARSTADVOLL | 2003-02-17 | no | `farstadvoll-henrik-eckmann` | exacta UCI |
| 206388 | M | Erik REGE | 2007-10-27 | no | `rege-erik` | exacta UCI |
| 217794 | M | Joshua KENCH | 2001-05-06 | nz | `kench-josh` | exacta UCI |
| 220314 | M | Christian RUSH | 2001-12-10 | nz | `rush-christian` | manual |
| 227737 | M | Rens GRÖMMEL | 2005-01-11 | nl | `grommel-rens` | exacta UCI |
| 232822 | M | Tim V.D. POEL | 2005-02-05 | nl | `v-d-poel-tim` | exacta UCI |
| 233309 | M | Niels REEMEIJER | 2002-07-04 | nl | `reemeijer-niels` | exacta UCI |
| 234022 | M | Thijs VRIJ | 2006-12-15 | nl | `vrij-thijs` | exacta UCI |
| 235007 | M | Henok MULUEBERHAN | 1999-11-11 | er | `mulubrhan-henok` | exacta UCI |
| 235741 | M | Raul ROTA RUS | 1999-11-18 | es | `rota-rus-raul` | exacta UCI |
| 289074 | M | Riccardo BARBUTO | 2005-07-27 | it | `barbuto-riccardo` | manual |
| 293226 | M | Jacopo COLLEONI | 2005-08-15 | it | `colleoni-jacopo` | exacta UCI |
| 305610 | M | Riccardo FABBRO | 2006-11-18 | it | `fabbro-riccardo` | exacta UCI |
| 354434 | M | Edinson Alejandro CALLEJAS SANTOS | 2000-11-25 | co | `callejas-edison-alejandro` | exacta UCI |
| 364540 | M | Arnt Alexander HANSEN | 2003-05-13 | dk | `hansen-alexander` | exacta UCI |
| 365915 | M | Rokas ADOMAITIS | 2004-08-06 | lt | `adomaitis-rokas` | exacta UCI |
| 379696 | M | Juan Jose LOPEZ RODRIGUEZ | 2006-09-13 | es | `lopez-juan-jose` | exacta UCI |
| 379788 | M | Luis Alberto LAJARIN ROJAS | 2006-10-28 | es | `lajarin-rojas-luis-alberto` | exacta UCI |
| 395256 | M | Francisco MUÑOZ LLANA | 2001-06-24 | es | `munoz-llana-francisco` | exacta UCI |
| 398547 | F | Margarita Victoria GARCIA CAÑELLAS | 1984-01-02 | es | `garcia-mavi` | exacta UCI |
| 409037 | M | Estanislao CALABUIG VAZQUEZ | 2004-10-28 | es | `calabuig-estanislao` | exacta UCI |
| 417077 | M | Julen ARRIOLA-BENGOA BEITIA | 2001-02-16 | es | `arriolabengoa-julen` | exacta UCI |
| 421019 | M | Alain SUAREZ FERNANDEZ | 2003-02-12 | es | `suarez-fernandez-alain` | manual |
| 422366 | M | Ion IZAGUIRRE INSAUSTI | 1989-02-04 | es | `izagirre-ion` | exacta UCI |
| 437966 | M | Mathias Alexander E. LARSEN | 1999-05-02 | dk | `larsen-mathias-alexander-erik` | exacta UCI |
| 441138 | M | João MEDEIROS | 2000-08-04 | pt | `medeiros-joao` | exacta UCI |
| 442534 | M | João MARTINS | 2004-03-27 | pt | `martins-joao` | manual |
| 443476 | M | Duarte DOMINGUES | 2004-02-29 | pt | `domingues-duarte` | exacta UCI |
| 446383 | M | Diogo PINTO | 2003-02-21 | pt | `pinto-diogo` | exacta UCI |
| 446459 | M | Diogo NARCISO | 2001-11-19 | pt | `narciso-diogo` | exacta UCI |
| 454633 | M | Maximilian Richard WALSCHEID | 1993-06-13 | de | `walscheid-max` | exacta UCI |
| 462676 | M | Nicolya VINOKUROV | 2002-07-07 | kz | `vinokurov-nicolas` | exacta UCI |
| 474497 | F | Hanka VIKOVÁ | 2007-01-06 | cz | `vikova-hanka` | exacta UCI |
| 490106 | M | Floris HAVERDINGS | 2006-10-13 | nl | `haverdings-floris` | exacta UCI |
| 498090 | M | Djordje DJURIC | 2000-06-21 | rs | `duric-dorde` | exacta UCI |
| 500919 | M | Nur Amirull Fakhruddin MAZUKI | 1992-01-24 | my | `mazuki-nur-amirul-fakhruddin` | exacta UCI |
| 535959 | M | Filip PANTZARE | 2007-12-20 | se | `pantzare-filip` | exacta UCI |
| 541508 | M | Andres Libardo MANCIPE PUIN | 2002-07-10 | co | `mancipe-puin-andres-libardo` | exacta UCI |
| 544206 | F | Lea WALDHOFF | 2002-03-20 | de | `waldhoff-lea` | exacta UCI |
| 546559 | M | Francisco MANCEBO PEREZ | 1976-03-09 | es | `mancebo-francisco` | exacta UCI |
| 547758 | M | Daniel JORGE | 2004-11-02 | pt | `jorge-daniel` | exacta UCI |
| 550182 | M | Gustav LOVIDIUS | 2004-08-27 | se | `lovidius-gustav` | exacta UCI |
| 552214 | M | Lucas PLAPP | 2000-12-25 | au | `plapp-luke` | exacta UCI |
| 552934 | M | Joshua TARLING | 2004-02-15 | gb | `tarling-josh` | exacta UCI |
| 582958 | M | Nikita SHULCHENKO | 1999-05-31 | ru | `shulchenko-nikita` | exacta UCI |
| 607497 | M | Matic ŽUMER | 1997-11-19 | si | `zumer-matic` | exacta UCI |
| 621950 | M | Jack ROOTKIN-GRAY | 2002-11-05 | gb | `rootkin-gray-jack` | exacta UCI |
| 623133 | M | Jacob ROY | 2006-11-30 | ca | `roy-jacob` | exacta UCI |
| 626523 | M | Borislav Borislavov PALASHEV | 2002-05-13 | bg | `palashev-borislav` | exacta UCI |
| 633000 | M | Rodrigo GOICOLEA MENA | 1988-03-25 | gt | `goicolea-rodrigo` | exacta UCI |
| 635669 | F | Molly Isabel SHARP | 2005-06-29 | gb | `sharp-molly-isabel` | exacta UCI |
| 642257 | M | Leonardo DI SANTO | 2005-06-24 | it | `di-santo-leonardo` | exacta UCI |
| 646800 | M | Matthias WOLASCHKA | 2006-03-13 | de | `wolaschka-matthias` | exacta UCI |
| 648064 | M | Luke ELPHINGSTONE | 2003-02-28 | us | `elphingstone-luke` | exacta UCI |
| 650658 | M | Warre VAN DEN MEERSSCHE | 2004-07-18 | be | `van-den-meerssche-warre` | exacta UCI |
| 651526 | M | Matteo VANHUFFEL | 2006-08-27 | be | `vanhuffel-matteo` | exacta UCI |
| 659823 | M | Hugo TAPIZ | 2005-12-13 | fr | `tapiz-hugo` | exacta UCI |
| 661604 | M | Adam STREJČEK | 2006-11-24 | cz | `strejcek-adam` | exacta UCI |
| 662109 | M | Clement DUBOIS | 2005-05-10 | fr | `dubois-clement` | exacta UCI |
| 687216 | F | Zoe BIHAN | 2008-05-27 | fr | `bihan-zoe` | exacta UCI |
| 696406 | M | Jeferson Armando RUIZ ACUÑA | 2002-07-06 | co | `ruiz-acuna-jeferson-armando` | exacta UCI |
| 709756 | F | Mathilde TRITZ | 2007-10-08 | fr | `tritz-mathilde` | exacta UCI |
| 711187 | M | Fabien Nicolas ARTHEIN | 2002-07-31 | fr | `arthein-fabien-nicolas` | exacta UCI |
| 713251 | M | Rafael PHILIPPE | 2006-11-26 | fr | `philippe-rafael` | exacta UCI |
| 717697 | F | Solène MARNONI | 2004-06-21 | fr | `marnoni-solene` | exacta UCI |
| 726360 | M | João OLIVEIRA | 2002-11-22 | pt | `oliveira-joao` | exacta UCI |
| 729030 | F | Laura PONCET | 2005-08-30 | fr | `poncet-laura` | exacta UCI |
| 742711 | F | Emma GOTTOLI | 2007-07-04 | it | `gottoli-emma` | manual |
| 747569 | M | Nicholas SCHULTZ | 1994-09-13 | au | `schultz-nick` | exacta UCI |
| 757954 | M | Abdallah BEN YOUCEF | 1987-04-10 | dz | `benyoucef-addallah` | exacta UCI |
| 774551 | M | Cas HERMANS | 2006-03-28 | be | `hermans-cas` | exacta UCI |
| 789967 | F | Victoria Teniel CAMPBELL | 1997-09-23 | tt | `campbell-teniel` | exacta UCI |
| 790555 | M | Alin TOADER | 2004-12-04 | ro | `toader-alin` | exacta UCI |
| 792612 | F | Karolína ŠPICAROVÁ | 2008-06-18 | cz | `spicarova-karolina` | exacta UCI |
| 794557 | M | Matthias VIVIER | 2007-11-20 | be | `vivier-matthias` | exacta UCI |
| 795876 | M | David Joshua GOLLIKER | 2004-03-23 | gb | `golliker-david-joshua` | exacta UCI |
| 804619 | M | Lukas BLANCO LLANES | 2002-07-29 | co | `blanco-lukas` | exacta UCI |
| 825096 | M | Ola Blikberg HERHEIM | 2007-08-15 | no | `herheim-ola` | manual |
| 826848 | F | Sophie Madelaine LEECH | 2003-05-04 | gb | `leech-madelaine` | manual |
| 829540 | F | Tsuyaka UCHINO | 2002-01-13 | jp | `uchino-tsuyaka` | exacta UCI |
| 834256 | M | Sum Lui NG | 1999-10-28 | hk | `ng-sum-lui` | exacta UCI |
| 837584 | M | Finn MCKENZIE | 2006-10-26 | nz | `mckenzie-finn` | exacta UCI |
| 840851 | M | Thomas William SMITH | 2004-03-21 | gb | `smith-thomas-william` | exacta UCI |
| 846612 | M | Wenjie ZHANG | 1999-03-14 | cn | `zhang-wenjie` | exacta UCI |
| 862522 | M | Wouter POELS | 1987-10-01 | nl | `poels-wout` | exacta UCI |
| 878987 | M | Pablo TORRES ARIAS | 2005-11-10 | es | `torres-pablo` | exacta UCI |
| 896630 | M | Leangel MENESES | 1997-08-07 | ve | `meneses-leangel` | exacta UCI |
| 904240 | M | Filip SURDYK | 2005-01-16 | pl | `surdyk-filip` | exacta UCI |
| 909599 | M | Arnaud LAJOIE | 2007-05-31 | ca | `lajoie-arnaud` | exacta UCI |
| 919408 | M | Bjerregaard Sebastian VESTERGAARD | 2006-02-03 | dk | `vestergaard-sebastian-bjerregaard` | exacta UCI |
| 920369 | M | Matthias ERLACHER | 2001-01-26 | at | `erlacher-matthias` | exacta UCI |
| 924214 | M | Mattew-Denis PICIU | 2002-06-21 | ro | `piciu-mattew-denis` | manual |
| 927529 | M | Kryštof BAŽANT | 2007-09-12 | cz | `bazant-krystof` | exacta UCI |
| 928931 | F | Anna DUBCOVÁ | 2008-06-13 | cz | `dubcova-anna` | exacta UCI |
| 939266 | M | Ákos MINDSZENTI | 2004-11-14 | hu | `mindszenti-akos` | exacta UCI |
| 945567 | M | Magnus FLATERUD | 2007-01-28 | no | `flaterud-magnus` | exacta UCI |
| 952080 | M | Marc RUBIROLA VILA | 2004-09-30 | es | `rubirola-vila-marc` | exacta UCI |
| 960521 | M | Lorenz KRUMPL | 2004-07-28 | at | `krumpl-lorenz` | manual |
| 961245 | F | Lidia CUSACK | 2007-02-18 | us | `cusack-lidia` | exacta UCI |
| 961345 | M | Wing Chung NG | 1998-06-18 | hk | `ng-wing-chung` | exacta UCI |
| 965254 | M | Sebastian GRINDLEY | 2006-04-24 | gb | `grindley-seb` | exacta UCI |
| 973822 | M | Thanachat YATAN | 1991-10-01 | th | `yatan-thanachat` | exacta UCI |
| 978019 | M | Fabricio German CROZZOLO | 2005-03-17 | ar | `crozzolo-fabrizio` | exacta UCI |
| 995597 | M | Unax ERRASTI URTEAGA | 2005-02-15 | es | `errasti-urteaga-unax` | manual |
| 1006272 | M | James FORBES | 2002-10-01 | au | `forbes-james` | exacta UCI |
| 1009713 | M | Thijmen VAN DER GIESSEN | 2005-07-26 | nl | `van-der-giessen-thijmen` | exacta UCI |
| 1013042 | M | David CASTELLO MARTIN | 2007-10-25 | es | `castello-david` | manual |
| 1037411 | M | Nil AGUILERA JORBA | 2004-05-30 | es | `aguilera-nil` | exacta UCI |
| 1052186 | M | Elijah WITZACK | 2007-08-08 | de | `elijah-witzack` | exacta UCI |
| 1066950 | M | Peter ŠOLTÉS | 2007-03-21 | sk | `soltes-peter` | exacta UCI |
| 1067033 | M | Gaëtan WARNIER | 2005-07-15 | be | `warnier-gaetan` | exacta UCI |
| 1069065 | F | Kyra MARETT | 2007-08-09 | nz | `marett-kyra` | exacta UCI |
| 1072317 | M | Simon SCHABERNIG | 2005-10-14 | at | `schabernig-simon` | exacta UCI |
| 1085194 | M | Mathis GUERINEL | 2005-03-16 | fr | `guerinel-mathis` | exacta UCI |
| 1091800 | F | Viivi TURPEINEN | 2006-04-30 | fi | `turpeinen-viivi` | manual |
| 1123964 | M | Jaume ESPUIS REL | 1999-06-15 | es | `espuis-jaume` | manual |
| 1138991 | M | Edward Anthony Oliver SIMS | 2006-03-07 | au | `sims-oliver` | exacta UCI |
| 1141038 | M | Steven Johan RUBIO LARGO | 2006-08-16 | co | `rubio-largo-johan` | exacta UCI |
| 1145362 | M | Ottoniel Willson CHONAY BATZ | 2003-02-14 | gt | `chonay-batz-ottoniel-willson` | exacta UCI |
| 1158850 | M | Emilio GARCIA GOMEZ | 2006-11-23 | es | `garcia-gomez-emilio` | manual |
| 1171537 | M | Tobias FISCHER | 2007-08-05 | at | `fischer-tobias` | exacta UCI |
| 1177425 | M | Noah SHELTON | 2006-08-29 | us | `shelton-noah` | exacta UCI |
| 1185576 | M | Karl HALL | 2004-06-26 | de | `hall-karl` | manual |
| 1195284 | F | Ana Vitoria GOUVEA VIEIRA ALMEIDA MAGALHAES | 2000-10-24 | br | `magalhaes-tota` | exacta UCI |
| 1196932 | F | Catrin FERGUSON | 2006-04-27 | gb | `ferguson-cat` | exacta UCI |
| 1206005 | F | Charlotte BOUHIER | 2007-07-31 | fr | `bouhier-charlotte` | manual |
| 1215846 | F | Georgia LANCASTER | 2005-05-23 | gb | `lancaster-georgia` | manual |
| 1216708 | M | Yoshio WATASE | 2001-03-23 | jp | `watase-yoshio` | manual |
| 1217874 | M | Ben BOROFF | 2005-12-01 | us | `boroff-ben` | exacta UCI |
| 1218800 | M | Eñaut URCAREGUI SANZ | 2007-04-02 | es | `urcaregui-sanz-enaut` | exacta UCI |
| 1276709 | M | Emilien JACQUELIN | 1995-07-11 | fr | `jacquelin-emilien` | exacta UCI |
| 1283508 | M | Matthias JEINDL | 2001-01-27 | at | `jeindl-matthias` | exacta UCI |
| 1306369 | F | Mizuki IKEDA | 2004-08-06 | jp | `ikeda-mizuki` | exacta UCI |
| 1321690 | M | Matthew MAY | 2002-01-30 | au | `may-matthew` | exacta UCI |
| 1324332 | M | William Jack BALDIE | 2007-06-25 | gb | `baldie-jack` | exacta UCI |
| 1330088 | M | Charles William HOLMES | 2006-02-20 | au | `holmes-charles-william` | exacta UCI |
| 1333512 | M | Oliver DAWSON | 2006-09-19 | gb | `dawson-oliver` | exacta UCI |
| 1381783 | M | Keegam SWIRBUL | 1995-09-02 | us | `swirbul-keegan` | exacta UCI |
| 1386224 | M | Ren MOCHIZUKI | 2006-08-13 | jp | `mochizuki-ren` | exacta UCI |
| 1406887 | F | Emily Sophia SAMMONS | 2005-09-18 | au | `sammons-sophia` | exacta UCI |
| 1438000 | F | Jana MEUS | 2000-06-29 | de | `meus-jana` | exacta UCI |
| 1443007 | M | Gergő GRÓSZ | 2006-10-15 | hu | `grosz-gergo` | manual |
| 1461258 | F | Hao ZHANG | 2000-06-10 | cn | `zhang-hao` | exacta UCI |
| 1475757 | M | Mukhammed Ali MATKARIMOV | 2005-07-29 | kg | `matkarimov-mukhammed-ali` | exacta UCI |
| 1484279 | M | Pablo Mateo RAMIREZ TORRES | 2006-03-09 | ec | `ramirez-torres-pablo-mateo` | exacta UCI |
| 1490188 | M | Pere BARCELO FERRER | 2007-05-17 | es | `barcelo-pere` | manual |
| 1494715 | M | Jose Said CISNEROS DIAZ DE LEON | 2007-04-23 | mx | `cisneros-diaz-de-leon-jose-s` | manual |
| 1500752 | M | Yohannes Birhane GEBREHIWET | 2001-01-06 | er | `ghebrehiwet-yohannes-birhane` | exacta UCI |
| 1506794 | M | Teklehaymanot Amanuel TESFAY | 2005-06-23 | et | `tesfay-amanuel` | exacta UCI |
| 1540413 | F | Evelien VIJN | 2002-08-24 | nl | `vijn-evelien` | manual |
| 1552220 | M | Hao ZHANG | 2005-09-01 | cn | `zhang-hao` | exacta UCI |
| 1594686 | F | Alice Lily MARTIN | 2006-02-04 | gb | `martin-lily` | exacta UCI |
| 1610767 | F | Kylee HANEL | 2005-11-30 | us | `hanel-kylee` | exacta UCI |
| 1630255 | M | Toft Gustav SIMONSEN | 2001-10-29 | dk | `simonsen-gustav` | exacta UCI |
| 1645408 | M | Tsegay Tekle ALEMAYO | 2006-11-19 | et | `alemayo-tsegay` | exacta UCI |
| 1649356 | M | Gavin SHERRY | 2004-05-11 | us | `sherry-gavin` | exacta UCI |
| 1750181 | M | Iver Tildheim ANDERSEN | 2000-09-29 | no | `andersen-iver-tildheim` | manual |
| 1757927 | M | Sibo WANG | 2006-09-14 | cn | `wang-sibo` | exacta UCI |
| 1759286 | M | Chen WU | 2007-06-03 | cn | `wu-chen` | exacta UCI |
| 1774062 | M | Martin RESTREPO LOPEZ | 2004-04-01 | co | `restrepo-lopez-martin` | exacta UCI |

Notas manuales: **60032**: UCI Lawrence Warbasse; el catálogo usa el alias Larry Warbasse, misma fecha y nacionalidad. **87140**: Mismo corredor; el catálogo conserva 1994-12-08 y la UCI 1994-12-09. Solo se escribe el identificador. **92264**: Mismo corredor; el catálogo conserva 1996-02-05 y la UCI 1996-04-25. Solo se escribe el identificador. **289074**: Coincidencia exacta de nombre y nacionalidad; el catálogo no tenía fecha. **825096**: La UCI muestra Ola Herheim; ficha equivalente por nombre, fecha y nacionalidad. **826848**: La UCI muestra Sophie Madelaine Leech; el catálogo usa Maddie Leech, mismo apellido, fecha ausente y equipo. **1494715**: Se elige la ficha con nombre completo y equipo Soudal Quick-Step Devo.

## Altas mínimas de catálogo — 40

| UCI perfil | Género | Nombre | Apellido | Fecha | País | ID de ficha |
|---:|:---:|:---|:---|:---:|:---:|:---|
| 57328 | M | Jan Paul | Morales | 1986-01-28 | ph | `morales-jan-paul` |
| 60794 | M | Chanjae | Jang | 1989-01-06 | kr | `jang-chanjae` |
| 64733 | M | Anton | Vorobyev | 1990-10-12 | ru | `vorobyev-anton` |
| 80332 | M | Abdullojon | Akparov | 1990-12-28 | uz | `akparov-abdullojon` |
| 87052 | M | Mamyr | Stash | 1993-05-04 | ru | `stash-mamyr` |
| 140890 | M | Edwin Marcos | Hoyos Ortega | 1994-12-08 | bo | `hoyos-ortega-edwin-marcos` |
| 164198 | M | Clement | Horny | 2000-11-11 | be | `horny-clement` |
| 315310 | M | Carlo | Cortesi | 2004-01-07 | it | `cortesi-carlo` |
| 330790 | F | Emma | Bonissi | 2008-02-23 | it | `bonissi-emma` |
| 361209 | M | Theodor | Storm | 2005-03-31 | dk | `storm-theodor` |
| 550960 | M | Lev | Emelianov | 2004-06-25 | ru | `emelianov-lev` |
| 758917 | M | Maxime | Luzi | 2005-08-10 | fr | `luzi-maxime` |
| 768956 | M | Batbaatar | Batsambuu | 2002-01-25 | mn | `batsambuu-batbaatar` |
| 957715 | M | Thomas | Bernardi | 2007-01-25 | it | `bernardi-thomas` |
| 978267 | F | Siqi | Guan | 1997-07-11 | cn | `guan-siqi` |
| 1017147 | M | Kurt Dylan | Proctor-Parker | 2004-12-12 | au | `proctor-parker-kurt-dylan` |
| 1057695 | F | Eva | Drhová | 2008-05-10 | cz | `drhova-eva` |
| 1091546 | F | Ning | Chen | 2002-02-18 | cn | `chen-ning` |
| 1102412 | M | Damy | De Bruyne | 2006-03-25 | be | `de-bruyn-damy` |
| 1197677 | F | Marlen | Rojas Lescot | 2007-06-01 | cl | `rojas-lescot-marlen` |
| 1214444 | M | Tao | Sun | 2002-01-30 | cn | `sun-tao` |
| 1269747 | M | Theodoros | Koutsis | 1989-09-04 | gr | `koutsis-theodoros` |
| 1308756 | M | Jexxel Ehd | Azur | 2005-05-14 | ph | `azur-jexxel-ehd` |
| 1320347 | M | Sota | Kusumoto | 2005-04-27 | jp | `kusumoto-sota` |
| 1320513 | M | Baoshan | Zhang | 2003-07-14 | cn | `zhang-baoshan` |
| 1349223 | M | Yulong | Wang | 2002-10-25 | cn | `wang-yulong` |
| 1376473 | M | Rafael | Reis | 2007-03-30 | pt | `reis-rafael-2007` |
| 1417536 | M | 晟伊 Sheng Yi | 廖 Liao | 2005-03-06 | tw | `liao-sheng-yi` |
| 1432244 | M | Jinyan | Zhang | 2005-07-10 | cn | `zhang-jinyan` |
| 1432282 | F | Menghan | Zhou | 2004-11-06 | cn | `zhou-menghan` |
| 1469559 | F | Elise | De Bruyn | 2008-03-20 | be | `de-bruyn-elise` |
| 1544212 | M | Ang | Ma | 2006-01-25 | cn | `ma-ang` |
| 1618368 | M | Jozef | Palčák | 1987-12-17 | sk | `palcak-jozef` |
| 1619238 | M | Hyojun | Choi | 2006-03-08 | kr | `choi-hyojun` |
| 1630333 | M | Néo | Derangere | 2005-06-27 | fr | `derangere-neo` |
| 1644399 | M | Gebremedhn Destaalem | Teka | 2006-03-08 | et | `teka-gebremedhn-destaalem` |
| 1656443 | M | Guangze | Gao | 2005-08-15 | cn | `gao-guangze` |
| 1702317 | M | Wei | Xia | 1998-03-27 | cn | `xia-wei` |
| 1715148 | M | Sam | Cockburn | 2007-09-08 | ca | `cockburn-sam` |
| 1723388 | M | Eunchan | Kim | 2007-11-12 | kr | `kim-eunchan` |

La excepción de homónimo `1376473` (Rafael Reis nacido en 2007) usa `id=reis-rafael-2007` e `identityKey=rafael-reis-2007`; no se fusiona con la ficha existente `reis-rafael` nacida en 1992.

## Backup, SQL y verificación

Se registró el estado completo de las 192 fichas existentes en `private.repair_season_2026_rider_enrichment_backup` con la operación `season-2026-uci-id-reconciliation-20260829`. Las altas nuevas son reversibles por sus 40 IDs exactos y no requieren backup de filas inexistentes.

SQL autorizado: actualizar únicamente `riders_men`/`riders_women`.`uciId` para los 192 IDs de la tabla anterior, condicionado a `uciId IS NULL`; insertar las 40 fichas de la tabla anterior; no tocar `startlist_riders`, `race_uci_results`, `rider_team_affiliations`, `globalRiderId`, `currentTeamId`, puestos, tiempos ni clasificaciones.

Resultado aplicado: 233 decisiones con resultado (`192 actualizar`, `40 crear`, `1 excluir`), 159 actualizaciones masculinas, 33 femeninas, 33 altas masculinas y 7 femeninas. La comprobación del roster completo devuelve 4.212 perfiles, 4.211 cubiertos y solo `1610729` ausente. La verificación devuelve unicidad de `uciId` por género, 192 objetivos existentes exactos, 40 fichas nuevas exactas, `backup_rows=192`, el homónimo Rafael Reis separado y `1610729` no creado.

El catálogo queda con 3.387 `uciId` no nulos en hombres y 824 en mujeres. No se modificaron `startlist_riders`, `race_uci_results`, `rider_team_affiliations`, `globalRiderId`, `currentTeamId`, puestos, tiempos ni clasificaciones. No se regeneraron páginas.

Rollback: restaurar desde `private.repair_season_2026_rider_enrichment_backup` la operación indicada; eliminar únicamente las 40 altas por sus IDs exactos después de verificar que no tienen referencias, si se requiere deshacerlas.

## Evidencia externa de adjudicaciones

- Daniel Martínez: [ficha UCI/DataRide](https://www.uci.org/rider-details/92264), [Paris-Nice oficial](https://www.paris-nice.fr/fr/coureur/11/red-bull-bora-hansgrohe/daniel-felipe-martinez-poveda), [Cycling Museum](https://www.museociclismo.it/en/riders/rider/111226-Daniel%2BFelipeMART%C3%8NEZ%2BPOVEDA/index.html?view=squadre).
- Nassim Saidi: [L’Équipe](https://www.lequipe.fr/fiche/nassim-saidi/102668), [fuente externa](https://example.invalid).
- José Said Cisneros: [fuente externa](https://example.invalid), [Wikidata](https://www.wikidata.org/wiki/Q138675911).
- Fabricio Crozzolo: [DataRide](https://dataride.uci.org/iframe/RiderRankingDetails/2086280?baseRankingTypeId=3&categoryId=22&countryId=11&disciplineId=10&disciplineSeasonId=464&groupId=8&momentId=200635&raceTypeId=0&rankingId=3&teamId=0), [fuente externa](https://example.invalid).
- Oliver Sims: [fuente externa](https://example.invalid), [L’Équipe](https://www.lequipe.fr/fiche/oliver-sims/103821).
- Eñaut Urkaregi: [ficha oficial de Trek](https://racing.trekbikes.com/riders/lidl-trek/enaut-urkaregi).
- Cj Williams: [roster UCI](https://www.uci.org/team-details/21477) y [registro externo de L39ION](https://example.invalid).
