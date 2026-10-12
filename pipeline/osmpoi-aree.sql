-- Rifugi, bivacchi e ripari disegnati come AREE (di solito l'edificio): in
-- Italia sono circa tre rifugi su quattro. TGen li prende da planet_osm_polygon
-- (amenity-points-poly) e ne mette icona e nome all'interno; senza questa query
-- mancavano dalla mappa (11/10/2026). Il punto interno lo calcola
-- punto-interno.py, le proprieta' si compongono come per osmpoi.sql.
--
-- Nel layer `multipolygons` del driver OSM `tourism` e `amenity` sono colonne
-- proprie.
SELECT name,
       tourism                             AS t_tourism,
       amenity                             AS t_amenity,
       hstore_get_value(other_tags, 'ele') AS ele
FROM multipolygons
WHERE tourism IN ('alpine_hut','wilderness_hut') OR amenity = 'shelter'
