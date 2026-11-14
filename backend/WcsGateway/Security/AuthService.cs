using System.Security.Cryptography;
using System.Text.Json;
using System.Text.RegularExpressions;
using MySqlConnector;
using WcsGateway.Data;

namespace WcsGateway.Security;

public sealed partial class AuthService(PlatformDatabase database, SecurityOptions security)
{
    private static readonly TimeSpan SessionLifetimeGuard = TimeSpan.FromDays(30);

    public async Task<SessionLogin?> LoginAsync(string username, string password, CancellationToken cancellationToken = default)
    {
        username = username.Trim();
        if (username.Length is < 2 or > 32 || string.IsNullOrEmpty(password)) return null;
        await using var connection = await database.OpenAsync(cancellationToken);
        await using var command = new MySqlCommand("""
            SELECT u.id, u.username, u.display_name, u.password_hash, u.role, u.enabled, r.permissions
            FROM users u JOIN roles r ON r.id = u.role
            WHERE u.username = @username LIMIT 1
            """, connection);
        command.Parameters.AddWithValue("@username", username);
        string id, displayName, passwordHash, role;
        bool enabled;
        IReadOnlyList<string> permissions;
        await using (var reader = await command.ExecuteReaderAsync(cancellationToken))
        {
            if (!await reader.ReadAsync(cancellationToken)) return null;
            id = reader.GetGuid("id").ToString("D");
            displayName = reader.GetString("display_name");
            passwordHash = reader.GetString("password_hash");
            role = reader.GetString("role");
            enabled = reader.GetBoolean("enabled");
            permissions = ParsePermissions(reader.GetString("permissions"), role);
        }
        if (!enabled || !PasswordHasher.Verify(password, passwordHash)) return null;

        var token = NewToken();
        var expires = DateTime.UtcNow.AddHours(SessionHours(security));
        await using var insert = new MySqlCommand("""
            INSERT INTO auth_sessions (id, user_id, token_hash, expires_at, created_at)
            VALUES (@id, @userId, @hash, @expires, @now);
            UPDATE users SET last_login_at = @now, updated_at = @now WHERE id = @userId;
            DELETE FROM auth_sessions WHERE expires_at < @now OR (revoked_at IS NOT NULL AND revoked_at < @now - INTERVAL 7 DAY);
            """, connection);
        insert.Parameters.AddWithValue("@id", Guid.NewGuid().ToString("D"));
        insert.Parameters.AddWithValue("@userId", id);
        insert.Parameters.AddWithValue("@hash", PasswordHasher.Sha256Hex(token));
        insert.Parameters.AddWithValue("@expires", expires);
        insert.Parameters.AddWithValue("@now", DateTime.UtcNow);
        await insert.ExecuteNonQueryAsync(cancellationToken);
        return new SessionLogin(new UserResponse(id, username, displayName, role, permissions), token,
            new DateTimeOffset(DateTime.SpecifyKind(expires, DateTimeKind.Utc)));
    }

    public async Task<UserResponse?> FindByTokenAsync(string token, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(token) || token.Length > 128) return null;
        await using var connection = await database.OpenAsync(cancellationToken);
        await using var command = new MySqlCommand("""
            SELECT u.id, u.username, u.display_name, u.role, r.permissions
            FROM auth_sessions s
            JOIN users u ON u.id = s.user_id
            JOIN roles r ON r.id = u.role
            WHERE s.token_hash = @hash AND s.revoked_at IS NULL AND s.expires_at > @now AND u.enabled = 1
            LIMIT 1
            """, connection);
        command.Parameters.AddWithValue("@hash", PasswordHasher.Sha256Hex(token));
        command.Parameters.AddWithValue("@now", DateTime.UtcNow);
        UserResponse? user = null;
        await using (var reader = await command.ExecuteReaderAsync(cancellationToken))
        {
            if (await reader.ReadAsync(cancellationToken))
            {
                var role = reader.GetString("role");
                user = new UserResponse(reader.GetGuid("id").ToString("D"), reader.GetString("username"),
                    reader.GetString("display_name"), role,
                    ParsePermissions(reader.GetString("permissions"), role));
            }
        }
        if (user is null) return null;
        await using var touch = new MySqlCommand("UPDATE auth_sessions SET last_seen_at = @now WHERE token_hash = @hash", connection);
        touch.Parameters.AddWithValue("@now", DateTime.UtcNow);
        touch.Parameters.AddWithValue("@hash", PasswordHasher.Sha256Hex(token));
        await touch.ExecuteNonQueryAsync(cancellationToken);
        return user;
    }

    public async Task LogoutAsync(string token, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(token)) return;
        await using var connection = await database.OpenAsync(cancellationToken);
        await using var command = new MySqlCommand("UPDATE auth_sessions SET revoked_at = @now WHERE token_hash = @hash AND revoked_at IS NULL", connection);
        command.Parameters.AddWithValue("@now", DateTime.UtcNow);
        command.Parameters.AddWithValue("@hash", PasswordHasher.Sha256Hex(token));
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<UserAdminResponse>> ListUsersAsync(CancellationToken cancellationToken = default)
    {
        await using var connection = await database.OpenAsync(cancellationToken);
        await using var command = new MySqlCommand("""
            SELECT id, username, display_name, role, enabled, last_login_at, created_at
            FROM users ORDER BY CASE username WHEN 'sa' THEN 0 ELSE 1 END, created_at
            """, connection);
        var users = new List<UserAdminResponse>();
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            var lastLogin = reader.IsDBNull(reader.GetOrdinal("last_login_at")) ? (DateTimeOffset?)null :
                new DateTimeOffset(DateTime.SpecifyKind(reader.GetDateTime("last_login_at"), DateTimeKind.Utc));
            users.Add(new UserAdminResponse(reader.GetGuid("id").ToString("D"), reader.GetString("username"),
                reader.GetString("display_name"), reader.GetString("role"), reader.GetBoolean("enabled"), lastLogin,
                new DateTimeOffset(DateTime.SpecifyKind(reader.GetDateTime("created_at"), DateTimeKind.Utc))));
        }
        return users;
    }

    public async Task<UserAdminResponse> CreateUserAsync(CreateUserRequest request, string actor,
        CancellationToken cancellationToken = default)
    {
        var username = ValidateUsername(request.Username);
        var displayName = ValidateDisplayName(request.DisplayName);
        ValidatePassword(request.Password);
        var role = request.Role?.Trim() ?? "";
        if (!PlatformRoles.All.Contains(role)) throw new ArgumentException("角色必须是客户视图、运维工程师或超级管理员。");
        await using var connection = await database.OpenAsync(cancellationToken);
        var id = Guid.NewGuid().ToString("D");
        try
        {
            await using var command = new MySqlCommand("""
                INSERT INTO users (id, username, display_name, password_hash, role, enabled, created_at, updated_at)
                VALUES (@id, @username, @displayName, @password, @role, 1, @now, @now)
                """, connection);
            command.Parameters.AddWithValue("@id", id);
            command.Parameters.AddWithValue("@username", username);
            command.Parameters.AddWithValue("@displayName", displayName);
            command.Parameters.AddWithValue("@password", PasswordHasher.Hash(request.Password));
            command.Parameters.AddWithValue("@role", role);
            command.Parameters.AddWithValue("@now", DateTime.UtcNow);
            await command.ExecuteNonQueryAsync(cancellationToken);
        }
        catch (MySqlException ex) when (ex.Number is 1062)
        {
            throw new ArgumentException("用户名已存在。");
        }
        await AuditAsync(connection, actor, "user.create", username, $"role={role}", cancellationToken);
        return new UserAdminResponse(id, username, displayName, role, true, null,
            new DateTimeOffset(DateTime.UtcNow, TimeSpan.Zero));
    }

    public async Task<bool> SetUserEnabledAsync(string id, bool enabled, string actor,
        CancellationToken cancellationToken = default)
    {
        await using var connection = await database.OpenAsync(cancellationToken);
        var target = await GetUserForMutationAsync(connection, id, cancellationToken);
        if (target is null) return false;
        if (!enabled && target.Value.Role == PlatformRoles.SuperAdmin && target.Value.Enabled)
        {
            var activeAdmins = await ScalarIntAsync(connection,
                "SELECT COUNT(*) FROM users WHERE role = 'super_admin' AND enabled = 1", cancellationToken);
            if (activeAdmins <= 1) throw new ArgumentException("至少需要保留一个启用的超级管理员。");
        }
        await using var command = new MySqlCommand("""
            UPDATE users SET enabled = @enabled, updated_at = @now WHERE id = @id;
            UPDATE auth_sessions SET revoked_at = @now WHERE user_id = @id AND revoked_at IS NULL;
            """, connection);
        command.Parameters.AddWithValue("@enabled", enabled);
        command.Parameters.AddWithValue("@now", DateTime.UtcNow);
        command.Parameters.AddWithValue("@id", id);
        await command.ExecuteNonQueryAsync(cancellationToken);
        await AuditAsync(connection, actor, enabled ? "user.enable" : "user.disable", target.Value.Username, null, cancellationToken);
        return true;
    }

    public async Task<bool> DeleteUserAsync(string id, string actor, CancellationToken cancellationToken = default)
    {
        await using var connection = await database.OpenAsync(cancellationToken);
        var target = await GetUserForMutationAsync(connection, id, cancellationToken);
        if (target is null) return false;
        if (target.Value.Username == "sa") throw new ArgumentException("内置超级账号 sa 不能删除。");
        if (target.Value.Role == PlatformRoles.SuperAdmin && target.Value.Enabled)
        {
            var activeAdmins = await ScalarIntAsync(connection,
                "SELECT COUNT(*) FROM users WHERE role = 'super_admin' AND enabled = 1", cancellationToken);
            if (activeAdmins <= 1) throw new ArgumentException("至少需要保留一个启用的超级管理员。");
        }
        await using var command = new MySqlCommand("DELETE FROM users WHERE id = @id", connection);
        command.Parameters.AddWithValue("@id", id);
        await command.ExecuteNonQueryAsync(cancellationToken);
        await AuditAsync(connection, actor, "user.delete", target.Value.Username, null, cancellationToken);
        return true;
    }

    public async Task<bool> ResetPasswordAsync(string id, string password, string actor,
        CancellationToken cancellationToken = default)
    {
        ValidatePassword(password);
        await using var connection = await database.OpenAsync(cancellationToken);
        var target = await GetUserForMutationAsync(connection, id, cancellationToken);
        if (target is null) return false;
        await using var command = new MySqlCommand("""
            UPDATE users SET password_hash = @password, updated_at = @now WHERE id = @id;
            UPDATE auth_sessions SET revoked_at = @now WHERE user_id = @id AND revoked_at IS NULL;
            """, connection);
        command.Parameters.AddWithValue("@password", PasswordHasher.Hash(password));
        command.Parameters.AddWithValue("@now", DateTime.UtcNow);
        command.Parameters.AddWithValue("@id", id);
        await command.ExecuteNonQueryAsync(cancellationToken);
        await AuditAsync(connection, actor, "user.password.reset", target.Value.Username, null, cancellationToken);
        return true;
    }

    private static async Task<(string Username, string Role, bool Enabled)?> GetUserForMutationAsync(
        MySqlConnection connection, string id, CancellationToken cancellationToken)
    {
        await using var command = new MySqlCommand("SELECT username, role, enabled FROM users WHERE id = @id LIMIT 1", connection);
        command.Parameters.AddWithValue("@id", id);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken)) return null;
        return (reader.GetString("username"), reader.GetString("role"), reader.GetBoolean("enabled"));
    }

    private static async Task<int> ScalarIntAsync(MySqlConnection connection, string sql, CancellationToken cancellationToken)
    {
        await using var command = new MySqlCommand(sql, connection);
        return Convert.ToInt32(await command.ExecuteScalarAsync(cancellationToken));
    }

    private static async Task AuditAsync(MySqlConnection connection, string actor, string action, string target,
        string? detail, CancellationToken cancellationToken)
    {
        await using var command = new MySqlCommand("""
            INSERT INTO audit_logs (actor, action, target, detail, created_at)
            VALUES (@actor, @action, @target, @detail, @now)
            """, connection);
        command.Parameters.AddWithValue("@actor", actor);
        command.Parameters.AddWithValue("@action", action);
        command.Parameters.AddWithValue("@target", target);
        command.Parameters.AddWithValue("@detail", detail ?? (object)DBNull.Value);
        command.Parameters.AddWithValue("@now", DateTime.UtcNow);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private static IReadOnlyList<string> ParsePermissions(string json, string role)
    {
        try
        {
            var values = JsonSerializer.Deserialize<string[]>(json) ?? [];
            if (values.Length > 0) return values;
        }
        catch (JsonException) { }
        return role switch
        {
            PlatformRoles.SuperAdmin => ["view:twin", "view:dashboard", "manage:connections", "manage:dashboard", "manage:users"],
            PlatformRoles.Engineer => ["view:twin", "view:dashboard", "manage:connections", "manage:dashboard"],
            _ => ["view:twin", "view:dashboard"]
        };
    }

    private static int SessionHours(SecurityOptions options) =>
        Math.Clamp(options.SessionHours, 1, (int)SessionLifetimeGuard.TotalHours);

    private static string NewToken()
    {
        var bytes = RandomNumberGenerator.GetBytes(32);
        return Convert.ToBase64String(bytes).Replace('+', '-').Replace('/', '_').TrimEnd('=');
    }

    private static string ValidateUsername(string username)
    {
        username = username.Trim();
        if (!UsernamePattern().IsMatch(username))
            throw new ArgumentException("用户名需为 2–32 位字母、数字、点、下划线或横线。");
        return username;
    }

    private static string ValidateDisplayName(string displayName)
    {
        displayName = displayName.Trim();
        if (displayName.Length is < 1 or > 40) throw new ArgumentException("显示名称需为 1–40 个字符。");
        return displayName;
    }

    private static void ValidatePassword(string password)
    {
        if (password.Length is < 4 or > 128) throw new ArgumentException("密码长度需为 4–128 位。");
    }

    [GeneratedRegex("^[A-Za-z0-9._-]{2,32}$")]
    private static partial Regex UsernamePattern();
}
