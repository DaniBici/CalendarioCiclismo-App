-- cc_agent: fusión de clubes CX de la skill cc-cx-carreras y credencial en
-- AGENT_DATABASE_URL.
--
-- private.cx_merge_team (SECURITY DEFINER) solo era ejecutable por postgres.
-- La credencial de cc_agent pasa a AGENT_DATABASE_URL; DATABASE_URL conserva
-- la administradora para migraciones y aprovisionamiento.

GRANT EXECUTE ON FUNCTION private.cx_merge_team(text,text,text) TO cc_agent;

COMMENT ON ROLE cc_agent IS
  'Agentes de programación: datos de contenido y RPC de edición. Credencial en AGENT_DATABASE_URL del .env local; aprovisionar con scripts/db/provision-agent-role.mjs.';
