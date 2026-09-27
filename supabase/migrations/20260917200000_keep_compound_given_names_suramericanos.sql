-- Conserva los nombres de pila compuestos de dos corredoras de los Juegos
-- Suramericanos Santa Fe 2026 (prueba en línea femenino e61f9e21): "Ana María"
-- y "Agua Marina" se mantienen enteros como nombre de uso.
BEGIN;
UPDATE public.riders_women SET "firstName"='Ana María' WHERE id='torres-ana-maria';
UPDATE public.riders_women SET "firstName"='Agua Marina' WHERE id='espinola-salinas-agua-marina';
COMMIT;
