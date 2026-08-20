// ─────────────────────────────────────────────────────────────────
//  PAGE LOADING — overlay de carga a pantalla completa (web)
//  Lo importa js/header.js, así que corre en TODAS las páginas (también
//  las ~5000 generadas por og-pages) tras el parse y antes de DOMContentLoaded.
//
//  Reglas de visibilidad (decisión Dani 2026-06-12):
//   · Se muestra en TODAS las cargas de página, con un mínimo de 600 ms
//     para que no parpadee (es bonito y es marca; no se racanea).
//   · Páginas sin marcador .loading/.pfe-loading (about, buscar, panel…):
//     no se muestra nunca — no hay datos que esperar.
//
//  Ocultado: automático, sin tocar los JS de página — un MutationObserver
//  vigila el contenedor del .loading inicial; cuando ya no queda ningún
//  .loading dentro (la página pintó contenido, vacío o error), se desvanece.
//  Fallback duro a los 12 s por si una petición muere sin repintar.
//
//  Los perfiles son REALES (etapas reina de GV 2026 en la BD, horneados aquí
//  para que la pantalla de carga no dependa de la red; simplificados con
//  Douglas-Peucker). En cada carga se sortea uno. Para añadir/cambiar uno:
//  volcar elevationProfile.points como [km, alt] + distance/min/max/caption.
// ─────────────────────────────────────────────────────────────────

const PROFILES = [
  { caption: "Feltre → Alleghe · Giro 2026 · 150,8 km · 5.000 m+",
    distance: 150.8, minAlt: 334, maxAlt: 2231,
    points: [[0,334],[1.72,359],[2.66,346],[4.04,412],[5.9,465],[7.53,456],[8.61,424],[11.26,517],[13.31,549],[14.87,556],[16.68,434],[17.76,417],[19.91,476],[22.12,406],[22.95,364],[24.08,398],[26.94,382],[29.6,400],[31.18,430],[31.68,417],[32.93,424],[40.17,512],[46.01,608],[47.56,694],[49.52,839],[51.65,1052],[52.3,1093],[52.81,1170],[53.71,1225],[56.44,1513],[57.7,1549],[58.16,1582],[58.87,1588],[61.99,1310],[62.92,1240],[64.73,1149],[67,946],[69.57,1173],[72.36,1476],[72.88,1498],[73.36,1494],[73.98,1444],[74.45,1378],[75.15,1347],[76.34,1401],[81.11,1729],[82.36,1754],[84.43,1602],[87.51,1415],[88.21,1433],[89.44,1412],[90.38,1394],[91.9,1338],[92.83,1443],[94.47,1582],[94.98,1648],[96.66,1780],[97.09,1836],[101.51,2231],[106.82,1774],[107.88,1695],[108.56,1667],[110.11,1523],[110.71,1512],[112.05,1556],[113.69,1667],[116.69,1747],[119.48,1946],[121.94,2100],[127.89,1744],[131.11,1526],[131.47,1509],[131.99,1511],[132.43,1471],[133.47,1465],[134.51,1386],[135.56,1344],[136.09,1354],[136.85,1282],[137.67,1272],[139.3,1182],[140.46,1069],[141.88,998],[144.12,999],[145.7,985],[146.33,1022],[147.93,1172],[148.86,1288],[150.63,1443],[150.8,1476]] },
  { caption: "Le Bourg d'Oisans → Alpe d'Huez · Tour 2026 · 172,1 km · 5.360 m+",
    distance: 172.1, minAlt: 540, maxAlt: 2632,
    points: [[0,712],[4.82,724],[5.89,765],[7.11,774],[8.59,810],[9.71,794],[12.73,1015],[15.46,1261],[16.65,1289],[17.64,1255],[18.46,1184],[23.68,1633],[25.09,1720],[25.94,1736],[27.14,1790],[29.08,1732],[31.55,1918],[33.77,2049],[34.22,2057],[40.83,1517],[42.52,1467],[45.7,1343],[47.3,1258],[48.39,1244],[49.75,1297],[50.22,1275],[51.38,1284],[51.85,1270],[54.23,1027],[57.07,804],[58.02,843],[59.41,851],[62.36,616],[63.42,554],[64.8,540],[66.31,564],[68.52,635],[70.92,677],[73.94,690],[75.76,712],[76.76,752],[81.02,1104],[81.45,1120],[81.69,1151],[84.74,1343],[87.88,1566],[89.06,1567],[89.92,1544],[91.08,1507],[92.05,1447],[93.1,1409],[94.43,1483],[95.29,1552],[97.65,1606],[102.04,1934],[103.21,1987],[105,2129],[106.67,2290],[108.3,2393],[111.1,2632],[112.14,2544],[112.47,2539],[114.3,2425],[115.32,2340],[115.56,2342],[119.36,2075],[120.25,2028],[121.37,1997],[126.96,1653],[129.12,1540],[129.56,1499],[131.08,1466],[132.25,1393],[133.95,1333],[134.65,1322],[136.97,1221],[137.52,1219],[138.04,1175],[140.62,1094],[141.16,1048],[142.79,1064],[143.18,1090],[144.4,1044],[145.68,1189],[146.22,1201],[146.87,1196],[148.58,1355],[150.15,1394],[150.69,1427],[153.47,1638],[157,1984],[157.51,1984],[159.41,1822],[159.98,1783],[160.58,1768],[162.35,1843],[163.02,1836],[163.91,1871],[165.08,1808],[165.61,1802],[168.37,1605],[170.55,1789],[172.11,1842]] },
  { caption: "Pau → Gavarnie-Gèdre · Tour 2026 · 186,2 km · 3.922 m+",
    distance: 186.2, minAlt: 186, maxAlt: 2165,
    points: [[0,218],[0.3,186],[1.24,201],[1.55,227],[2.16,200],[3.07,211],[3.91,198],[4.18,227],[4.43,206],[4.74,243],[5.24,211],[5.81,205],[6.46,222],[7.66,213],[13.19,236],[16.9,275],[22.6,298],[24.21,328],[25.84,332],[26.23,317],[26.59,356],[27.78,348],[29.01,380],[29.79,382],[30.51,346],[31.13,371],[32.77,357],[33.93,387],[34.26,413],[35.03,374],[36.87,433],[37.24,405],[39.28,401],[40.81,415],[45.3,405],[45.79,436],[46.4,402],[48.64,386],[49.2,440],[49.77,429],[50.33,500],[50.88,527],[51.32,508],[51.78,534],[54.01,440],[55.84,479],[59.25,508],[59.52,532],[60.99,575],[62.01,644],[63.03,616],[64.08,546],[65.64,579],[67.17,549],[68.9,554],[70.09,512],[70.69,511],[72.45,409],[73.02,323],[73.64,319],[74.81,359],[76.57,496],[77.14,516],[77.61,505],[79.04,590],[79.87,610],[80.66,601],[83.02,665],[84.17,594],[84.57,582],[85.42,598],[85.96,571],[86.48,579],[87.39,662],[89.74,699],[91.27,615],[92.31,631],[95.03,599],[95.57,705],[96.04,610],[96.67,609],[98.41,632],[98.96,664],[99.63,648],[101.5,655],[103.37,698],[104.64,683],[105.25,705],[107.01,710],[108.7,783],[109.26,785],[110.38,908],[111.5,936],[113.18,1113],[113.76,1126],[114.29,1167],[114.89,1152],[115.99,1343],[116.55,1369],[117.67,1525],[118.76,1433],[119.33,1414],[120.38,1287],[120.93,1288],[122.54,1106],[125.06,1082],[126.09,1001],[127.08,965],[127.58,965],[128.08,916],[129.07,890],[129.59,853],[130.64,854],[131.21,902],[132.36,945],[132.9,942],[134.07,992],[135.2,1072],[135.76,1152],[137.47,1271],[138.04,1400],[138.61,1351],[139.17,1411],[139.75,1421],[142,1721],[143.15,1809],[143.81,1782],[144.46,1842],[145.12,1855],[145.79,1949],[147.11,2054],[147.76,2165],[148.33,2014],[148.86,2071],[149.42,1929],[149.97,1963],[150.53,1839],[151.63,1797],[153.29,1618],[154.38,1593],[154.93,1480],[156.04,1447],[157.67,1291],[158.23,1289],[159.43,1163],[160.05,1162],[160.67,1069],[162.56,990],[165.08,760],[166.91,692],[167.55,699],[168.76,806],[169.35,783],[170.57,841],[171.19,834],[171.8,875],[174.15,920],[174.67,952],[178,1015],[178.63,1060],[179.25,1052],[179.87,1085],[180.52,1188],[181.15,1171],[181.78,1252],[182.41,1221],[183.05,1238],[184.29,1298],[184.93,1357],[185.54,1382],[186.2,1373]] },
  { caption: "Formia → Blockhaus · Giro 2026 · 244,4 km · 4.600 m+",
    distance: 244.4, minAlt: 0, maxAlt: 1665,
    points: [[0,37],[4.22,167],[5.27,176],[7.1,249],[8.33,242],[8.85,225],[10.99,113],[12.94,38],[16.29,11],[18.42,6],[22.84,2],[25.28,15],[27.67,13],[29.86,36],[30.38,52],[31.57,25],[32.73,19],[33.33,52],[37.22,3],[39.54,56],[40.94,30],[41.63,35],[42.56,14],[47.43,2],[58.27,14],[59.46,34],[64.89,45],[67.84,31],[70.58,82],[72.57,156],[74.68,152],[76.39,99],[79.11,43],[81.05,33],[86.09,26],[87.55,37],[88.93,25],[90.56,47],[91.18,23],[92.38,36],[93.34,63],[94.76,66],[96.64,49],[98.21,82],[100.03,67],[102.26,121],[105.59,284],[107.71,268],[110.25,208],[113.99,185],[120.57,227],[123.53,258],[125.39,319],[126.55,337],[128.94,296],[130.49,305],[134.38,357],[137.25,478],[138.34,506],[139.69,596],[146.64,948],[148.86,1002],[150.8,966],[153.44,823],[158.6,796],[160.23,833],[163.76,1116],[164.75,1175],[165.85,1199],[166.63,1247],[169.88,1238],[171.23,1276],[172.31,1263],[175.05,1259],[178.13,1270],[179.26,1286],[180.59,1403],[182.84,1276],[184.06,1233],[185.74,1181],[186.52,1182],[187.16,1166],[189.44,1086],[191.96,1045],[195.93,1254],[196.47,1244],[197.28,1254],[198.37,1237],[200.04,1290],[200.77,1291],[201.74,1265],[203.43,1165],[207.05,997],[208.53,961],[209.76,904],[211.85,847],[213.43,743],[216.96,590],[217.95,521],[219.57,522],[220.34,536],[221.14,571],[222.46,587],[223.69,587],[226.14,511],[229.02,556],[230.44,509],[233.88,714],[241.97,1499],[243.43,1618],[244.4,1665]] },
  { caption: "Pola de Laviana → L'Angliru · La Vuelta Femenina 2026 · 132,8 km · 3.348 m+",
    distance: 132.8, minAlt: 45, maxAlt: 1569,
    points: [[0,254],[1.1,256],[1.51,243],[3.14,229],[7.95,216],[13.11,520],[14.32,479],[17.47,280],[20.43,210],[23.43,195],[23.95,202],[24.67,182],[25.82,172],[26.86,171],[27.22,180],[27.99,170],[28.41,180],[28.65,172],[29.05,191],[29.57,169],[29.79,208],[30,167],[30.6,166],[31.1,145],[31.62,156],[33.06,132],[34.26,143],[34.5,132],[34.75,147],[35.94,153],[36.4,171],[37.67,142],[37.9,116],[39.48,185],[40.37,141],[40.89,149],[41.52,142],[42.65,104],[43.47,112],[46.18,252],[46.89,245],[47.23,229],[47.88,247],[48.31,248],[50.44,199],[52.33,103],[53.2,84],[54.72,155],[55.24,156],[55.68,176],[56.6,186],[58.16,131],[58.76,128],[59.9,80],[60.58,97],[61.78,68],[62.22,82],[62.6,65],[64.1,62],[64.85,47],[67.61,46],[68.59,78],[69.87,56],[70.36,60],[74.95,275],[76.86,204],[78.25,253],[79.18,250],[80.15,270],[82.19,408],[86,105],[86.73,123],[87.99,114],[88.66,145],[88.99,124],[89.75,127],[91.06,179],[91.49,148],[92.25,150],[92.67,175],[93.1,162],[93.66,188],[94.24,176],[95.42,306],[95.89,296],[96.32,314],[97.75,503],[98.58,437],[98.81,430],[99.3,437],[99.55,428],[101.81,309],[102.97,183],[103.69,180],[104.89,115],[105.56,152],[106.43,170],[106.88,155],[107.98,149],[108.31,131],[108.55,143],[109.24,132],[110.26,134],[111.26,157],[111.95,146],[112.57,170],[112.84,159],[113.01,201],[113.39,171],[114.46,203],[114.7,194],[115.1,225],[115.44,219],[115.79,230],[116.47,275],[116.89,256],[117.31,267],[118.18,325],[118.83,305],[119.29,305],[120.02,321],[120.79,366],[124.07,643],[125.78,708],[131.49,1503],[132.08,1569],[132.78,1555]] },
  { caption: "Andorra la Vella · La Vuelta 2026 · Etapa 4 · 104,9 km · 2.740 m+",
    distance: 104.6, minAlt: 1003, maxAlt: 2397,
    points: [[0,1147],[0.37,1154],[0.76,1177],[1.55,1192],[3.46,1309],[4.18,1334],[4.54,1361],[5.42,1394],[6.38,1413],[7.58,1518],[7.75,1523],[7.86,1524],[8.06,1524],[8.54,1531],[8.67,1530],[10.11,1564],[11.78,1634],[12.21,1642],[12.79,1663],[14.7,1749],[15.37,1796],[16.81,1867],[18.73,1999],[19.45,2017],[23.47,2297],[23.9,2313],[25.11,2397],[29.42,2107],[30.19,2087],[30.82,2055],[31,2052],[31.88,2050],[33.19,2048],[33.78,2048],[34.33,2044],[34.98,2016],[35.71,2001],[37.55,1875],[39.76,1752],[41.68,1663],[42.92,1623],[44.2,1568],[44.92,1555],[45.65,1531],[45.91,1531],[46.02,1530],[46.83,1520],[47.99,1419],[48.25,1406],[49.04,1388],[49.68,1365],[50.63,1316],[50.86,1313],[52,1240],[52.39,1229],[53.74,1325],[54.52,1433],[56.66,1633],[57.35,1660],[59.04,1786],[60.68,1718],[63.16,1533],[63.91,1444],[64.61,1393],[64.89,1391],[65.53,1328],[66.55,1278],[67.03,1292],[67.33,1287],[67.87,1261],[68.14,1267],[68.99,1307],[70.03,1394],[70.85,1432],[73.24,1632],[76.55,1851],[77.37,1924],[78.44,1968],[79.58,1917],[80.38,1925],[80.91,1939],[81.19,1927],[82.78,1815],[84.3,1731],[85.68,1620],[87.14,1532],[87.81,1521],[89.19,1408],[89.99,1390],[90.67,1366],[92.17,1296],[93.87,1195],[94.69,1177],[95.43,1140],[95.93,1131],[97.07,1228],[97.31,1238],[97.69,1242],[98.25,1233],[98.43,1235],[99.77,1342],[101.75,1182],[102.37,1158],[104.07,1005],[104.25,1003],[104.64,1010]] },
  { caption: "La Calahorra → Collado del Alguacil · La Vuelta 2026 · 187 km · 4.890 m+",
    distance: 186.8, minAlt: 683, maxAlt: 1884,
    points: [[0,1182],[3.75,1207],[5.35,1255],[6.96,1239],[8.56,1253],[9.63,1233],[11.24,1183],[12.31,1174],[14.99,1117],[18.2,1075],[19.8,1067],[22.48,938],[24.09,912],[26.76,903],[28.37,917],[29.44,952],[30.51,895],[31.04,885],[31.58,895],[33.72,994],[34.79,1003],[35.86,1040],[36.4,1030],[37.47,1046],[38.54,992],[39.61,997],[40.14,975],[40.68,974],[43.89,1050],[45.5,1109],[47.1,1193],[49.78,1260],[50.31,1289],[50.85,1285],[52.45,1199],[53.52,1206],[57.81,1059],[59.95,1078],[62.09,985],[63.69,938],[65.3,841],[65.83,828],[69.05,794],[71.19,755],[74.4,738],[77.08,688],[78.15,683],[79.22,702],[79.75,701],[82.43,733],[84.03,815],[84.57,802],[85.64,813],[86.17,840],[89.39,1166],[92.06,1383],[92.6,1421],[93.13,1408],[93.67,1421],[94.2,1481],[95.81,1366],[97.95,1255],[100.63,1066],[101.16,1037],[102.23,1009],[105.44,770],[107.05,730],[109.19,709],[110.26,725],[110.8,714],[111.33,718],[113.47,743],[115.08,822],[116.68,824],[117.22,841],[120.43,1165],[123.64,1435],[124.71,1429],[125.25,1481],[128.99,1270],[135.95,782],[136.49,785],[137.56,820],[139.7,967],[140.77,988],[142.37,1078],[143.45,1080],[144.52,1069],[145.05,1102],[145.59,1116],[147.19,1045],[148.26,1082],[150.94,1362],[152.54,1490],[155.22,1656],[155.76,1650],[156.83,1575],[158.43,1529],[161.11,1365],[162.18,1317],[169.67,787],[170.21,781],[171.81,832],[173.42,954],[174.49,980],[176.63,1083],[177.17,1066],[177.7,1075],[178.24,1068],[178.77,1080],[181.98,1369],[186.8,1884]] },
];

// Mismos iconos que el logo del header (js/header.js LOGO_SVG), a mayor tamaño.
const ICONS_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>' +
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18.5" cy="17.5" r="3.5"/><circle cx="5.5" cy="17.5" r="3.5"/><circle cx="15" cy="5" r="1"/><path d="M12 17.5V14l-3-3 4-3 2 3h2"/></svg>';

const MIN_SHOW_MS = 600;   // mínimo en pantalla (anti-parpadeo)
const MAX_SHOW_MS = 12000; // fallback duro si la página nunca repinta
const SETTLE_MS   = 350;   // sin marcador, esperar a que el DOM repose
const DRAW_MS     = 2600;  // trazado del perfil
const HOLD_MS     = 700;   // pausa con el perfil completo antes de repetir

// viewBox del perfil: y=PROF_BASE es la línea de suelo del relleno.
const PROF_W = 1000, PROF_H = 240, PROF_TOP = 36, PROF_BASE = 232;

function isEnglish() {
  const p = window.location.pathname;
  return p.startsWith('/en/') || p === '/en';
}

function profilePathD(prof) {
  const span = prof.maxAlt - prof.minAlt;
  return prof.points.map(([km, alt], i) => {
    const x = (km / prof.distance) * PROF_W;
    const y = PROF_BASE - ((alt - prof.minAlt) / span) * (PROF_BASE - PROF_TOP);
    return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
}

function buildOverlay() {
  const en = isEnglish();
  const prof = PROFILES[Math.floor(Math.random() * PROFILES.length)];
  const lineD = profilePathD(prof);
  const fillD = `${lineD} L${PROF_W},${PROF_H} L0,${PROF_H} Z`;
  const el = document.createElement('div');
  el.className = 'page-loading';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-label', en ? 'Loading' : 'Cargando');
  el.innerHTML =
    '<div class="page-loading__brand">' +
      `<div class="page-loading__icons">${ICONS_SVG}</div>` +
      '<p class="page-loading__title">Calendario Ciclismo</p>' +
      `<p class="page-loading__msg">${en ? 'Loading…' : 'Cargando…'}</p>` +
    '</div>' +
    '<div class="page-loading__profile"><div class="page-loading__svgwrap">' +
    `<svg viewBox="0 0 ${PROF_W} ${PROF_H}" preserveAspectRatio="none" aria-hidden="true">` +
      `<path class="page-loading__fill" d="${fillD}"/>` +
      `<path class="page-loading__line" d="${lineD}"/>` +
    '</svg>' +
    // El punto del "ciclista" va en HTML (un circle dentro del SVG estirado
    // por preserveAspectRatio="none" se deformaría en elipse) y se posiciona
    // en % del wrap → inmune a resizes, sin medir nada por frame.
    '<span class="page-loading__rider" aria-hidden="true"></span>' +
    '</div>' +
    // Tinte de continuación: prolonga el relleno del perfil hasta el borde
    // inferior de la pantalla (el SVG ya no está anclado abajo).
    '<div class="page-loading__ground"></div>' +
    `<span class="page-loading__caption">${prof.caption}</span></div>`;
  return el;
}

function startAnimation(overlay) {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const line  = overlay.querySelector('.page-loading__line');
  const rider = overlay.querySelector('.page-loading__rider');
  const len   = line.getTotalLength();
  if (reduced) {
    // Perfil estático completo, sin punto ni bucle.
    rider.remove();
    return () => {};
  }
  line.style.strokeDasharray = String(len);
  let raf = 0, start = null;
  const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
  const frame = (ts) => {
    if (start === null) start = ts;
    let t = ((ts - start) % (DRAW_MS + HOLD_MS)) / DRAW_MS;
    if (t > 1) t = 1;
    const e = ease(t);
    line.style.strokeDashoffset = String(len * (1 - e));
    // Coords del viewBox → % del wrap (el SVG va estirado con
    // preserveAspectRatio="none", por eso el punto vive en HTML).
    const pt = line.getPointAtLength(len * e);
    rider.style.left = `${((pt.x / PROF_W) * 100).toFixed(2)}%`;
    rider.style.top  = `${((pt.y / PROF_H) * 100).toFixed(2)}%`;
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return () => cancelAnimationFrame(raf);
}

// Marcadores de "datos pendientes": .loading/.pfe-loading en los shells raíz;
// .static-prerender en las ~5000 páginas generadas por og-pages (jornada/
// inscritos/competición/equipo/corredor/resultados ×2 idiomas), cuyo main
// trae contenido SEO estático que el JS de página reemplaza al hidratar.
const MARKER_SEL = '.loading, .pfe-loading, .static-prerender';

function initPageLoading() {
  // Cortina anti-flash puesta por theme.js antes del primer paint: retirarla
  // SIEMPRE al decidir (con el overlay ya montado encima, o sin nada que
  // esperar). Si este módulo no corre, el failsafe CSS la quita a los 5 s.
  const reveal = () => document.documentElement.classList.remove('cc-booting');

  // Si la página no tiene marcador, no hay nada que esperar.
  const marker = document.querySelector(MARKER_SEL);
  if (!marker || !document.body) { reveal(); return; }
  const container = marker.parentElement;
  if (!container) { reveal(); return; }

  let stopAnim = null, maxTimer = 0, done = false;

  const overlay = buildOverlay();
  document.body.appendChild(overlay);
  reveal();
  stopAnim = startAnimation(overlay);
  const shownAt = performance.now();

  const finish = () => {
    if (done) return;
    done = true;
    clearTimeout(maxTimer);
    observer.disconnect();
    const wait = Math.max(0, MIN_SHOW_MS - (performance.now() - shownAt));
    setTimeout(() => {
      overlay.classList.add('page-loading--hide');
      setTimeout(() => { stopAnim?.(); overlay.remove(); }, 320);
    }, wait);
  };

  // El contenido llegó cuando el contenedor ya no alberga ningún marcador
  // (las páginas repintan con innerHTML; también cubre estados vacío/error).
  // ⚠️ No vale el primer instante sin marcador: la home limpia el listado
  // (innerHTML='') y SIGUE montando tarjetas en pasos async → el overlay
  // caía con el listado a medio desplegar. Debounce: finalizar solo cuando
  // además el contenedor lleve SETTLE_MS sin mutaciones (cada nodo insertado
  // re-arma el temporizador; si reaparece un marcador, queda anulado).
  let settleTimer = 0;
  const observer = new MutationObserver(() => {
    clearTimeout(settleTimer);
    if (!container.querySelector(MARKER_SEL)) {
      settleTimer = setTimeout(finish, SETTLE_MS);
    }
  });
  observer.observe(container, { childList: true, subtree: true });

  maxTimer = setTimeout(finish, MAX_SHOW_MS);
}

initPageLoading();
