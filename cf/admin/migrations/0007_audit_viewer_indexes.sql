DROP INDEX `audit_log_created_at_idx`;--> statement-breakpoint
CREATE INDEX `audit_log_created_at_id_idx` ON `audit_log` (`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `audit_log_action_created_idx` ON `audit_log` (`action`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `audit_log_resource_type_created_idx` ON `audit_log` (`resource_type`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `audit_log_actor_email_created_idx` ON `audit_log` (`actor_email`,`created_at`,`id`);