using System.Text.Json;
using MySqlConnector;
using WcsGateway.Security;

namespace WcsGateway.Data;

public sealed class PlatformDatabase
{
    private readonly MySqlOptions _options;
    private readonly SecurityOptions _security;
    private readonly ILogger<PlatformDatabase> _logger;
    private MySqlDataSource? _source;
    private readonly SemaphoreSlim _gate = new(1, 1);

    public bool IsReady { get; private set; }
    public string? LastError { get; private set; }

    public PlatformDatabase(MySqlOptions options, SecurityOptions security, ILogger<PlatformDatabase> logger)
    {
        _options = options;
        _security = security;
        _logger = logger;
    }

    public async Task<MySqlConnection> OpenAsync(CancellationToken cancellationToken = default)
    {
        if (!IsReady || _source is null) throw new InvalidOperationException("MySQL 尚未初始化完成，请稍后重试。");
        var connection = _source.CreateConnection();
        await connection.OpenAsync(cancellationToken);
        return connection;
    }

    public async Task<string> CheckAsync(CancellationToken cancellationToken = default)
    {
        if (!IsReady) return "unavailable";
        await using var connection = await OpenAsync(cancellationToken);
        await using var command = new MySqlCommand("SELECT 1", connection);
        await command.ExecuteScalarAsync(cancellationToken);
        return "ready";
    }

    public async Task InitializeAsync(CancellationToken cancellationToken)
    {
        await _gate.WaitAsync(cancellationToken);
        try
        {
            _options.Validate();
            var master = _options.BuildConnectionString(includeDatabase: false);
            await using (var connection = new MySqlConnection(master))
            {
                await connection.OpenAsync(cancellationToken);
                await using var create = new MySqlCommand(
                    $"CREATE DATABASE IF NOT EXISTS `{_options.Database}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci", connection);
                await create.ExecuteNonQueryAsync(cancellationToken);
            }

            _source?.Dispose();
            _source = new MySqlDataSource(_options.BuildConnectionString(includeDatabase: true));
            await using var db = _source.CreateConnection();
            await db.OpenAsync(cancellationToken);
            foreach (var sql in SchemaStatements)
            {
                await using var command = new MySqlCommand(sql, db);
                await command.ExecuteNonQueryAsync(cancellationToken);
            }
            await SeedAsync(db, cancellationToken);
            IsReady = true;
            LastError = null;
            _logger.LogInformation("MySQL platform database ready: {Host}:{Port}/{Database}", _options.Host, _options.Port, _options.Database);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            IsReady = false;
            LastError = ex.Message;
            _logger.LogError(ex, "MySQL platform initialization failed");
            throw;
        }
        finally { _gate.Release(); }
    }

    private async Task SeedAsync(MySqlConnection db, CancellationToken cancellationToken)
    {
        var roles = new[]
        {
            (PlatformRoles.SuperAdmin, "超级管理员", new[] { "view:twin", "view:dashboard", "manage:connections", "manage:dashboard", "manage:users" }),
            (PlatformRoles.Engineer, "运维工程师", new[] { "view:twin", "view:dashboard", "manage:connections", "manage:dashboard" }),
            (PlatformRoles.Viewer, "客户视图", new[] { "view:twin", "view:dashboard" })
        };
        foreach (var (id, label, permissions) in roles)
        {
            await using var command = new MySqlCommand("""
                INSERT INTO roles (id, label, permissions, created_at, updated_at)
                VALUES (@id, @label, @permissions, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))
                ON DUPLICATE KEY UPDATE label = VALUES(label), permissions = VALUES(permissions), updated_at = UTC_TIMESTAMP(6)
                """, db);
            command.Parameters.AddWithValue("@id", id);
            command.Parameters.AddWithValue("@label", label);
            command.Parameters.AddWithValue("@permissions", JsonSerializer.Serialize(permissions));
            await command.ExecuteNonQueryAsync(cancellationToken);
        }

        var password = string.IsNullOrWhiteSpace(_security.BootstrapAdminPassword) ? "0000" : _security.BootstrapAdminPassword;
        await using (var command = new MySqlCommand("""
            INSERT IGNORE INTO users (id, username, display_name, password_hash, role, enabled, created_at, updated_at)
            VALUES (@id, 'sa', '超级管理员', @password, 'super_admin', 1, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))
            """, db))
        {
            command.Parameters.AddWithValue("@id", Guid.NewGuid().ToString("D"));
            command.Parameters.AddWithValue("@password", PasswordHasher.Hash(password));
            await command.ExecuteNonQueryAsync(cancellationToken);
        }

        await using var dashboard = new MySqlCommand("""
            INSERT IGNORE INTO dashboard_configs
            (id, title, refresh_seconds, task_target, task_rate_target, cell_target, panels_json, updated_by, updated_at)
            VALUES ('default', 'WCS 数字孪生 · 任务库位报警', 2, 1600, 98.0, 85.0, @panels, 'system', UTC_TIMESTAMP(6))
            """, db);
        dashboard.Parameters.AddWithValue("@panels", DashboardDefaults.PanelsJson);
        await dashboard.ExecuteNonQueryAsync(cancellationToken);
    }

    private static readonly string[] SchemaStatements =
    [
        """
        CREATE TABLE IF NOT EXISTS schema_migrations (
          id VARCHAR(64) NOT NULL PRIMARY KEY,
          applied_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        """,
        """
        CREATE TABLE IF NOT EXISTS roles (
          id VARCHAR(32) NOT NULL PRIMARY KEY,
          label VARCHAR(40) NOT NULL,
          permissions LONGTEXT NOT NULL,
          created_at DATETIME(6) NOT NULL,
          updated_at DATETIME(6) NOT NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        """,
        """
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
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        """,
        """
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
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        """,
        """
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
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        """,
        """
        CREATE TABLE IF NOT EXISTS audit_logs (
          id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
          actor VARCHAR(32) NOT NULL,
          action VARCHAR(60) NOT NULL,
          target VARCHAR(80) NOT NULL DEFAULT '',
          detail LONGTEXT NULL,
          created_at DATETIME(6) NOT NULL,
          INDEX ix_audit_logs_time (created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        """,
        "INSERT IGNORE INTO schema_migrations (id, applied_at) VALUES ('001_platform_init', UTC_TIMESTAMP(6))"
    ];
}

public static class DashboardDefaults
{
    public static readonly (string Id, string Label, int Order)[] Panels =
    [
        ("task-overview", "任务总览", 1),
        ("task-trend", "任务趋势", 2),
        ("task-type", "任务类型占比", 3),
        ("cell-heatmap", "库位占用矩阵", 4),
        ("alarm-list", "实时告警", 5),
        ("device-state", "设备运行状态", 6),
        ("cell-data", "库位数据", 7),
        ("alarm-data", "报警数据", 8),
        ("alarm-reasons", "报警成因 TOP5", 9)
    ];

    public static string PanelsJson => JsonSerializer.Serialize(Panels.Select(panel => new
    {
        id = panel.Id, label = panel.Label, visible = true, order = panel.Order
    }));
}

public sealed class PlatformDatabaseInitializer(PlatformDatabase database, ILogger<PlatformDatabaseInitializer> logger)
    : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested && !database.IsReady)
        {
            try { await database.InitializeAsync(stoppingToken); }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
            catch
            {
                try { await Task.Delay(TimeSpan.FromSeconds(10), stoppingToken); }
                catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
            }
        }
        if (!database.IsReady) logger.LogWarning("Gateway started without an initialized MySQL platform database.");
    }
}
