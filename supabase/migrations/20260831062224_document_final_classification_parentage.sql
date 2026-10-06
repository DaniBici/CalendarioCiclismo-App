-- Recuperada el 2026-09-28 de supabase_migrations.schema_migrations.statements
-- (versión 20260831062224, nombre document_final_classification_parentage). Texto aplicado en producción, sin cambios.


comment on table public.race_uci_stages is
'Cabecera por clasificación. Las clasificaciones de jornada se vinculan mediante raceDayId/stageNumber. Las clasificaciones generales finales pertenecen a la carrera completa: isFinalClassification=true y raceDayId/stageNumber deben quedar NULL. classKind=tipo; scope=stage|overall. keepForWeb marca lo que la web pinta.';

comment on column public.race_uci_stages."raceDayId" is
'Jornada a la que pertenece una clasificación de etapa. Debe ser NULL en toda clasificación general final, aunque se publique al terminar la última etapa.';

comment on column public.race_uci_stages."stageNumber" is
'Número de etapa para clasificaciones de jornada. Debe ser NULL cuando isFinalClassification=true para que web y aplicaciones agrupen la tabla en la pestaña Finales.';

comment on column public.race_uci_stages."isFinalClassification" is
'TRUE para clasificaciones definitivas de la carrera completa. En carreras por etapas exige raceDayId=NULL y stageNumber=NULL; no se debe asociar la final a la última etapa.';
