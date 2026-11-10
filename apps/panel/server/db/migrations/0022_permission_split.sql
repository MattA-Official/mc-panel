-- 1.4.0 split three broad permissions into finer ones (#126). Custom roles get every key the
-- old one stood for, so nobody can do more or less than before. Built-in roles live in code.
UPDATE `roles` SET `permissions` = (
	SELECT json_group_array(`value`) FROM (
		SELECT `value` FROM json_each(`roles`.`permissions`)
			WHERE `value` NOT IN ('server.configure', 'system.manage')
		UNION
		SELECT `n`.`value` FROM json_each(`roles`.`permissions`) AS `o`,
			json_each('["spec.edit","settings.edit","content.manage","schedules.manage","community.manage","backups.schedule"]') AS `n`
			WHERE `o`.`value` = 'server.configure'
		UNION
		SELECT `n`.`value` FROM json_each(`roles`.`permissions`) AS `o`,
			json_each('["system.updates","system.notifications","system.integrations","system.branding","system.ssh"]') AS `n`
			WHERE `o`.`value` = 'system.manage'
		UNION
		SELECT `n`.`value` FROM json_each(`roles`.`permissions`) AS `o`,
			json_each('["people.invite","roles.manage"]') AS `n`
			WHERE `o`.`value` = 'people.manage'
	)
)
WHERE `built_in` = 0 AND EXISTS (
	SELECT 1 FROM json_each(`roles`.`permissions`)
		WHERE `value` IN ('server.configure', 'system.manage', 'people.manage')
);
--> statement-breakpoint
INSERT INTO `audit` (`user_id`, `action`, `target`, `detail`)
	SELECT NULL, 'people.permissions_split', NULL, json_object('roles', count(*))
	FROM `roles` WHERE `built_in` = 0
	HAVING count(*) > 0;
