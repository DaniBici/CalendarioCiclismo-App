// Sustituto ligero de `elevationProfile` en listados que solo necesitan saber
// si el perfil se puede pintar: el segundo punto existe si hay al menos dos.
export const PROFILE_PROBE_COLUMN = 'profilePoint:elevationProfile->points->1';

export function hasRenderableElevationProfile(rd) {
  if (rd && !('elevationProfile' in rd) && 'profilePoint' in rd) {
    return rd.profilePoint != null && !rd.profileNotViewable;
  }
  const profile = rd?.elevationProfile;
  return !!(profile
    && !rd.profileNotViewable
    && Array.isArray(profile.points)
    && profile.points.length >= 2);
}

// La jornada tiene algo que enseñar en el modal de datos.
export function hasModalData(rd) {
  if (!rd) return false;
  return !!(
    rd.startLocation ||
    rd.distanceKm ||
    rd.primaryType ||
    rd.neutralStartTimeUtc ||
    rd.estimatedFinishTimeUtc ||
    rd.hasAssets ||
    (rd.tvStatus && rd.tvStatus !== 'none') ||
    hasRenderableElevationProfile(rd) ||
    rd.description ||
    rd.notes
  );
}
