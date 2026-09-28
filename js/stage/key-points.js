export function hasStageKeyPoints(day = {}) {
  return (day.profileSummits?.length ?? 0) > 0 || (day.profileWaypoints?.length ?? 0) > 0;
}
