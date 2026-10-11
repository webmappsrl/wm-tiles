-- Generato da pipeline/tgen-layer-sql.py dal project.mml di TGen: non modificare a mano.
-- Inventario delle celle generate da TGen (generate_map_tiles.sh scrive qui le date).
COPY (SELECT (to_jsonb(g) - 'geom' - 'the_geom' - 'wkb_geometry')::text FROM grid_1x1 g)
TO STDOUT WITH (FORMAT csv, DELIMITER E'\x02', QUOTE E'\x01');
