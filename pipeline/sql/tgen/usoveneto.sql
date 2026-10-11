-- Generato da pipeline/tgen-layer-sql.py dal project.mml di TGen: non modificare a mano.
-- Layer: usoveneto
-- Database: general, tabelle: uso_veneto
COPY (
  SELECT json_build_object(
    'type', 'Feature',
    'properties', to_jsonb(d) - 'geom',
    'geometry', ST_AsGeoJSON(ST_Transform(d.geom, 4326), 6)::json
  )::text
  FROM (
  SELECT  id,  geom,
    CASE
      WHEN ur_cd IN ('1294','3310','3321','3322','1262','1250','1310','1340','1221','1222','1223','1226','1227','1230','1240','1241','1242','1310','1311','1312','1320','1330','3323') THEN 'bianco'
      WHEN ur_cd IN ('3320') THEN 'bianco_sporco'
      WHEN ur_cd IN ('331','332','333') THEN 'bianco_sporco'
      WHEN ur_cd IN ('4100','4110','4120','4130','4210','4220') THEN 'zumide'
      WHEN ur_cd IN ('2210') THEN 'vigneti'
      WHEN ur_cd IN ('2230') THEN 'oliveti'
      WHEN ur_cd IN ('3355','2310','2320','3211','3212','3210','3213','3230') THEN 'pascolo'
      WHEN ur_cd IN ('1340','1410','1420','1421','1422','1131') THEN 'verdeurb'
      WHEN ur_cd IN ('3220','3330','3340','3221','3223','3240','3140','3241','3242') THEN 'arbusti'
      WHEN ur_cd IN ('3110','3111','3112','3113','3114','3115','3116','3117','3118','3119', '3160') THEN 'blatifoglie'
      WHEN ur_cd IN ('3120','3121','3122','3123','3124','3125','3115','3115','3150') THEN 'bconifere'
      WHEN ur_cd IN ('3130','3131') THEN 'bosco'
      WHEN ur_cd IN ('423', '511', '512', '521', '523') THEN 'acque'
      WHEN ur_cd IN ('5110','5111','5112','5121','5122','5123','5124','5210','5230') THEN 'acquebordo'
      WHEN ur_cd IN ('3350') THEN 'ghiacciai'
      WHEN ur_cd IN ('2110', '2111', '2112', '2113', '2114', '2115', '2116', '2117', '2118', '2120', '2121', '2122', '2123', '2124', '2125', '2126', '2127', '2128', '2130') THEN 'verdeneutro'
      ELSE 'fondogiallo'
      END
      AS coduso FROM uso_veneto
) AS d
  WHERE d.geom && ST_Transform(ST_MakeEnvelope(6.6, 35.4, 18.6, 47.1, 4326), 3857)
) TO STDOUT WITH (FORMAT csv, DELIMITER E'\x02', QUOTE E'\x01');
