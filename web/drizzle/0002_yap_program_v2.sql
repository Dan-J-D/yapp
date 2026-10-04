-- Yap program v2: levels become Y1 Story retell → Y2 Explain retell → Y3 Conversation → Y4 Chaos.
-- Restart the yap track at Y1 and record why.
UPDATE `levels`
SET `level` = 1,
    `passes` = 0,
    `history` = json_insert(coalesce(`history`, '[]'), '$[#]', json_object('at', CAST(strftime('%s', 'now') AS INTEGER) * 1000, 'level', 1, 'event', 'program v2')),
    `updated_at` = CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE `track` = 'yap';
--> statement-breakpoint
-- Shrinking retell now lives in the daily base: 2 / 1.5 / 1 min instead of 4 / 3 / 2.
UPDATE `settings`
SET `value` = json_set(`value`, '$.retellMinutes', json('[2,1.5,1]'))
WHERE `key` = 'prefs'
  AND json_extract(`value`, '$.retellMinutes[0]') = 4
  AND json_extract(`value`, '$.retellMinutes[1]') = 3
  AND json_extract(`value`, '$.retellMinutes[2]') = 2;
