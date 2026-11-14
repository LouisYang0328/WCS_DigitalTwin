namespace WcsGateway.S7.Profiles;

/// <summary>A read-only S7 tag. Offset is relative to the configured block start, in bytes.</summary>
public sealed record S7TagDefinition
{
    public required string Name { get; init; }
    public required int Offset { get; init; }
    public required string DataType { get; init; }
    /// <summary>Character capacity for S7 STRING; its two header bytes are additional.</summary>
    public int? Length { get; init; }
    public string Description { get; init; } = "";
}

/// <summary>Reusable point definitions and the default read block for a device family.</summary>
public sealed record S7ProfileDefinition
{
    public required string Id { get; init; }
    public required string Name { get; init; }
    public string Description { get; init; } = "";
    public int DefaultDbNumber { get; init; } = 2000;
    public int DefaultStartAddress { get; init; }
    public int ReadLength { get; init; } = 70;
    public int DefaultPollIntervalMs { get; init; } = 500;
    public required IReadOnlyList<S7TagDefinition> Tags { get; init; }
}
