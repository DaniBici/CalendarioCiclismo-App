-- 107 — race_uci_links."matchMethod": cómo se creó el enlace carrera↔competición UCI.
--
-- Hasta ahora el alta del enlace tenía dos orígenes y solo un booleano (autoMatched)
-- para distinguirlos: TRUE = lo puso el matcher (uci-match-poc.mjs, casos `unique`),
-- FALSE = lo puso un humano en el panel. La pasada de TARDE (uci-link-evening.mjs)
-- añade un TERCER origen, el más delicado: enlaces de carreras que el matcher dejó
-- AMBIGUAS (≥2 candidatos / colisión masc-fem) y que se resuelven automáticamente
-- VALIDANDO contra la startlist curada (se descargan los resultados de cada candidata
-- y se comprueba que sus participantes coinciden con nuestra startlist). Esos enlaces
-- son correctos con alta confianza, pero conviene poder AUDITARLOS y revertirlos a ojo
-- sin tener que re-correr nada.
--
-- matchMethod (texto libre, NULL = legacy / sin clasificar):
--   'unique'              → el matcher lo resolvió inequívocamente (autoMatched=TRUE).
--   'ambiguous-startlist' → ambiguo resuelto por validación de startlist (la pasada de
--                           tarde). Estos son los que merece la pena vigilar.
--   'manual'              → alta humana desde el panel (informativo; el panel puede
--                           empezar a fijarlo, pero por defecto queda NULL y no pasa nada).
-- No se toca autoMatched (sigue alimentando la UI existente). Aditivo, sin downtime.

ALTER TABLE public.race_uci_links
  ADD COLUMN IF NOT EXISTS "matchMethod" TEXT;

COMMENT ON COLUMN public.race_uci_links."matchMethod" IS
  'Cómo se creó el enlace: unique (matcher inequívoco) | ambiguous-startlist (ambiguo auto-resuelto validando contra la startlist, pasada de tarde) | manual (panel) | NULL (legacy).';
