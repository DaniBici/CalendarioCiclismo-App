-- Push subscriptions: borrado por RPC y retirada del acceso directo de anon.
--
-- Sustituye el DELETE directo de anon sobre push_subscriptions (política
-- anon_delete_own_push_subscription y GRANT SELECT ("deviceToken") de la 124)
-- por la RPC delete_push_subscription(p_token), SECURITY DEFINER. iOS y Android
-- la llaman desde deletePushToken en deleteAllData (derecho de supresión).
--
-- Las tablas hijas (push_subscription_categories, push_race_subscriptions,
-- push_race_filters, push_stage_subscriptions, push_cx_race_subscriptions)
-- referencian push_subscriptions con ON DELETE CASCADE; comprobado el
-- 2026-09-28 en producción.
--
-- La web no se ve afectada: no borra filas de push_subscriptions.

CREATE OR REPLACE FUNCTION public.delete_push_subscription(p_token text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
-- search_path vacío y nombres cualificados, como set_push_subscription_v4.
SET search_path = ''
AS $$
BEGIN
  IF p_token IS NULL OR pg_catalog.btrim(p_token) = '' THEN
    RETURN;
  END IF;

  -- Solo la fila de ese token; la RPC no admite otros filtros.
  DELETE FROM public.push_subscriptions WHERE "deviceToken" = p_token;
END;
$$;

COMMENT ON FUNCTION public.delete_push_subscription(text) IS
  'Borra la suscripción push de un deviceToken (derecho de supresión RGPD). '
  'SECURITY DEFINER: las apps borran la suya sin privilegios de anon sobre '
  'push_subscriptions. Llamada desde deletePushToken en iOS y Android.';

REVOKE ALL ON FUNCTION public.delete_push_subscription(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_push_subscription(text) TO anon, authenticated;

DROP POLICY IF EXISTS "anon_delete_own_push_subscription" ON public.push_subscriptions;

REVOKE SELECT ("deviceToken") ON public.push_subscriptions FROM anon;
REVOKE ALL ON public.push_subscriptions FROM anon;

COMMENT ON TABLE public.push_subscriptions IS
  'Tokens de push por dispositivo. anon no tiene acceso directo: registro por '
  'set_push_subscription_v4 y borrado por delete_push_subscription (ambas '
  'SECURITY DEFINER). Lectura: authenticated administrador (política '
  'auth_read_push_subscriptions) y service_role (send-push, pg_cron).';
