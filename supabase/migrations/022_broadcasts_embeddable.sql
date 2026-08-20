-- Marca si una emisión de YouTube permite embed (iframe).
-- Se rellena desde el panel al guardar, validando contra el endpoint público
-- oEmbed (https://www.youtube.com/oembed). Si la URL no es de YouTube o no se
-- ha podido validar, queda NULL (se trata como "embeddable" por defecto en el
-- render para no romper el comportamiento previo).
ALTER TABLE broadcasts
  ADD COLUMN IF NOT EXISTS "embeddable" BOOLEAN;
