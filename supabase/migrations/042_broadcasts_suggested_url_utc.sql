-- Añade URL del canal y horas UTC a las sugerencias.
-- Course du jour expone estos datos para la mayoría de broadcasters:
--   · <a href="..."> en el <li> del broadcaster (URL del stream / web del canal)
--   · <button class="copy-cal" data-utc-start data-utc-end> con la ventana
--     de retransmisión exacta para los broadcasters que lo soportan.
-- Persistirlos en la sugerencia permite que el editor solo tenga que aceptar
-- para tener el broadcast 100% completo, sin volver a la fuente.

ALTER TABLE broadcasts_suggested
  ADD COLUMN IF NOT EXISTS url            TEXT,
  ADD COLUMN IF NOT EXISTS "startTimeUtc" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "endTimeUtc"   TIMESTAMPTZ;
