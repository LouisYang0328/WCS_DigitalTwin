using System.Text.Json;
using System.Text.Json.Serialization;

namespace WcsGateway.S7.Profiles;

/// <summary>
/// Loads and validates point definitions once at startup. Invalid definitions fail startup
/// rather than allowing a device to appear healthy while silently omitting its signals.
/// </summary>
public sealed class S7ProfileRegistry
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow
    };
    private readonly IReadOnlyDictionary<string, S7ProfileDefinition> _profiles;

    private sealed record ProfileStore
    {
        public required int Version { get; init; }
        public required IReadOnlyList<S7ProfileDefinition> Profiles { get; init; }
    }

    public S7ProfileRegistry(string path)
    {
        try
        {
            var store = JsonSerializer.Deserialize<ProfileStore>(File.ReadAllText(path), JsonOptions)
                ?? throw new JsonException("点位模板配置不能为空。");
            if (store.Version != 1 || store.Profiles is null)
                throw new JsonException("点位模板配置必须使用 version: 1，且包含 profiles 数组。");
            var definitions = new Dictionary<string, S7ProfileDefinition>(StringComparer.OrdinalIgnoreCase)
            {
                ["raw"] = new()
                {
                    Id = "raw",
                    Name = "原始字节 RAW",
                    Description = "只读原始字节，不解析业务信号。",
                    ReadLength = 32,
                    Tags = Array.Empty<S7TagDefinition>()
                }
            };
            foreach (var profile in store.Profiles)
            {
                ValidateDefinition(profile);
                if (!definitions.TryAdd(profile.Id, profile))
                    throw new ArgumentException($"点位模板标识重复或使用了保留标识 raw：{profile.Id}。");
            }
            if (!definitions.ContainsKey("tc"))
                throw new ArgumentException("点位配置必须包含 tc 堆垛机模板。");
            _profiles = definitions;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or JsonException or ArgumentException)
        {
            throw new InvalidOperationException($"无法加载 S7 点位模板 {path}：{ex.Message}", ex);
        }
    }

    public IReadOnlyList<S7ProfileDefinition> List() =>
        _profiles.Values.OrderBy(profile => profile.Id, StringComparer.Ordinal).ToArray();

    public S7ProfileDefinition? Get(string id) =>
        !string.IsNullOrWhiteSpace(id) && _profiles.TryGetValue(id, out var profile) ? profile : null;

    public void ValidateBlock(DbBlockConfig block)
    {
        var profile = Get(block.Decoder)
            ?? throw new ArgumentException($"{block.Name}：找不到解析模板 {block.Decoder}。");
        if (block.Decoder.Equals("raw", StringComparison.OrdinalIgnoreCase))
            return;
        if (block.ReadLength < profile.ReadLength)
            throw new ArgumentException($"{block.Name}：模板 {profile.Id} 至少需要 {profile.ReadLength} 字节，当前为 {block.ReadLength} 字节。");
    }

    public IReadOnlyList<TagValue> Decode(string decoder, byte[] bytes, int startAddress)
    {
        ArgumentNullException.ThrowIfNull(bytes);
        var profile = Get(decoder)
            ?? throw new ArgumentException($"找不到解析模板 {decoder}。");
        if (profile.Id == "raw")
            return Array.Empty<TagValue>();
        if (startAddress < 0 || startAddress > 65535 || bytes.Length > 65536 - startAddress)
            throw new ArgumentException("解码范围超出了 DB 地址范围。");
        if (bytes.Length < profile.ReadLength)
            throw new ArgumentException($"模板 {profile.Id} 至少需要 {profile.ReadLength} 字节，实际只有 {bytes.Length} 字节。");
        return TcTagDecoder.Decode(profile, bytes, startAddress);
    }

    private static void ValidateDefinition(S7ProfileDefinition? profile)
    {
        if (profile is null)
            throw new ArgumentException("点位模板不能为 null。");
        if (string.IsNullOrWhiteSpace(profile.Id) || profile.Id.Length > 64 ||
            profile.Id.Any(c => !(c is >= 'a' and <= 'z' or >= '0' and <= '9' or '-' or '_')))
            throw new ArgumentException("点位模板 id 必须为 1–64 位小写字母、数字、横线或下划线。");
        if (string.IsNullOrWhiteSpace(profile.Name) || profile.Name.Length > 40)
            throw new ArgumentException($"模板 {profile.Id} 的名称不能为空且不得超过 40 个字符。");
        if (profile.DefaultDbNumber is < 1 or > 65535 || profile.DefaultStartAddress is < 0 or > 65535 ||
            profile.ReadLength is < 1 or > 960 || profile.DefaultStartAddress + profile.ReadLength > 65536 ||
            profile.DefaultPollIntervalMs is < 200 or > 60000)
            throw new ArgumentException($"模板 {profile.Id} 的默认 DB、读取范围或轮询周期不合法。");
        if (profile.Tags is null || profile.Tags.Count is < 1 or > 960)
            throw new ArgumentException($"模板 {profile.Id} 必须包含 1–960 个点位。");
        var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var occupiedBytes = new HashSet<int>();
        foreach (var tag in profile.Tags)
        {
            if (tag is null || string.IsNullOrWhiteSpace(tag.Name) || tag.Name.Length > 128 ||
                tag.Name.Any(c => !char.IsAsciiLetterOrDigit(c) && c is not ('_' or '.')) || !names.Add(tag.Name))
                throw new ArgumentException($"模板 {profile.Id} 的点位名称缺失、格式不合法或重复。");
            var size = tag.DataType switch
            {
                "UInt16" => 2,
                "UInt32" => 4,
                "String" when tag.Length is >= 1 and <= 254 => tag.Length.Value + 2,
                "String" => throw new ArgumentException($"模板 {profile.Id}/{tag.Name} 的 String length 必须为 1–254。"),
                _ => throw new ArgumentException($"模板 {profile.Id}/{tag.Name} 仅支持 UInt16、UInt32 或 String；未知类型 {tag.DataType}。")
            };
            if (tag.DataType != "String" && tag.Length is not null)
                throw new ArgumentException($"模板 {profile.Id}/{tag.Name} 只有 String 点位可配置 length。");
            if (tag.Offset < 0 || tag.Offset > profile.ReadLength - size)
                throw new ArgumentException($"模板 {profile.Id}/{tag.Name} 的偏移超出模板读取范围。");
            for (var offset = tag.Offset; offset < tag.Offset + size; offset++)
                if (!occupiedBytes.Add(offset))
                    throw new ArgumentException($"模板 {profile.Id}/{tag.Name} 的地址与其他点位重叠。");
        }
    }
}
