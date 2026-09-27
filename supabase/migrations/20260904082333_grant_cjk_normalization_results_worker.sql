-- El recolector del VPS escribe con cc_results_worker, sin service_role.
GRANT EXECUTE ON FUNCTION public.remove_cjk_name_annotations(text),
  public.normalize_cjk_rider_name(text,text),
  public.guard_cjk_rider_name(),
  public.guard_cjk_rider_display()
TO cc_results_worker;
