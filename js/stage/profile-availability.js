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
