-- Generato da pipeline/tgen-layer-sql.py dal project.mml di TGen: non modificare a mano.
-- Layer: usobz
-- Database: general, tabelle: uso_bz
COPY (
  SELECT json_build_object(
    'type', 'Feature',
    'properties', to_jsonb(d) - 'geom',
    'geometry', ST_AsGeoJSON(ST_Transform(d.geom, 4326), 6)::json
  )::text
  FROM (
SELECT  id,  geom,
  CASE
    WHEN ur_cd IN ('1271','1310','1311','1312','1320','1320','3322') THEN 'bianco'
    WHEN ur_cd IN ('3321') THEN 'bianco_sporco'
    WHEN ur_cd IN ('2400') THEN 'frutteti'
    WHEN ur_cd IN ('3230') THEN 'pascolo'
    WHEN ur_cd IN ('1130', '1410') THEN 'verdeurb'
    WHEN ur_cd IN ('3221','3240') THEN 'arbusti'
    WHEN ur_cd IN ('3160') THEN 'blatifoglie'
    WHEN ur_cd IN ('3150') THEN 'bconifere'
    WHEN ur_cd IN ('5110','5111') THEN 'acque'
    WHEN ur_cd IN ('3350') THEN 'ghiacciai'
    WHEN ur_cd IN ('4100') THEN 'zumide'
    WHEN ur_cd IN ('2100') THEN 'verdeneutro'
    ELSE 'fondogiallo'
    END
    AS coduso FROM uso_bz
) AS d
  WHERE d.geom && ST_Transform(ST_MakeEnvelope(6.6, 35.4, 18.6, 47.1, 4326), 3857)
) TO STDOUT WITH (FORMAT csv, DELIMITER E'\x02', QUOTE E'\x01');
