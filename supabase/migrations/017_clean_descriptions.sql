-- Limpia las descripciones de race_days:
--   1. Convierte <br> y variantes en saltos de línea
--   2. Normaliza &nbsp; al carácter NBSP (U+00A0)
--   3. Elimina líneas que están vacías o contienen solo espacios/NBSP

UPDATE race_days
SET description = sub.cleaned
FROM (
  WITH normalized AS (
    SELECT
      id,
      regexp_replace(
        replace(description, '&nbsp;', chr(160)),
        '<br\s*/?>',
        chr(10),
        'gi'
      ) AS text
    FROM race_days
    WHERE description IS NOT NULL AND description != ''
  ),
  exploded AS (
    SELECT n.id, t.line, t.seq
    FROM normalized n,
      unnest(string_to_array(n.text, chr(10))) WITH ORDINALITY AS t(line, seq)
    WHERE replace(trim(t.line), chr(160), '') != ''
  ),
  joined AS (
    SELECT id, string_agg(line, chr(10) ORDER BY seq) AS cleaned
    FROM exploded
    GROUP BY id
  )
  SELECT j.id, j.cleaned
  FROM joined j
) sub
WHERE race_days.id = sub.id
  AND race_days.description IS DISTINCT FROM sub.cleaned;
