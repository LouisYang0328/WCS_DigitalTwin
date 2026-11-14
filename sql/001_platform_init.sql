-- WCS 数字孪生平台基础库：权限、会话与看板配置
-- 执行示例：mysql -h <host> -P <port> -u <user> -p < sql/001_platform_init.sql
-- 首次启动由后端安全创建 sa 账号（PBKDF2 哈希），本脚本不保存任何明文密码。

CREATE DATABASE IF NOT EXISTS `wcs_digital_twin`
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;
USE `wcs_digital_twin`;

CREATE TABLE IF NOT EXISTS schema_migrations (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  applied_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS roles (
  id VARCHAR(32) NOT NULL PRIMARY KEY,
  label VARCHAR(40) NOT NULL,
  permissions LONGTEXT NOT NULL,
  created_at DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS users (
  id CHAR(36) NOT NULL PRIMARY KEY,
  username VARCHAR(32) NOT NULL UNIQUE,
  display_name VARCHAR(40) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(32) NOT NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  last_login_at DATETIME(6) NULL,
  created_at DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL,
  CONSTRAINT fk_users_role FOREIGN KEY (role) REFERENCES roles(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS auth_sessions (
  id CHAR(36) NOT NULL PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at DATETIME(6) NOT NULL,
  created_at DATETIME(6) NOT NULL,
  last_seen_at DATETIME(6) NULL,
  revoked_at DATETIME(6) NULL,
  INDEX ix_auth_sessions_user (user_id),
  INDEX ix_auth_sessions_expiry (expires_at),
  CONSTRAINT fk_auth_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS dashboard_configs (
  id VARCHAR(40) NOT NULL PRIMARY KEY,
  title VARCHAR(60) NOT NULL,
  refresh_seconds INT NOT NULL,
  task_target INT NOT NULL,
  task_rate_target DECIMAL(5,1) NOT NULL,
  cell_target DECIMAL(5,1) NOT NULL,
  panels_json LONGTEXT NOT NULL,
  updated_by VARCHAR(32) NOT NULL,
  updated_at DATETIME(6) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  actor VARCHAR(32) NOT NULL,
  action VARCHAR(60) NOT NULL,
  target VARCHAR(80) NOT NULL DEFAULT '',
  detail LONGTEXT NULL,
  created_at DATETIME(6) NOT NULL,
  INDEX ix_audit_logs_time (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO roles (id, label, permissions, created_at, updated_at) VALUES
('super_admin', '超级管理员', '["view:twin","view:dashboard","manage:connections","manage:dashboard","manage:users"]', UTC_TIMESTAMP(6), UTC_TIMESTAMP(6)),
('engineer', '运维工程师', '["view:twin","view:dashboard","manage:connections","manage:dashboard"]', UTC_TIMESTAMP(6), UTC_TIMESTAMP(6)),
('viewer', '客户视图', '["view:twin","view:dashboard"]', UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))
ON DUPLICATE KEY UPDATE label = VALUES(label), permissions = VALUES(permissions), updated_at = VALUES(updated_at);

INSERT INTO dashboard_configs
(id, title, refresh_seconds, task_target, task_rate_target, cell_target, panels_json, updated_by, updated_at)
VALUES
('default', 'WCS 数字孪生 · 任务库位报警', 2, 1600, 98.0, 85.0,
 '[{"id":"task-overview","label":"任务总览","visible":true,"order":1},{"id":"task-trend","label":"任务趋势","visible":true,"order":2},{"id":"task-type","label":"任务类型占比","visible":true,"order":3},{"id":"cell-heatmap","label":"库位占用矩阵","visible":true,"order":4},{"id":"alarm-list","label":"实时告警","visible":true,"order":5},{"id":"device-state","label":"设备运行状态","visible":true,"order":6},{"id":"cell-data","label":"库位数据","visible":true,"order":7},{"id":"alarm-data","label":"报警数据","visible":true,"order":8},{"id":"alarm-reasons","label":"报警成因 TOP5","visible":true,"order":9}]',
 'system', UTC_TIMESTAMP(6))
ON DUPLICATE KEY UPDATE id = id;

INSERT IGNORE INTO schema_migrations (id, applied_at) VALUES ('001_platform_init', UTC_TIMESTAMP(6));
