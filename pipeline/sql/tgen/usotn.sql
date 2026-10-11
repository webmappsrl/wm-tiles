-- Generato da pipeline/tgen-layer-sql.py dal project.mml di TGen: non modificare a mano.
-- Layer: usotn
-- Database: general, tabelle: uso_tn
COPY (
  SELECT json_build_object(
    'type', 'Feature',
    'properties', to_jsonb(d) - 'geom',
    'geometry', ST_AsGeoJSON(ST_Transform(d.geom, 4326), 6)::json
  )::text
  FROM (
  SELECT  id,  geom,
    CASE
      WHEN ur_cd IN ('1221','1222','1250','1251','1252','1253','1254','1260','1261','1262','1263','1270','1271','1280','1311','1312','1320','1330','3321') THEN 'bianco'
      WHEN ur_cd IN ('2210') THEN 'vigneti' WHEN ur_cd IN ('2220') THEN 'frutteti'
      WHEN ur_cd IN ('2230') THEN 'oliveti' WHEN ur_cd IN ('2310', '3210', '3321') THEN 'pascolo'
      WHEN ur_cd IN ('1410', '1421', '1422') THEN 'verdeurb'
      WHEN ur_cd IN ('3220', '3221', '3240', '3241', '3242','3321','3323') THEN 'arbusti'
      WHEN ur_cd IN ('3110') THEN 'blatifoglie'
      WHEN ur_cd IN ('3120', '3321') THEN 'bconifere'
      WHEN ur_cd IN ('3130') THEN 'bosco'
      WHEN ur_cd IN ('5110','5111','5112','5121','5122') THEN 'acque'
      WHEN ur_cd IN ('3350') THEN 'ghiacciai'
      WHEN ur_cd IN ('4100','4110','4120') THEN 'zumide'
      WHEN ur_cd IN ('2400','2500') THEN 'verdeneutro'
      ELSE 'fondogiallo'
      END
      AS coduso FROM uso_tn
) AS d
  WHERE d.geom && ST_Transform(ST_MakeEnvelope(6.6, 35.4, 18.6, 47.1, 4326), 3857)
) TO STDOUT WITH (FORMAT csv, DELIMITER E'\x02', QUOTE E'\x01');
