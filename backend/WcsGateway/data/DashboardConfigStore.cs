using System.Text.Json;
using MySqlConnector;
using WcsGateway.Security;

namespace WcsGateway.Data;

public sealed class DashboardConfigStore(PlatformDatabase database)
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public async Task<DashboardConfigResponse> GetAsync(CancellationToken cancellationToken = default)
    {
        await using var connection = await database.OpenAsync(cancellationToken);
        await using var command = new MySqlCommand("""
            SELECT id, title, refresh_seconds, task_target, task_rate_target, cell_target, panels_json, updated_by, updated_at
            FROM dashboard_configs WHERE id = 'default' LIMIT 1
            """, connection);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken)) throw new InvalidOperationException("看板默认配置不存在，请重新执行数据库初始化。");
        var panels = JsonSerializer.Deserialize<DashboardPanelRequest[]>(reader.GetString("panels_json"), JsonOptions)
            ?? throw new InvalidOperationException("看板面板配置格式无效。");
        return new DashboardConfigResponse(
            reader.GetString("id"), reader.GetString("title"), reader.GetInt32("refresh_seconds"),
            reader.GetInt32("task_target"), reader.GetDecimal("task_rate_target"), reader.GetDecimal("cell_target"),
            panels, ToUtc(reader.GetDateTime(reader.GetOrdinal("updated_at"))), reader.GetString("updated_by"));
    }

    public async Task<DashboardConfigResponse> SaveAsync(DashboardConfigRequest request, string username,
        CancellationToken cancellationToken = default)
    {
        var normalized = Validate(request);
        await using var connection = await database.OpenAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        await using var command = new MySqlCommand("""
            UPDATE dashboard_configs
            SET title = @title, refresh_seconds = @refresh, task_target = @taskTarget,
                task_rate_target = @taskRate, cell_target = @cellTarget, panels_json = @panels,
                updated_by = @updatedBy, updated_at = @now
            WHERE id = 'default'
            """, connection, (MySqlTransaction)transaction);
        command.Parameters.AddWithValue("@title", normalized.Title);
        command.Parameters.AddWithValue("@refresh", normalized.RefreshSeconds);
        command.Parameters.AddWithValue("@taskTarget", normalized.TaskTarget);
        command.Parameters.AddWithValue("@taskRate", normalized.TaskRateTarget);
        command.Parameters.AddWithValue("@cellTarget", normalized.CellTarget);
        command.Parameters.AddWithValue("@panels", JsonSerializer.Serialize(normalized.Panels, JsonOptions));
        command.Parameters.AddWithValue("@updatedBy", username);
        command.Parameters.AddWithValue("@now", DateTime.UtcNow);
        if (await command.ExecuteNonQueryAsync(cancellationToken) != 1)
            throw new InvalidOperationException("看板默认配置不存在，请重新执行数据库初始化。");

        await using var audit = new MySqlCommand("""
            INSERT INTO audit_logs (actor, action, target, detail, created_at)
            VALUES (@actor, 'dashboard.config.save', 'default', @detail, @now)
            """, connection, (MySqlTransaction)transaction);
        audit.Parameters.AddWithValue("@actor", username);
        audit.Parameters.AddWithValue("@detail", $"refresh={normalized.RefreshSeconds}s;visible={normalized.Panels.Count(panel => panel.Visible)}");
        audit.Parameters.AddWithValue("@now", DateTime.UtcNow);
        await audit.ExecuteNonQueryAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return await GetAsync(cancellationToken);
    }

    private static DashboardConfigRequest Validate(DashboardConfigRequest request)
    {
        var title = request.Title?.Trim() ?? "";
        if (title.Length is < 2 or > 60) throw new ArgumentException("看板标题需为 2–60 个字符。");
        if (request.RefreshSeconds is < 1 or > 300) throw new ArgumentException("刷新周期范围为 1–300 秒。");
        if (request.TaskTarget is < 1 or > 10_000_000) throw new ArgumentException("今日任务目标范围为 1–10000000。");
        if (request.TaskRateTarget is < 0 or > 100 || request.CellTarget is < 0 or > 100)
            throw new ArgumentException("完成率与库位目标范围为 0–100%。");
        if (request.Panels is null || request.Panels.Count != DashboardDefaults.Panels.Length)
            throw new ArgumentException("看板面板配置不完整。");

        var expected = DashboardDefaults.Panels.Select(panel => panel.Id).ToHashSet(StringComparer.Ordinal);
        var seen = new HashSet<string>(StringComparer.Ordinal);
        var panels = new List<DashboardPanelRequest>(request.Panels.Count);
        foreach (var panel in request.Panels)
        {
            var id = panel.Id?.Trim() ?? "";
            var label = panel.Label?.Trim() ?? "";
            if (!expected.Contains(id) || !seen.Add(id)) throw new ArgumentException("看板面板标识缺失、未知或重复。");
            if (label.Length is < 1 or > 40) throw new ArgumentException($"面板 {id} 的名称需为 1–40 个字符。");
            if (panel.Order is < 1 or > 9) throw new ArgumentException("面板顺序需为 1–9。");
            panels.Add(new DashboardPanelRequest(id, label, panel.Visible, panel.Order));
        }
        if (panels.Select(panel => panel.Order).Distinct().Count() != panels.Count)
            throw new ArgumentException("面板顺序不能重复。");
        if (!panels.Any(panel => panel.Visible)) throw new ArgumentException("至少保留一个可见面板。");
        return new DashboardConfigRequest(title, request.RefreshSeconds, request.TaskTarget,
            Math.Round(request.TaskRateTarget, 1), Math.Round(request.CellTarget, 1),
            panels.OrderBy(panel => panel.Order).ToArray());
    }

    private static DateTimeOffset ToUtc(DateTime value) => new(DateTime.SpecifyKind(value, DateTimeKind.Utc));
}
