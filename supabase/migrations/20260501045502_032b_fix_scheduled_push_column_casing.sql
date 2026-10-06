-- Recuperada el 2026-09-28 de supabase_migrations.schema_migrations.statements
-- (versión 20260501045502, nombre 032b_fix_scheduled_push_column_casing). Texto aplicado en producción, sin cambios.

ALTER TABLE scheduled_push_notifications
  RENAME COLUMN imageurl      TO "imageUrl";
ALTER TABLE scheduled_push_notifications
  RENAME COLUMN deeplink      TO "deepLink";
ALTER TABLE scheduled_push_notifications
  RENAME COLUMN scheduledat   TO "scheduledAt";
ALTER TABLE scheduled_push_notifications
  RENAME COLUMN createdat     TO "createdAt";
ALTER TABLE scheduled_push_notifications
  RENAME COLUMN createdby     TO "createdBy";
ALTER TABLE scheduled_push_notifications
  RENAME COLUMN sentat        TO "sentAt";
ALTER TABLE scheduled_push_notifications
  RENAME COLUMN recipientcount TO "recipientCount";
ALTER TABLE scheduled_push_notifications
  RENAME COLUMN errormessage  TO "errorMessage";
