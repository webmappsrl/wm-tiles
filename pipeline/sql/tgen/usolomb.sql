-- Generato da pipeline/tgen-layer-sql.py dal project.mml di TGen: non modificare a mano.
-- Layer: usolomb
-- Database: general, tabelle: usolombardia
COPY (
  SELECT json_build_object(
    'type', 'Feature',
    'properties', to_jsonb(d) - 'geom',
    'geometry', ST_AsGeoJSON(ST_Transform(d.geom, 4326), 6)::json
  )::text
  FROM (
  SELECT  gid,  geom,
    CASE
      WHEN identifica IN ('1222','123','124','131','132','133','134') THEN 'bianco'
      WHEN identifica IN ('331','332','333') THEN 'bianco_sporco'
      WHEN identifica IN ('411','2313', '213') THEN 'zumide'
      WHEN identifica IN ('221') THEN 'vigneti'
      WHEN identifica IN ('222') THEN 'frutteti'
      WHEN identifica IN ('223') THEN 'oliveti'
      WHEN identifica IN ('2311', '3211','3212') THEN 'pascolo'
      WHEN identifica IN ('1411','1422','1423','1424') THEN 'verdeurb'
      WHEN identifica IN ('2312', '3221', '3222', '31322','3223','3241','3242') THEN 'arbusti'
      WHEN identifica IN ('31111','31112','31121','3114','31122' ) THEN 'blatifoglie'
      WHEN identifica IN ('335') THEN 'ghiacciai'
      WHEN identifica IN ('3121','3122') THEN 'bconifere'
      WHEN identifica IN ('3113','31311','31312','31321','314') THEN 'bosco'
      WHEN identifica IN ('423', '511', '512', '521', '523', '5122', '5121') THEN 'acque'
      WHEN identifica IN ('1111', '1112', '1121', '1122', '1123', '11231', '12111', '12112', '12121', '12122','12123', '12124', '1421','12125','1221','1412','2241' ) THEN 'fondogiallo'
      WHEN identifica IN ('2111','2112','21131','21132','21141','21142','2115','2242') THEN 'verdeneutro'
      ELSE 'fondogiallo'
      END AS coduso
      FROM usolombardia
) AS d
  WHERE d.geom && ST_Transform(ST_MakeEnvelope(6.6, 35.4, 18.6, 47.1, 4326), 3857)
) TO STDOUT WITH (FORMAT csv, DELIMITER E'\x02', QUOTE E'\x01');
