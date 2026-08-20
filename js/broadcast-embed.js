// Proveedores de emisiones que Calendario Ciclismo puede cargar de forma segura
// dentro de un iframe. Este módulo es puro para poder probar la allowlist en Node.

// Devuelve el ID del vídeo (11 chars) o null si la URL no es de YouTube.
export function extractYouTubeId(url) {
  if (!url) return null;
  let m = url.match(/youtu\.be\/([A-Za-z0-9_-]{11})/);
  if (m) return m[1];
  m = url.match(/[?&]v=([A-Za-z0-9_-]{11})/);
  if (m) return m[1];
  m = url.match(/youtube\.com\/(?:live|embed|shorts)\/([A-Za-z0-9_-]{11})/);
  if (m) return m[1];
  return null;
}

export function isCyltvPlayerUrl(url) {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    return parsed.protocol === 'https:'
      && (host === 'cyltvplay.es' || host === 'www.cyltvplay.es')
      && /^\/player\//i.test(parsed.pathname);
  } catch {
    return false;
  }
}

export function isNdrPlayerUrl(url) {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    return parsed.protocol === 'https:'
      && (host === 'ndr.de' || host === 'www.ndr.de')
      && /~player\.html$/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

// Devuelve los datos necesarios para el iframe, o null si el proveedor no está
// en la allowlist o la emisión tiene el embed deshabilitado explícitamente.
export function getBroadcastEmbed(url, embeddable = null) {
  if (!url || embeddable === false) return null;

  const ytId = extractYouTubeId(url);
  if (ytId) {
    return {
      provider: 'youtube',
      src: `https://www.youtube-nocookie.com/embed/${ytId}?autoplay=1`,
      externalUrl: url,
      externalLabel: 'YouTube',
    };
  }

  if (isCyltvPlayerUrl(url)) {
    const canonical = new URL(url).href;
    return {
      provider: 'cyltv',
      src: canonical,
      externalUrl: canonical,
      externalLabel: 'CyLTV',
    };
  }

  if (isNdrPlayerUrl(url)) {
    const canonical = new URL(url).href;
    return {
      provider: 'ndr',
      src: canonical,
      externalUrl: canonical,
      externalLabel: 'NDR',
    };
  }

  return null;
}
