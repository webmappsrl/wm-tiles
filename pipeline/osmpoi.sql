-- POI puntuali che lo schema OpenMapTiles non porta, o porta troppo tardi:
-- cime, valichi, sorgenti, rifugi minori, punti panoramici.
--
-- Il dialetto OGRSQL non ha COALESCE ne' CASE: i tre tag si estraggono in
-- colonne separate e `kind` si compone dopo, con jq.
SELECT name,
       hstore_get_value(other_tags, 'natural')       AS t_natural,
       hstore_get_value(other_tags, 'tourism')       AS t_tourism,
       hstore_get_value(other_tags, 'amenity')       AS t_amenity,
       hstore_get_value(other_tags, 'mountain_pass') AS t_pass,
       hstore_get_value(other_tags, 'ele')           AS ele
FROM points
WHERE name IS NOT NULL
  AND other_tags IS NOT NULL
  AND (
    hstore_get_value(other_tags, 'natural') IN ('peak','saddle','spring','cave_entrance')
    OR hstore_get_value(other_tags, 'tourism') IN ('alpine_hut','wilderness_hut','viewpoint','picnic_site')
    OR hstore_get_value(other_tags, 'amenity') IN ('shelter','drinking_water')
    OR hstore_get_value(other_tags, 'mountain_pass') = 'yes'
  )
