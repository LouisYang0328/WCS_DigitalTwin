namespace WcsGateway.S7.Protocols;

/// <summary>A readable data area of a protocol block (S7 DB, Modbus register/coil area).</summary>
public sealed record BlockAreaDefinition
{
    public required string Id { get; init; }
    public required string Name { get; init; }
    /// <summary>Compact label for tabs and tables, e.g. DB / 4x / 3x / 0x / 1x.</summary>
    public required string ShortName { get; init; }
    /// <summary>Bit-level area (Modbus coils/discrete inputs); read length counts packed bytes.</summary>
    public bool BitArea { get; init; }
}

/// <summary>
/// Metadata and validation rules of a supported device protocol. The devices page renders
/// its form from this definition, so adding a protocol here (plus a transport adapter and a
/// factory branch) is enough to expose it end to end.
/// </summary>
public sealed record DeviceProtocolDefinition
{
    public required string Id { get; init; }
    public required string Name { get; init; }
    public string Description { get; init; } = "";
    public required int DefaultPort { get; init; }
    /// <summary>Selectable CPU types; empty when the protocol has no CPU notion.</summary>
    public IReadOnlyList<string> CpuTypes { get; init; } = Array.Empty<string>();
    public bool UsesRackSlot { get; init; }
    public bool UsesUnitId { get; init; }
    public required IReadOnlyList<BlockAreaDefinition> Areas { get; init; }
    public required string DefaultArea { get; init; }
    public int MaxReadLength { get; init; } = 960;
    /// <summary>Shown under the port field to guide the user.</summary>
    public string ConnectionHint { get; init; } = "";
}

public static class DeviceProtocols
{
    public const string S7 = "s7";
    public const string ModbusTcp = "modbus-tcp";

    private static readonly IReadOnlyDictionary<string, DeviceProtocolDefinition> Registry =
        new Dictionary<string, DeviceProtocolDefinition>(StringComparer.OrdinalIgnoreCase)
        {
            [S7] = new()
            {
                Id = S7,
                Name = "Siemens S7",
                Description = "S7comm 协议，读取 DB 数据块；S7-1200/1500 需允许 PUT/GET。",
                DefaultPort = 102,
                CpuTypes = ["S7-1200", "S7-1500", "S7-300", "S7-400", "S7-200"],
                UsesRackSlot = true,
                Areas = [new() { Id = "db", Name = "DB 数据块", ShortName = "DB" }],
                DefaultArea = "db",
                MaxReadLength = 960,
                ConnectionHint = "S7 通常端口 102；S7-1200/1500 为 Rack 0 / Slot 0，S7-300/400 为 Rack 0 / Slot 2。"
            },
            [ModbusTcp] = new()
            {
                Id = ModbusTcp,
                Name = "Modbus TCP",
                Description = "Modbus TCP 主站，只读保持/输入寄存器与线圈/离散输入。",
                DefaultPort = 502,
                UsesUnitId = true,
                Areas =
                [
                    new() { Id = "holding", Name = "保持寄存器 (4x)", ShortName = "4x" },
                    new() { Id = "input", Name = "输入寄存器 (3x)", ShortName = "3x" },
                    new() { Id = "coil", Name = "线圈 (0x)", ShortName = "0x", BitArea = true },
                    new() { Id = "discrete", Name = "离散输入 (1x)", ShortName = "1x", BitArea = true }
                ],
                DefaultArea = "holding",
                MaxReadLength = 250,
                ConnectionHint = "Modbus TCP 通常端口 502；站地址 Unit ID 一般为 1，串口网关场景按从站号填写。"
            }
        };

    public static IReadOnlyList<DeviceProtocolDefinition> All =>
        Registry.Values.OrderBy(item => item.Id == S7 ? 0 : 1).ToArray();

    public static string Normalize(string? id) =>
        string.IsNullOrWhiteSpace(id) ? S7 : id.Trim().ToLowerInvariant();

    public static DeviceProtocolDefinition? Get(string? id) =>
        Registry.TryGetValue(Normalize(id), out var definition) ? definition : null;

    public static DeviceProtocolDefinition Require(string? id) => Get(id)
        ?? throw new ArgumentException($"不支持的协议类型：{id}。当前支持：{string.Join("、", All.Select(item => item.Id))}。");

    public static BlockAreaDefinition RequireArea(DeviceProtocolDefinition protocol, string? areaId)
    {
        var normalized = string.IsNullOrWhiteSpace(areaId) ? protocol.DefaultArea : areaId.Trim().ToLowerInvariant();
        return protocol.Areas.FirstOrDefault(area => area.Id == normalized)
            ?? throw new ArgumentException($"协议 {protocol.Name} 不支持数据区 {areaId}，可选：{string.Join("、", protocol.Areas.Select(area => area.Name))}。");
    }
}
