using System.Net;
using S7.Net;
using WcsGateway.S7.Profiles;
using WcsGateway.S7.Protocols;

namespace WcsGateway.S7;

public sealed record DbBlockRequest
{
    public string? Id { get; init; }
    public string? Name { get; init; }
    public int DbNumber { get; init; } = 2000;
    /// <summary>Protocol data area: db for S7; holding/input/coil/discrete for Modbus.</summary>
    public string? Area { get; init; }
    public int StartAddress { get; init; }
    public int ReadLength { get; init; } = 70;
    public int PollIntervalMs { get; init; } = 500;
    public string Decoder { get; init; } = "tc";
    public bool Enabled { get; init; } = true;
}

public sealed record ConnectionRequest
{
    /// <summary>Protocol id, e.g. s7 / modbus-tcp; null or empty means S7 (legacy clients).</summary>
    public string? Protocol { get; init; }
    public string? ProfileId { get; init; }
    public string? Name { get; init; }
    public string? IpAddress { get; init; }
    public int Port { get; init; } = 102;
    public short Rack { get; init; }
    public short Slot { get; init; }
    public string CpuType { get; init; } = "S7-1200";
    /// <summary>Modbus unit identifier (station address); ignored by S7.</summary>
    public int UnitId { get; init; } = 1;
    public IReadOnlyList<DbBlockRequest> Blocks { get; init; } = Array.Empty<DbBlockRequest>();
}

public sealed record DbBlockConfig
{
    public required string Id { get; init; }
    public required string Name { get; init; }
    public required int DbNumber { get; init; }
    /// <summary>Data area id; stored v2 files without it default to db (S7).</summary>
    public string Area { get; init; } = "db";
    public required int StartAddress { get; init; }
    public required int ReadLength { get; init; }
    public required int PollIntervalMs { get; init; }
    public required string Decoder { get; init; }
    public bool Enabled { get; init; } = true;
}

public sealed record ConnectionConfig
{
    public required string Id { get; init; }
    /// <summary>Protocol id; stored v2 files without it default to s7.</summary>
    public string Protocol { get; init; } = DeviceProtocols.S7;
    public required string Name { get; init; }
    public required string IpAddress { get; init; }
    public required int Port { get; init; }
    public required short Rack { get; init; }
    public required short Slot { get; init; }
    public required string CpuType { get; init; }
    /// <summary>Modbus station address; 1 for protocols without unit addressing.</summary>
    public int UnitId { get; init; } = 1;
    public required IReadOnlyList<DbBlockConfig> Blocks { get; init; }
    public bool Enabled { get; set; } = true;

    public bool IsS7 => DeviceProtocols.Normalize(Protocol) == DeviceProtocols.S7;

    public CpuType ParseCpuType() => CpuType switch
    {
        "S7-200" => global::S7.Net.CpuType.S7200,
        "S7-300" => global::S7.Net.CpuType.S7300,
        "S7-400" => global::S7.Net.CpuType.S7400,
        "S7-1200" => global::S7.Net.CpuType.S71200,
        "S7-1500" => global::S7.Net.CpuType.S71500,
        _ => throw new ArgumentOutOfRangeException(nameof(CpuType))
    };
}

public sealed record TagValue(
    string Name,
    string Address,
    string DataType,
    object Value,
    string Description,
    int? Length = null,
    int? ByteAddress = null);

public sealed record DbBlockSnapshot
{
    public required string Id { get; init; }
    public required string Name { get; init; }
    public required int DbNumber { get; init; }
    public required string Area { get; init; }
    public required int StartAddress { get; init; }
    public required int ReadLength { get; init; }
    public required int PollIntervalMs { get; init; }
    public required string Decoder { get; init; }
    public required bool Enabled { get; init; }
    public required string State { get; init; }
    public string? LastError { get; init; }
    public DateTimeOffset? LastReadAt { get; init; }
    public long ReadCount { get; init; }
    public int ConsecutiveFailures { get; init; }
    public bool HasData { get; init; }
    public string Quality { get; init; } = "unknown";
    public bool IsStale { get; init; }
    public string? RawBase64 { get; init; }
    public IReadOnlyList<TagValue> Tags { get; init; } = Array.Empty<TagValue>();
}

public sealed record ConnectionSnapshot
{
    public required string Id { get; init; }
    public required string Protocol { get; init; }
    public required string Name { get; init; }
    public required string IpAddress { get; init; }
    public required int Port { get; init; }
    public required short Rack { get; init; }
    public required short Slot { get; init; }
    public required string CpuType { get; init; }
    public required int UnitId { get; init; }
    public required bool Enabled { get; init; }
    public required bool IsSimulation { get; init; }
    public required string State { get; init; }
    public required bool IsConnected { get; init; }
    public string? LastError { get; init; }
    public DateTimeOffset? LastConnectedAt { get; init; }
    public DateTimeOffset? LastReadAt { get; init; }
    public long ReadCount { get; init; }
    public int ConsecutiveFailures { get; init; }
    public required IReadOnlyList<DbBlockSnapshot> Blocks { get; init; }
}

public static class ConnectionRequestValidator
{
    public static ConnectionConfig Validate(ConnectionRequest request, S7ProfileRegistry profiles, string? id = null)
    {
        var protocol = DeviceProtocols.Require(request.Protocol);
        var isS7 = protocol.Id == DeviceProtocols.S7;

        var name = request.Name?.Trim();
        if (string.IsNullOrWhiteSpace(name) || name.Length > 40)
            throw new ArgumentException("设备名称不能为空，且不能超过 40 个字符。");

        if (!IPAddress.TryParse(request.IpAddress?.Trim(), out var address) ||
            address.AddressFamily != System.Net.Sockets.AddressFamily.InterNetwork)
            throw new ArgumentException("请输入有效的 IPv4 地址。");
        if (request.Port is < 1 or > 65535)
            throw new ArgumentException($"端口范围为 1–65535，{protocol.Name} 通常为 {protocol.DefaultPort}。");

        short rack = 0, slot = 0;
        var cpuType = protocol.Name;
        var unitId = 1;
        if (isS7)
        {
            if (request.Rack is < 0 or > 7 || request.Slot is < 0 or > 31)
                throw new ArgumentException("机架范围为 0–7，插槽范围为 0–31。");
            rack = request.Rack;
            slot = request.Slot;
            cpuType = request.CpuType?.Trim() ?? "";
            if (!protocol.CpuTypes.Contains(cpuType))
                throw new ArgumentException("不支持的 CPU 类型。");
        }
        else if (protocol.UsesUnitId)
        {
            if (request.UnitId is < 0 or > 255)
                throw new ArgumentException("Modbus 站地址（Unit ID）范围为 0–255。");
            unitId = request.UnitId;
        }

        var requestedBlocks = request.Blocks ?? Array.Empty<DbBlockRequest>();
        if (!string.IsNullOrWhiteSpace(request.ProfileId))
        {
            var profile = profiles.Get(request.ProfileId.Trim())
                ?? throw new ArgumentException($"找不到点位模板：{request.ProfileId}。");
            if (requestedBlocks.Count == 0)
            {
                requestedBlocks = [new DbBlockRequest
                {
                    Name = profile.Name,
                    DbNumber = isS7 ? profile.DefaultDbNumber : 0,
                    Area = protocol.DefaultArea,
                    StartAddress = profile.DefaultStartAddress,
                    ReadLength = profile.ReadLength,
                    PollIntervalMs = profile.DefaultPollIntervalMs,
                    Decoder = profile.Id
                }];
            }
        }
        if (requestedBlocks.Count is < 1 or > 32)
            throw new ArgumentException("每台设备必须配置 1–32 个数据读取块。");

        if (requestedBlocks.Any(block => block is null))
            throw new ArgumentException("数据读取块不能为 null。");
        var blocks = requestedBlocks.Select(block => ValidateBlock(block, profiles, protocol)).ToArray();
        if (blocks.Select(item => item.Id).Distinct(StringComparer.OrdinalIgnoreCase).Count() != blocks.Length)
            throw new ArgumentException("读取块标识不能重复。");
        if (blocks.Select(item => item.Name).Distinct(StringComparer.OrdinalIgnoreCase).Count() != blocks.Length)
            throw new ArgumentException("同一设备内的读取块名称不能重复。");

        return new ConnectionConfig
        {
            Id = id ?? $"plc-{Guid.NewGuid():N}",
            Protocol = protocol.Id,
            Name = name,
            IpAddress = address.ToString(),
            Port = request.Port,
            Rack = rack,
            Slot = slot,
            CpuType = cpuType,
            UnitId = unitId,
            Blocks = blocks
        };
    }

    private static DbBlockConfig ValidateBlock(DbBlockRequest request, S7ProfileRegistry profiles, DeviceProtocolDefinition protocol)
    {
        var name = request.Name?.Trim();
        if (string.IsNullOrWhiteSpace(name) || name.Length > 40)
            throw new ArgumentException("读取块名称不能为空，且不能超过 40 个字符。");

        var area = DeviceProtocols.RequireArea(protocol, request.Area);
        var dbNumber = request.DbNumber;
        if (protocol.Id == DeviceProtocols.S7)
        {
            if (request.DbNumber is < 1 or > 65535)
                throw new ArgumentException($"{name}：DB 编号范围为 1–65535。");
        }
        else
        {
            // Modbus 无 DB 概念，编号固定为 0，地址完全由数据区 + 起始地址决定。
            dbNumber = 0;
        }
        if (request.StartAddress is < 0 or > 65535)
            throw new ArgumentException($"{name}：起始地址范围为 0–65535。");

        var maxLength = protocol.MaxReadLength;
        if (request.ReadLength < 1 || request.ReadLength > maxLength)
            throw new ArgumentException($"{name}：读取长度为 1–{maxLength} 字节。");
        if (!area.BitArea && protocol.Id != DeviceProtocols.S7)
        {
            // 寄存器区按 16 位寄存器寻址，读取长度必须为偶数字节。
            if (request.ReadLength % 2 != 0)
                throw new ArgumentException($"{name}：{area.Name} 的读取长度必须为偶数字节。");
            if (request.StartAddress + request.ReadLength / 2 > 65536)
                throw new ArgumentException($"{name}：读取范围超出 {area.Name} 的地址空间。");
        }
        else if (area.BitArea)
        {
            if (request.StartAddress + request.ReadLength * 8 > 65536)
                throw new ArgumentException($"{name}：读取范围超出 {area.Name} 的地址空间。");
        }
        else if (request.StartAddress + request.ReadLength > 65536)
        {
            throw new ArgumentException($"{name}：读取范围超出 DB 地址范围。");
        }
        if (request.PollIntervalMs is < 200 or > 60000)
            throw new ArgumentException($"{name}：轮询周期范围为 200–60000 ms。");

        var decoder = request.Decoder?.Trim().ToLowerInvariant();
        if (string.IsNullOrEmpty(decoder) || profiles.Get(decoder) is null)
            throw new ArgumentException($"{name}：找不到解析模板 {decoder}。");
        var blockId = string.IsNullOrWhiteSpace(request.Id) ? $"db-{Guid.NewGuid():N}" : request.Id.Trim();
        if (blockId.Length > 64 || blockId.Any(c => !char.IsLetterOrDigit(c) && c is not ('-' or '_')))
            throw new ArgumentException($"{name}：读取块标识只能包含字母、数字、横线和下划线。");

        var config = new DbBlockConfig
        {
            Id = blockId,
            Name = name,
            DbNumber = dbNumber,
            Area = area.Id,
            StartAddress = request.StartAddress,
            ReadLength = request.ReadLength,
            PollIntervalMs = request.PollIntervalMs,
            Decoder = decoder,
            Enabled = request.Enabled
        };
        profiles.ValidateBlock(config);
        return config;
    }
}
