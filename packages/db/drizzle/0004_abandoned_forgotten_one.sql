-- La secuencia debe existir antes de que la columna la use como valor por defecto.
CREATE SEQUENCE IF NOT EXISTS "train_position_version";--> statement-breakpoint
ALTER TABLE "train_positions" ADD COLUMN "version" bigint DEFAULT nextval('train_position_version') NOT NULL;--> statement-breakpoint
CREATE INDEX "train_position_version_idx" ON "train_positions" USING btree ("version");--> statement-breakpoint

-- El valor por defecto solo cubre la inserción: una actualización debe avanzar
-- la versión para que los clientes conectados reciban el cambio.
CREATE OR REPLACE FUNCTION train_position_bump_version() RETURNS trigger AS $$
BEGIN
  NEW.version := nextval('train_position_version');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER train_position_version_bump
  BEFORE UPDATE ON "train_positions"
  FOR EACH ROW EXECUTE FUNCTION train_position_bump_version();--> statement-breakpoint

-- Señal sin contenido: el cliente consulta el delta desde su propio cursor, así
-- que una notificación perdida durante una reconexión no pierde datos.
CREATE OR REPLACE FUNCTION train_position_notify() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify('train_positions_changed', '');
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER train_position_changed
  AFTER INSERT OR UPDATE ON "train_positions"
  FOR EACH STATEMENT EXECUTE FUNCTION train_position_notify();
