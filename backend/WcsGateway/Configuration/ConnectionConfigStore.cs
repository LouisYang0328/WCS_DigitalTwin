using System.Text;
using System.Text.Json;
using WcsGateway.S7;
using WcsGateway.S7.Profiles;

namespace WcsGateway.Configuration;

// 本地持久化与连接生命周期分离。无效文件启动失败，避免静默清空后覆盖现场配置。
public sealed class ConnectionConfigStore(string filePath, S7ProfileRegistry profiles)
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web) { WriteIndented = true };
    private sealed record Store(int Version, IReadOnlyList<ConnectionConfig> Devices);

    public IReadOnlyList<ConnectionConfig> Load()
    {
        if (!File.Exists(filePath)) return [];
        var json = File.ReadAllText(filePath);
        using var document = JsonDocument.Parse(json);
        var migrated = document.RootElement.ValueKind == JsonValueKind.Array;
        var configs = migrated ? UpgradeLegacy(document.RootElement) : ReadStore(json);
        var ids = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var endpoints = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var validated = new List<ConnectionConfig>();
        foreach (var config in configs)
        {
            if (config is null || string.IsNullOrWhiteSpace(config.Id) || !ids.Add(config.Id))
                throw new InvalidDataException("PLC 配置含空设备标识或重复设备标识。");
            if (config.Blocks is null || config.Blocks.Any(block => block is null))
                throw new InvalidDataException($"{config.Name}：DB 读取块配置不能为 null。");
            var valid = ConnectionRequestValidator.Validate(new ConnectionRequest
            {
                Protocol = config.Protocol,
                Name = config.Name, IpAddress = config.IpAddress, Port = config.Port,
                Rack = config.Rack, Slot = config.Slot, CpuType = config.CpuType, UnitId = config.UnitId,
                Blocks = config.Blocks.Select(block => new DbBlockRequest
                {
                    Id = block.Id, Name = block.Name, DbNumber = block.DbNumber, Area = block.Area,
                    StartAddress = block.StartAddress,
                    ReadLength = block.ReadLength, PollIntervalMs = block.PollIntervalMs,
                    Decoder = block.Decoder, Enabled = block.Enabled
                }).ToArray()
            }, profiles, config.Id) with { Enabled = config.Enabled };
            if (!endpoints.Add(EndpointKey(valid)))
                throw new InvalidDataException("PLC 配置包含重复的协议/IP/端口/机架/插槽/站地址组合，请在同一设备中配置多个读取块。");
            validated.Add(valid);
        }
        if (migrated) Save(validated);
        return validated;
    }

    private static IReadOnlyList<ConnectionConfig> ReadStore(string json)
    {
        var store = JsonSerializer.Deserialize<Store>(json, JsonOptions);
        if (store is null || store.Version != 2 || store.Devices is null)
            throw new InvalidDataException("PLC 配置版本必须为 2，并包含 devices 数组。");
        return store.Devices;
    }

    private static IReadOnlyList<ConnectionConfig> UpgradeLegacy(JsonElement root) => root.EnumerateArray()
        .Select(item =>
        {
            var legacy = JsonSerializer.Deserialize<LegacyConfig>(item.GetRawText(), JsonOptions)
                ?? throw new InvalidDataException("旧版 PLC 配置为空。");
            return legacy.Upgrade();
        }).ToArray();

    public void Save(IEnumerable<ConnectionConfig> configs)
    {
        var fullPath = Path.GetFullPath(filePath);
        Directory.CreateDirectory(Path.GetDirectoryName(fullPath)!);
        var tempFile = fullPath + ".tmp";
        try
        {
            using (var stream = new FileStream(tempFile, FileMode.Create, FileAccess.Write, FileShare.None))
            {
                var bytes = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new Store(2,
                    configs.OrderBy(item => item.Name, StringComparer.OrdinalIgnoreCase).ToArray()), JsonOptions));
                stream.Write(bytes);
                stream.Flush(flushToDisk: true);
            }
            File.Move(tempFile, fullPath, overwrite: true);
        }
        finally
        {
            if (File.Exists(tempFile)) File.Delete(tempFile);
        }
    }

    public static string EndpointKey(ConnectionConfig config) =>
        $"{S7.Protocols.DeviceProtocols.Normalize(config.Protocol)}|{config.IpAddress}:{config.Port}/{config.Rack}/{config.Slot}/{config.UnitId}";

    private sealed record LegacyConfig
    {
        public string Id { get; init; } = "";
        public string Name { get; init; } = "PLC";
        public string IpAddress { get; init; } = "127.0.0.1";
        public int Port { get; init; } = 102;
        public short Rack { get; init; }
        public short Slot { get; init; }
        public string CpuType { get; init; } = "S7-1200";
        public int DbNumber { get; init; } = 2000;
        public int StartAddress { get; init; }
        public int ReadLength { get; init; } = 70;
        public int PollIntervalMs { get; init; } = 500;
        public bool Enabled { get; init; } = true;

        public ConnectionConfig Upgrade() => new()
        {
            Id = Id, Protocol = S7.Protocols.DeviceProtocols.S7, Name = Name, IpAddress = IpAddress, Port = Port,
            Rack = Rack, Slot = Slot,
            CpuType = CpuType, Enabled = Enabled,
            Blocks = [new DbBlockConfig
            {
                Id = $"db-{Guid.NewGuid():N}", Name = $"DB{DbNumber}", DbNumber = DbNumber, Area = "db",
                StartAddress = StartAddress, ReadLength = ReadLength, PollIntervalMs = PollIntervalMs,
                Decoder = DbNumber == 2000 && StartAddress == 0 ? "tc" : "raw"
            }]
        };
    }
}
