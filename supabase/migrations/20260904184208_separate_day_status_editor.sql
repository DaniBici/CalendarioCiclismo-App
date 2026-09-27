-- El estado confirmado se guarda sin recalcular el cronometraje ni renovar la
-- verificación editorial de un fuera de control existente.
CREATE FUNCTION public.admin_save_day_status(day_id text, status_value text) RETURNS void
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE normalized_status text := NULLIF(trim(status_value),'');
BEGIN
  IF NOT (SELECT private.is_admin()) THEN
    RAISE EXCEPTION 'Solo administración' USING ERRCODE='42501';
  END IF;
  IF normalized_status IS NOT NULL AND normalized_status NOT IN ('scheduled','running','finished') THEN
    RAISE EXCEPTION 'Estado de competición no válido';
  END IF;
  UPDATE public.race_days SET "raceStatus"=normalized_status WHERE id=day_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Jornada inexistente'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_save_day_status(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_save_day_status(text,text) TO authenticated;
