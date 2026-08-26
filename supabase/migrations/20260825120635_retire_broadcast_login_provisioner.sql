-- La credencial del VPS ya está provisionada. Se elimina la función temporal
-- para que no quede ninguna superficie reutilizable de ALTER ROLE.

DROP FUNCTION private.provision_cc_broadcasts_login(text);
