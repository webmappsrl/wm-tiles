-- Generato da pipeline/tgen-layer-sql.py dal project.mml di TGen: non modificare a mano.
-- Layer: usoliguria
-- Database: general, tabelle: usoliguria2015
COPY (
  SELECT json_build_object(
    'type', 'Feature',
    'properties', to_jsonb(d) - 'geom',
    'geometry', ST_AsGeoJSON(ST_Transform(d.geom, 4326), 6)::json
  )::text
  FROM (
  SELECT id, geom,
    CASE
    WHEN cod_uso IN ('1213', '1221', '1222', '1223', '1224', '1225', '1231', '1232', '124', '131', '132', '1331', '1332', '143', '331', '332', '334') THEN 'bianco'
    WHEN cod_uso IN ('411', '412') THEN 'zumide'
    WHEN cod_uso IN ('221', '2211', '2212') THEN 'vigneti'
    WHEN cod_uso IN ('2221') THEN 'frutteti'
    WHEN cod_uso IN ('223', '2231') THEN 'oliveti'
    WHEN cod_uso IN ('134', '1421', '1424', '1425', '1428', '2122', '231', '321') THEN 'pascolo'
    WHEN cod_uso IN ('141') THEN 'verdeurb'      WHEN cod_uso IN ('322', '323', '324', '5114') THEN 'arbusti'
    WHEN cod_uso IN ('3114', '3115', '3116', '3117') THEN 'blatifoglie'
    WHEN cod_uso IN ('312') THEN 'bconifere'
    WHEN cod_uso IN ('224', '244', '3111', '3112', '3113', '313') THEN 'bosco'
    WHEN cod_uso IN ('5112', '5121', '5122', '522', '5231', '5232') THEN 'acque'
    WHEN cod_uso IN ('1111', '1112', '1121', '1122', '1211', '1212', '1422', '1423', '1426', '1427', '211',  '333', '5111', '5113') THEN 'fondogiallo'
    WHEN cod_uso IN ('2121', '2122', '2123', '2124', '2125', '241', '242',  '243') THEN 'verdeurb'
    ELSE 'red'
    END    AS coduso
    FROM usoliguria2015
) AS d
  WHERE d.geom && ST_Transform(ST_MakeEnvelope(6.6, 35.4, 18.6, 47.1, 4326), 3857)
) TO STDOUT WITH (FORMAT csv, DELIMITER E'\x02', QUOTE E'\x01');
