SELECT geom,
       CASE class
         WHEN 10  THEN 'bosco'
         WHEN 20  THEN 'arbusti'
         WHEN 30  THEN 'pascolo'
         WHEN 40  THEN 'verdeneutro'
         WHEN 50  THEN 'fondogiallo'
         WHEN 60  THEN 'bianco'
         WHEN 70  THEN 'ghiacciai'
         WHEN 80  THEN 'acquefondo'
         WHEN 90  THEN 'zumide'
         WHEN 95  THEN 'zumide'
         WHEN 100 THEN 'pascolo'
       END AS coduso
FROM lc
WHERE class > 0
