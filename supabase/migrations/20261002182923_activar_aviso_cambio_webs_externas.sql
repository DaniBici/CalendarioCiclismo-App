-- activar_aviso_cambio_webs_externas
--
-- Activa el aviso de cambio al destino webs-ccm-cce (migración
-- aviso_cambio_webs_externas; docs/runbooks/aviso-cambio-webs-externas.md).
--
-- El secreto compartido se genera dentro de la base: este texto, el registro
-- de migraciones y la salida no contienen su valor. Se copia desde el Vault de
-- CC al secreto de la edge function aviso-cc de webs-ccm-cce.

SELECT vault.create_secret(
  encode(extensions.gen_random_bytes(32), 'hex'),
  'aviso_cc_webs_ccm_cce',
  'Secreto compartido del aviso de cambio con la edge function aviso-cc de webs-ccm-cce (cabecera x-aviso-cc-secreto)'
);

UPDATE private.change_notice_endpoints SET enabled = true WHERE id = 'webs-ccm-cce';
