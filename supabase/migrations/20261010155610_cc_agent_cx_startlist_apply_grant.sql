-- cc_agent: aplicación de inscritos CX de la skill cc-cx-carreras.
--
-- public.cx_apply_startlist_import (SECURITY INVOKER) bloquea la importación
-- con SELECT … FOR UPDATE y la marca como aplicada; ambas operaciones exigen
-- UPDATE. cc_agent solo tenía SELECT e INSERT. Se concede el mismo UPDATE por
-- columnas que ya tiene authenticated.

GRANT UPDATE (status, "appliedAt") ON TABLE private.cx_startlist_imports TO cc_agent;
