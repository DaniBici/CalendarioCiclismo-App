export function hasRenderableElevationProfile(rd) {
  const profile = rd?.elevationProfile;
  return !!(profile
    && !rd.profileNotViewable
    && Array.isArray(profile.points)
    && profile.points.length >= 2);
}
