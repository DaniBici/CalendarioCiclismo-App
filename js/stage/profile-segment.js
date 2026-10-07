// Medición de un tramo del perfil: distancia, desnivel positivo y negativo
// acumulados y pendiente media entre dos puntos kilométricos. Los extremos se
// interpolan sobre la polilínea; los vértices intermedios se recorren en orden.

export function profileSegmentStats(points, kmA, kmB, interpolateAlt) {
  if (!Array.isArray(points) || points.length < 2 || typeof interpolateAlt !== 'function') return null;
  const from = Math.min(kmA, kmB), to = Math.max(kmA, kmB);
  const distance = to - from;
  if (!(distance > 0)) return null;
  const altitudes = [interpolateAlt(from)];
  for (const point of points) if (point.km > from && point.km < to) altitudes.push(point.alt);
  altitudes.push(interpolateAlt(to));
  let ascent = 0, descent = 0;
  for (let i = 1; i < altitudes.length; i++) {
    const diff = altitudes[i] - altitudes[i - 1];
    if (diff > 0) ascent += diff; else descent -= diff;
  }
  const startAlt = altitudes[0], endAlt = altitudes[altitudes.length - 1];
  return {
    from, to, distance, ascent, descent, startAlt, endAlt,
    gradient: (endAlt - startAlt) / (distance * 1000) * 100,
  };
}
