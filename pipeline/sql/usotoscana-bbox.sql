COPY (
  SELECT json_build_object(
           'type','Feature',
           'properties', json_build_object('coduso', d.coduso, 'src', 'usotoscana'),
           'geometry', ST_AsGeoJSON(ST_Transform(d.geom,4326))::json)::text
  FROM ( SELECT gid, geom, CASE WHEN lv3_13 IN ('122', '123', '124', '131', '132', '133', '331', '332', '333') THEN 'bianco' WHEN lv3_13 IN ('213', '411', '421') THEN 'zumide' WHEN lv3_13 IN ('221') THEN 'vigneti' WHEN lv3_13 IN ('222') THEN 'frutteti' WHEN lv3_13 IN ('223') THEN 'oliveti' WHEN lv3_13 IN ('231', '321') THEN 'pascolo' WHEN lv3_13 IN ('141') THEN 'verdeurb' WHEN lv3_13 IN ('244', '322', '323', '324') THEN 'arbusti' WHEN lv3_13 IN ('311') THEN 'blatifoglie' WHEN lv3_13 IN ('312') THEN 'bconifere' WHEN lv3_13 IN ('313') THEN 'bosco' WHEN lv3_13 IN ('423', '511', '512', '521', '523') THEN 'acque' WHEN lv3_13 IN ('111', '112', '121', '334' ) THEN 'fondogiallo' WHEN lv3_13 IN ('142') THEN 'ricsport' WHEN lv3_13 IN ('210', '241', '242', '243') THEN 'verdeneutro' ELSE 'red' END AS coduso FROM usotoscana2013 ) AS d
  WHERE d.geom && ST_MakeEnvelope(1113195,5439905,1213382,5543148,3857)
) TO STDOUT
