# Migraciones

Esquema inicial preparado para PostgreSQL + PostGIS. `npm run db:generate` genera SQL sin conectarse a una base de datos. La primera migración incluye `CREATE EXTENSION IF NOT EXISTS postgis;` antes de crear columnas geométricas. Requiere que PostGIS esté disponible en el servidor y que el usuario pueda habilitarlo. No se han aplicado migraciones ni creado servicios externos en esta entrega.

Drizzle 0.45 genera `geometry(point)` aunque la configuración incluya SRID. Las restricciones CHECK exigen SRID 4326 para cualquier punto no nulo. Las inserciones geográficas deberán usar `ST_SetSRID(ST_MakePoint(longitud, latitud), 4326)` explícitamente; el mapeo directo de tuplas de esta versión no añade SRID.
