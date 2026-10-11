-- Linee elettriche come le seleziona TGen (power.mss, layer power-line e
-- power-minorline del project.mml): `line` e `minor_line`, e i cavi solo se
-- fuori terra. OpenMapTiles non le porta.
SELECT hstore_get_value(other_tags, 'power')    AS kind,
       hstore_get_value(other_tags, 'location') AS location
FROM lines
WHERE other_tags IS NOT NULL
  AND (
    hstore_get_value(other_tags, 'power') IN ('line', 'minor_line')
    OR (hstore_get_value(other_tags, 'power') = 'cable'
        AND hstore_get_value(other_tags, 'location') IN ('overground', 'overhead', 'surface', 'outdoor', 'platform'))
  )
