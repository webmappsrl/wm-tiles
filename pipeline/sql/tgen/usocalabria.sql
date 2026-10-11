-- Generato da pipeline/tgen-layer-sql.py dal project.mml di TGen: non modificare a mano.
-- Layer: usocalabria
-- Database: general, tabelle: usocalabria
COPY (
  SELECT json_build_object(
    'type', 'Feature',
    'properties', to_jsonb(d) - 'geom',
    'geometry', ST_AsGeoJSON(ST_Transform(d.geom, 4326), 6)::json
  )::text
  FROM (
  SELECT gid, geom,
    CASE
    WHEN iii IN ('121','122','123','124','131','132','133','331','332') THEN 'bianco'
    WHEN iii IN ('333') THEN 'bianco_sporco'
    WHEN iii IN ('411') THEN 'zumide'
    WHEN iii IN ('221') THEN 'vigneti'
    WHEN iii IN ('223','225','245','246') THEN 'frutteti'
    WHEN iii IN ('224') THEN 'oliveti'
    WHEN iii IN ('231','321') THEN 'pascolo'
    WHEN iii IN ('322','323','324') THEN 'arbusti'
    WHEN iii IN ('311') THEN 'blatifoglie'
    WHEN iii IN ('312') THEN 'bconifere'
    WHEN iii IN ('226','244','313') THEN 'bosco'
    WHEN iii IN ('511','512','521','522') THEN 'acque'
    WHEN iii IN ('111','112','114','144','334') THEN 'fondogiallo'
    WHEN iii IN ('141','142') THEN 'verdeurb'
    WHEN iii IN ('211','212','241','242','243') THEN 'verdeneutro'
    ELSE 'fondogiallo'
    END AS coduso
    FROM usocalabria
) AS d
  WHERE d.geom && ST_Transform(ST_MakeEnvelope(6.6, 35.4, 18.6, 47.1, 4326), 3857)
) TO STDOUT WITH (FORMAT csv, DELIMITER E'\x02', QUOTE E'\x01');
