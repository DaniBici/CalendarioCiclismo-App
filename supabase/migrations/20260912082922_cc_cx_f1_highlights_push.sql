-- CC-CX F1. Destinos del Cintillo y persistencia del seguimiento CX.
-- No amplía categorías push ni activa envíos: send-push continúa como único emisor.

ALTER TABLE public.today_highlights
  ADD COLUMN "cxRaceId" text REFERENCES public.cx_races(id) ON DELETE CASCADE;
ALTER TABLE public.today_highlights DROP CONSTRAINT today_highlights_targettype_check;
ALTER TABLE public.today_highlights ADD CONSTRAINT today_highlights_targettype_check
  CHECK ("targetType" IN ('raceDay','startlist','startOrder','race','custom','championships','transfers','cxRace'));
ALTER TABLE public.today_highlights DROP CONSTRAINT today_highlights_target_check;
ALTER TABLE public.today_highlights ADD CONSTRAINT today_highlights_target_check CHECK (
  ("targetType" = 'cxRace' AND "cxRaceId" IS NOT NULL
    AND "raceId" IS NULL AND "raceDayId" IS NULL AND "customUrl" IS NULL)
  OR ("targetType" <> 'cxRace' AND "cxRaceId" IS NULL AND (
    ("targetType" IN ('startlist','race') AND "raceId" IS NOT NULL)
    OR ("targetType" IN ('raceDay','startOrder') AND "raceDayId" IS NOT NULL)
    OR ("targetType" = 'custom' AND "customUrl" IS NOT NULL)
    OR "targetType" IN ('championships','transfers')
  ))
);
CREATE INDEX today_highlights_cx_race_idx ON public.today_highlights("cxRaceId") WHERE "cxRaceId" IS NOT NULL;

CREATE TABLE public.push_cx_race_subscriptions (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "subscriptionId" text NOT NULL REFERENCES public.push_subscriptions(id) ON DELETE CASCADE,
  "raceId" text NOT NULL REFERENCES public.cx_races(id) ON DELETE CASCADE,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("subscriptionId","raceId")
);
CREATE INDEX push_cx_race_subscriptions_race_idx ON public.push_cx_race_subscriptions("raceId");
ALTER TABLE public.push_cx_race_subscriptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.push_cx_race_subscriptions FROM PUBLIC, anon, authenticated, service_role, cc_results_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.push_cx_race_subscriptions TO authenticated;
GRANT SELECT ON TABLE public.push_cx_race_subscriptions TO service_role;
-- Suscripciones privadas. El cliente modifica solo su dispositivo mediante RPC.
CREATE POLICY cx_push_admin_read ON public.push_cx_race_subscriptions FOR SELECT TO authenticated USING ((select private.is_admin()));
CREATE POLICY cx_push_admin_insert ON public.push_cx_race_subscriptions FOR INSERT TO authenticated WITH CHECK ((select private.is_admin()));
CREATE POLICY cx_push_admin_update ON public.push_cx_race_subscriptions FOR UPDATE TO authenticated USING ((select private.is_admin())) WITH CHECK ((select private.is_admin()));
CREATE POLICY cx_push_admin_delete ON public.push_cx_race_subscriptions FOR DELETE TO authenticated USING ((select private.is_admin()));

CREATE FUNCTION public.set_push_subscription_v4(
  p_token text, p_platform text, p_is_active boolean, p_region text,
  p_country_group text, p_language text, p_categories text[],
  p_followed_races text[], p_race_filters text[], p_followed_stages text[],
  p_followed_cx_races text[] DEFAULT NULL
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_id text;
BEGIN
  IF p_token IS NULL OR btrim(p_token) = '' THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'El token del dispositivo es obligatorio';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(p_followed_cx_races) AS r(id) WHERE id IS NULL OR btrim(id) = '') THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'La lista de carreras CX contiene un identificador vacío';
  END IF;

  -- Conserva íntegro el contrato v3. El upsert del dispositivo serializa las
  -- escrituras concurrentes y todos los cambios pertenecen a una transacción.
  v_id := public.set_push_subscription_v3(p_token,p_platform,p_is_active,p_region,
    p_country_group,p_language,p_categories,p_followed_races,p_race_filters,p_followed_stages);
  IF p_followed_cx_races IS NOT NULL THEN
    DELETE FROM public.push_cx_race_subscriptions WHERE "subscriptionId" = v_id;
    INSERT INTO public.push_cx_race_subscriptions ("subscriptionId","raceId")
      SELECT v_id,id FROM unnest(p_followed_cx_races) AS r(id)
      ON CONFLICT ("subscriptionId","raceId") DO NOTHING;
  END IF;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.set_push_subscription_v4(text,text,boolean,text,text,text,text[],text[],text[],text[],text[]) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_push_subscription_v4(text,text,boolean,text,text,text,text[],text[],text[],text[],text[]) TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.set_push_subscription_v4(text,text,boolean,text,text,text,text[],text[],text[],text[],text[]) IS 'Contrato v3 + seguimiento CX. NULL conserva CX; [] borra CX. Identificación por token de dispositivo como v3; sin lectura pública de suscripciones ni envío.';

-- Lista exacta del guard de escrituras: añade solamente el nuevo contrato push.
CREATE OR REPLACE FUNCTION public.cc_check_request() RETURNS void
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  v_claims jsonb := coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb;
  v_role text := coalesce(v_claims ->> 'role','');
  v_method text := upper(coalesce(current_setting('request.method',true),''));
  v_path text := ltrim(split_part(coalesce(current_setting('request.path',true),''),'?',1),'/');
BEGIN
  IF v_role <> 'authenticated' THEN RETURN; END IF;
  IF (select private.is_admin()) THEN RETURN; END IF;
  IF v_method NOT IN ('POST','PUT','PATCH','DELETE') THEN RETURN; END IF;
  IF v_path = ANY(ARRAY['rpc/set_push_subscription_full','rpc/set_push_subscription_v2',
    'rpc/set_push_subscription_v3','rpc/set_push_subscription_with_categories','rpc/set_push_subscription_v4']) THEN RETURN; END IF;
  RAISE EXCEPTION USING errcode = '42501', message = 'La operación requiere permisos de administración';
END;
$$;
REVOKE ALL ON FUNCTION public.cc_check_request() FROM PUBLIC, anon, authenticated, service_role, authenticator;
GRANT EXECUTE ON FUNCTION public.cc_check_request() TO anon, authenticated, service_role, authenticator;

NOTIFY pgrst, 'reload schema';
