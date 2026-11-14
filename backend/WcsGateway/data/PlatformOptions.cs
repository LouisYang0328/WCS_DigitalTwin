using MySqlConnector;

namespace WcsGateway.Data;

public sealed class MySqlOptions
{
    public string Host { get; set; } = "127.0.0.1";
    public int Port { get; set; } = 3306;
    public string Database { get; set; } = "wcs_digital_twin";
    public string UserId { get; set; } = "root";
    public string Password { get; set; } = "";
    public int PoolMin { get; set; } = 0;
    public int PoolMax { get; set; } = 20;
    public int ConnectionTimeoutMs { get; set; } = 5000;
    public bool Ssl { get; set; }

    public void Validate()
    {
        if (string.IsNullOrWhiteSpace(Host)) throw new ArgumentException("MySQL Host 不能为空。");
        if (Port is < 1 or > 65535) throw new ArgumentException("MySQL Port 范围为 1–65535。");
        if (string.IsNullOrWhiteSpace(Database) || Database.Length > 64 ||
            Database.Any(c => !char.IsLetterOrDigit(c) && c != '_' ))
            throw new ArgumentException("MySQL Database 只能包含字母、数字和下划线，最多 64 字符。");
        if (string.IsNullOrWhiteSpace(UserId)) throw new ArgumentException("MySQL UserId 不能为空。");
        if (PoolMin < 0 || PoolMax < 1 || PoolMin > PoolMax || PoolMax > 500)
            throw new ArgumentException("MySQL 连接池范围无效：PoolMin 0–PoolMax，PoolMax 1–500。");
        if (ConnectionTimeoutMs is < 1000 or > 120000)
            throw new ArgumentException("MySQL 连接超时范围为 1000–120000 ms。");
    }

    public string BuildConnectionString(bool includeDatabase)
    {
        Validate();
        var builder = new MySqlConnectionStringBuilder
        {
            Server = Host,
            Port = checked((uint)Port),
            Database = includeDatabase ? Database : string.Empty,
            UserID = UserId,
            Password = Password,
            Pooling = true,
            MinimumPoolSize = checked((uint)PoolMin),
            MaximumPoolSize = checked((uint)PoolMax),
            ConnectionTimeout = checked((uint)Math.Ceiling(ConnectionTimeoutMs / 1000d)),
            DefaultCommandTimeout = 30,
            ConnectionLifeTime = 300,
            ConnectionIdleTimeout = 180,
            SslMode = Ssl ? MySqlSslMode.Required : MySqlSslMode.None,
            AllowPublicKeyRetrieval = true,
            CharacterSet = "utf8mb4"
        };
        return builder.ConnectionString;
    }
}

public sealed class SecurityOptions
{
    public string CookieName { get; set; } = "wcs_session";
    public int SessionHours { get; set; } = 12;
    public bool SecureCookie { get; set; }
    public string BootstrapAdminPassword { get; set; } = "0000";
}

public static class PlatformRoles
{
    public const string SuperAdmin = "super_admin";
    public const string Engineer = "engineer";
    public const string Viewer = "viewer";

    public static readonly string[] All = [SuperAdmin, Engineer, Viewer];
}

public static class PlatformPolicies
{
    public const string Viewer = "PlatformViewer";
    public const string Engineer = "PlatformEngineer";
    public const string SuperAdmin = "PlatformSuperAdmin";
}
