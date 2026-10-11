-- Generato da pipeline/tgen-layer-sql.py dal project.mml di TGen: non modificare a mano.
-- Layer: usotoscana
-- Database: general, tabelle: usotoscana2013
COPY (
  SELECT json_build_object(
    'type', 'Feature',
    'properties', to_jsonb(d) - 'geom',
    'geometry', ST_AsGeoJSON(ST_Transform(d.geom, 4326), 6)::json
  )::text
  FROM (
SELECT gid,  geom,
  CASE
    WHEN lv3_13 IN ('122', '123', '124', '131', '132', '133', '331', '332', '333') THEN 'bianco'
    WHEN lv3_13 IN ('213', '411', '421') THEN 'zumide'
    WHEN lv3_13 IN ('221') THEN 'vigneti'
    WHEN lv3_13 IN ('222') THEN 'frutteti'
    WHEN lv3_13 IN ('223') THEN 'oliveti'
    WHEN lv3_13 IN ('231', '321') THEN 'pascolo'
    WHEN lv3_13 IN ('141') THEN 'verdeurb'
    WHEN lv3_13 IN ('244', '322', '323', '324') THEN 'arbusti'
    WHEN lv3_13 IN ('311') THEN 'blatifoglie'
    WHEN lv3_13 IN ('312') THEN 'bconifere'
    WHEN lv3_13 IN ('313') THEN 'bosco'
    WHEN lv3_13 IN ('423', '511', '512', '521', '523') THEN 'acque'
    WHEN lv3_13 IN ('111', '112', '121', '334' ) THEN 'fondogiallo'
    WHEN lv3_13 IN ('142') THEN 'ricsport'
    WHEN lv3_13 IN ('210', '241', '242', '243') THEN 'verdeneutro'
    ELSE 'red'
    END
     AS coduso FROM usotoscana2013
) AS d
  WHERE d.geom && ST_Transform(ST_MakeEnvelope(6.6, 35.4, 18.6, 47.1, 4326), 3857)
) TO STDOUT WITH (FORMAT csv, DELIMITER E'\x02', QUOTE E'\x01');
