-- Tralicci e pali (power-towers e power-poles del project.mml di TGen).
SELECT hstore_get_value(other_tags, 'power') AS kind
FROM points
WHERE other_tags IS NOT NULL
  AND hstore_get_value(other_tags, 'power') IN ('tower', 'pole')
