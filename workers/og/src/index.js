// ─────────────────────────────────────────────────────────────────
//  Cloudflare Worker: og.calendariociclismo.app
//  Genera imágenes OG dinámicas (1200×630) con logo de carrera
//  sobre fondo oscuro al estilo de la web.
//
//  Uso:
//    /og?logo=<url-encoded-logo>&title=<texto-opcional>
//
//  Si no se pasa logo, redirige a og-default.png.
//
//  Deploy:
//    cd workers/og && npm install && npx wrangler deploy
// ─────────────────────────────────────────────────────────────────

import satori from 'satori';
import { Resvg, initWasm } from '@resvg/resvg-wasm';
import resvgWasm from '@resvg/resvg-wasm/index_bg.wasm';

const DEFAULT_OG = 'https://pub-10252f2a495c488a856a619206783642.r2.dev/og-default.png';
const WIDTH = 1200;
const HEIGHT = 630;

// ── Inicializar resvg-wasm (una sola vez por instancia) ─────────
let wasmReady = false;
async function ensureWasm() {
  if (!wasmReady) {
    await initWasm(resvgWasm);
    wasmReady = true;
  }
}

// ── Fuente: Inter (cargada una vez y cacheada en memoria) ───────
let fontData = null;
async function loadFont() {
  if (fontData) return fontData;
  // Inter 600 (SemiBold) desde Google Fonts — estable y libre
  const res = await fetch(
    'https://fonts.gstatic.com/s/inter/v18/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuGKYAZ9hiA.woff2'
  );
  fontData = await res.arrayBuffer();
  return fontData;
}

// ── SVG del icono del calendario + bicicleta (favicon de la web) ─
const BRAND_ICON = {
  type: 'svg',
  props: {
    xmlns: 'http://www.w3.org/2000/svg',
    viewBox: '0 0 100 100',
    width: 44,
    height: 44,
    children: [
      { type: 'rect', props: { width: 100, height: 100, rx: 18, fill: '#1a73e8' } },
      { type: 'rect', props: { x: 15.5, y: 38, width: 27, height: 27, rx: 3, fill: 'none', stroke: 'white', strokeWidth: 2.3 } },
      { type: 'line', props: { x1: 23, y1: 35, x2: 23, y2: 41, stroke: 'white', strokeWidth: 2.3, strokeLinecap: 'round' } },
      { type: 'line', props: { x1: 35, y1: 35, x2: 35, y2: 41, stroke: 'white', strokeWidth: 2.3, strokeLinecap: 'round' } },
      { type: 'line', props: { x1: 15.5, y1: 47, x2: 42.5, y2: 47, stroke: 'white', strokeWidth: 2.3, strokeLinecap: 'round' } },
      { type: 'circle', props: { cx: 61.25, cy: 58.25, r: 5.25, fill: 'none', stroke: 'white', strokeWidth: 2.3 } },
      { type: 'circle', props: { cx: 80.75, cy: 58.25, r: 5.25, fill: 'none', stroke: 'white', strokeWidth: 2.3 } },
      { type: 'circle', props: { cx: 75.5, cy: 39.5, r: 1.5, fill: 'none', stroke: 'white', strokeWidth: 2.3 } },
      { type: 'path', props: { d: 'M71,58.25 L71,53 L66.5,48.5 L72.5,44 L75.5,48.5 L78.5,48.5', fill: 'none', stroke: 'white', strokeWidth: 2.3, strokeLinecap: 'round', strokeLinejoin: 'round' } },
    ],
  },
};

// ── Generar la imagen ───────────────────────────────────────────
async function generateOgImage(logoUrl, title) {
  await ensureWasm();
  const font = await loadFont();

  // Obtener el logo como base64 para que satori lo incruste
  let logoSrc = null;
  if (logoUrl) {
    try {
      const logoRes = await fetch(logoUrl);
      if (logoRes.ok) {
        const buf = await logoRes.arrayBuffer();
        const bytes = new Uint8Array(buf);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
        const b64 = btoa(binary);
        const mime = logoRes.headers.get('content-type') || 'image/png';
        logoSrc = `data:${mime};base64,${b64}`;
      }
    } catch (_) { /* sin logo */ }
  }

  // ── Construir el layout con satori (objetos tipo React) ──
  const markup = {
    type: 'div',
    props: {
      style: {
        width: WIDTH,
        height: HEIGHT,
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#111318',
        fontFamily: 'Inter',
        position: 'relative',
        overflow: 'hidden',
      },
      children: [
        // Línea decorativa superior (accent)
        {
          type: 'div',
          props: {
            style: {
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              height: 4,
              background: 'linear-gradient(90deg, #1a73e8, #aac7ff, #1a73e8)',
            },
          },
        },

        // Patrón sutil de fondo — borde luminoso
        {
          type: 'div',
          props: {
            style: {
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              border: '1px solid #2e3038',
              borderRadius: 0,
            },
          },
        },

        // ── Zona izquierda: logo de la carrera ──
        logoSrc
          ? {
              type: 'div',
              props: {
                style: {
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 520,
                  height: HEIGHT,
                  paddingLeft: 80,
                  paddingRight: 20,
                  flexShrink: 0,
                },
                children: [
                  {
                    type: 'div',
                    props: {
                      style: {
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: 400,
                        height: 400,
                        background: 'white',
                        borderRadius: 32,
                        padding: 8,
                        boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
                      },
                      children: [
                        {
                          type: 'img',
                          props: {
                            src: logoSrc,
                            width: 320,
                            height: 320,
                            style: {
                              objectFit: 'contain',
                            },
                          },
                        },
                      ],
                    },
                  },
                ],
              },
            }
          : null,

        // ── Zona derecha: branding + título opcional ──
        {
          type: 'div',
          props: {
            style: {
              display: 'flex',
              flexDirection: 'column',
              alignItems: logoSrc ? 'flex-start' : 'center',
              justifyContent: 'center',
              flex: 1,
              paddingLeft: logoSrc ? 20 : 0,
              paddingRight: 80,
              gap: 24,
            },
            children: [
              // Título de la carrera (si se pasa)
              title
                ? {
                    type: 'div',
                    props: {
                      style: {
                        color: '#e2e2e9',
                        fontSize: title.length > 40 ? 36 : 44,
                        fontWeight: 600,
                        lineHeight: 1.2,
                        maxWidth: logoSrc ? 500 : 800,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      },
                      children: title,
                    },
                  }
                : null,

              // Separador
              title
                ? {
                    type: 'div',
                    props: {
                      style: {
                        width: 60,
                        height: 3,
                        background: '#aac7ff',
                        borderRadius: 2,
                      },
                    },
                  }
                : null,

              // Branding: icono + nombre
              {
                type: 'div',
                props: {
                  style: {
                    display: 'flex',
                    alignItems: 'center',
                    gap: 14,
                  },
                  children: [
                    BRAND_ICON,
                    {
                      type: 'div',
                      props: {
                        style: {
                          color: '#8e9099',
                          fontSize: 28,
                          fontWeight: 600,
                        },
                        children: 'Calendario Ciclismo',
                      },
                    },
                  ],
                },
              },
            ].filter(Boolean),
          },
        },
      ].filter(Boolean),
    },
  };

  // ── Renderizar con satori → SVG ──
  const svg = await satori(markup, {
    width: WIDTH,
    height: HEIGHT,
    fonts: [
      {
        name: 'Inter',
        data: font,
        weight: 600,
        style: 'normal',
      },
    ],
  });

  // ── SVG → PNG con resvg ──
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: WIDTH },
  });
  const pngData = resvg.render();
  return pngData.asPng();
}

// ── Handler principal ───────────────────────────────────────────
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    // Solo GET
    if (request.method !== 'GET') {
      return new Response('Method not allowed', { status: 405 });
    }

    const logoUrl = url.searchParams.get('logo');
    const title = url.searchParams.get('title') || '';

    // Sin logo → redirigir al OG por defecto
    if (!logoUrl) {
      return Response.redirect(DEFAULT_OG, 302);
    }

    // Validar que el logo sea de nuestro CDN
    if (!logoUrl.startsWith('https://assets.calendariociclismo.app/')) {
      return new Response('Invalid logo URL', { status: 400 });
    }

    try {
      const png = await generateOgImage(logoUrl, title);

      return new Response(png, {
        headers: {
          'Content-Type': 'image/png',
          'Cache-Control': 'public, max-age=604800, s-maxage=2592000',
          'CDN-Cache-Control': 'public, max-age=2592000',
          'Access-Control-Allow-Origin': '*',
        },
      });
    } catch (err) {
      console.error('OG generation error:', err);
      return Response.redirect(DEFAULT_OG, 302);
    }
  },
};
