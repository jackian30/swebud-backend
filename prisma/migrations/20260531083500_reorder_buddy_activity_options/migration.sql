UPDATE "buddy_activity_options"
SET "sort_order" = CASE "activity"
  WHEN 'running' THEN 10
  WHEN 'walking' THEN 20
  WHEN 'cycling' THEN 30
  WHEN 'hiking' THEN 40
  WHEN 'swimming' THEN 50
  WHEN 'climbing' THEN 60
  WHEN 'rowing' THEN 70
  WHEN 'triathlon' THEN 80
  WHEN 'soccer' THEN 90
  WHEN 'basketball' THEN 100
  WHEN 'sports' THEN 110
  WHEN 'motorcycle_ride' THEN 120
  WHEN 'vehicle_ride' THEN 130
  WHEN 'gym' THEN 140
  WHEN 'yoga' THEN 150
  WHEN 'martial_arts' THEN 160
  WHEN 'dance' THEN 170
  WHEN 'pilates' THEN 180
  WHEN 'calisthenics' THEN 190
  WHEN 'other' THEN 200
  ELSE "sort_order"
END,
"updated_at" = CURRENT_TIMESTAMP
WHERE "activity" IN (
  'running',
  'walking',
  'cycling',
  'hiking',
  'swimming',
  'climbing',
  'rowing',
  'triathlon',
  'soccer',
  'basketball',
  'sports',
  'motorcycle_ride',
  'vehicle_ride',
  'gym',
  'yoga',
  'martial_arts',
  'dance',
  'pilates',
  'calisthenics',
  'other'
);
