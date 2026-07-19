-- ─────────────────────────────────────────────────────────────────
--  Fix avalancha de dispatches al importar un orden de salida.
--
--  PROBLEMA (cazado 2026-06-13, Tour de Beauce etapa 4):
--    El trigger trigger_workflows_on_start_order_entries (migración 064)
--    era AFTER INSERT/UPDATE/DELETE … FOR EACH ROW. Importar el orden de
--    salida de una CRI = INSERT masivo de N filas (122 corredores en
--    Beauce E4) → el trigger se ejecutó 122 veces → 122 net.http_post →
--    122 dispatches de og-pages.yml + 122 de sitemap.yml en el mismo
--    segundo (~244 runs de GitHub Actions de golpe).
--
--    El anti-thundering-herd de la edge function trigger-workflows NO lo
--    evitó: su coalescing de 30s vive en un Map EN MEMORIA del worker, y
--    las edge functions de Supabase son serverless/sin estado compartido
--    → 122 peticiones casi simultáneas caen en workers fríos y todas
--    pasan el shouldDispatch(). La afirmación de la migración 064 ("un
--    INSERT masivo de 200 corredores no genera 200 dispatches") era falsa.
--
--  FIX (causa raíz):
--    El trigger sobre start_order_entries pasa a FOR EACH STATEMENT. Un
--    INSERT/UPDATE/DELETE masivo de N filas = 1 sola ejecución del trigger
--    = 1 par de dispatches, sin depender del coalescing en memoria.
--
--    La función trigger_workflows_for_start_order() se reutiliza tal cual:
--    en statement-level NEW/OLD son NULL y `RETURN COALESCE(NEW, OLD)`
--    devuelve NULL, válido para un trigger AFTER.
--
--    El trigger de race_days (AFTER UPDATE OF startOrderImportedAt FOR EACH
--    ROW con WHEN) NO se toca: actualiza una fila por importación, no causa
--    avalancha, y su WHEN necesita NEW/OLD (incompatible con statement).
-- ─────────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS trigger_workflows_on_start_order_entries ON public.start_order_entries;
CREATE TRIGGER trigger_workflows_on_start_order_entries
AFTER INSERT OR UPDATE OR DELETE ON public.start_order_entries
FOR EACH STATEMENT
EXECUTE FUNCTION public.trigger_workflows_for_start_order();
