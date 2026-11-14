using System.Text.Json;

namespace WcsGateway.S7.Simulation;

public sealed record SimulatorStartRequest(int? Port = null);
public sealed record SimulatorModeRequest(string? Mode);
public sealed record SimulatorConnectAllRequest(string? Mode = null, string[]? Codes = null);
public sealed record SimulatorValuesRequest(Dictionary<string, JsonElement>? Values);

public sealed record SimulatorTag(string Name, string Address, string DataType, string Description, object Value, int? Length = null);
public sealed record SimulatorConveyor(string Id, string SourceId, string StateTag, string HasGoodsTag, string TrayCodeTag, bool Mapped);

public sealed record S7SimulatorSnapshot
{
    public required string EquipmentCode { get; init; }
    public required string DeviceName { get; init; }
    public string Kind { get; init; } = "crane";
    public int? Floor { get; init; }
    public string? ProfileId { get; init; }
    public IReadOnlyList<string> ProfileIds { get; init; } = Array.Empty<string>();
    public string? EnumDescription { get; init; }
    public IReadOnlyList<SimulatorConveyor> Conveyors { get; init; } = Array.Empty<SimulatorConveyor>();
    public required bool Running { get; init; }
    public string IpAddress => "127.0.0.1";
    public required int Port { get; init; }
    public required int DbNumber { get; init; }
    public required int StartAddress { get; init; }
    public required int ReadLength { get; init; }
    public int Rack => 0;
    public int Slot => 0;
    public required string Mode { get; init; }
    public required int ClientCount { get; init; }
    public required long ReadCount { get; init; }
    public DateTimeOffset? LastReadAt { get; init; }
    public string? LastError { get; init; }
    public required IReadOnlyList<SimulatorTag> Tags { get; init; }
    public required IReadOnlyDictionary<string, object> Values { get; init; }
}

public sealed record SimulatorConnectedDevice(string EquipmentCode, string DeviceId, S7SimulatorSnapshot Simulator);
public sealed record SimulatorConnectionFailure(string EquipmentCode, string Detail);
public sealed record SimulatorFleetConnectResult(
    IReadOnlyList<SimulatorConnectedDevice> Devices, IReadOnlyList<SimulatorConnectionFailure> Failures);
