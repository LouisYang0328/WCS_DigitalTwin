using System.Text.Json;
using WcsGateway.S7.Profiles;

namespace WcsGateway.S7.Simulation;

/// <summary>
/// Independent crane and conveyor PLCs. Lifecycle changes are serialized across
/// the fleet so neither an API race nor a custom port can cross-wire devices.
/// </summary>
public sealed class S7SimulatorFleet : IHostedService
{
    private readonly IReadOnlyDictionary<string, S7SimulatorService> _simulators;
    private readonly SemaphoreSlim _mutations = new(1, 1);
    private readonly ILogger<S7SimulatorFleet> _logger;

    public S7SimulatorFleet(S7ProfileRegistry profiles, ILoggerFactory loggerFactory)
    {
        _logger = loggerFactory.CreateLogger<S7SimulatorFleet>();
        _simulators = Enumerable.Range(1, 5).Select(index =>
            new S7SimulatorService(profiles, loggerFactory.CreateLogger<S7SimulatorService>(),
                $"TC{index:00}", index, 1101 + index))
            .Concat(Enumerable.Range(1, 2).Select(floor =>
                new S7SimulatorService(profiles, loggerFactory.CreateLogger<S7SimulatorService>(),
                    $"CV{floor:00}", floor, 1106 + floor)))
            .ToDictionary(simulator => simulator.EquipmentCode, StringComparer.OrdinalIgnoreCase);
    }

    // All instances deliberately remain stopped until a user starts/connects them.
    public Task StartAsync(CancellationToken cancellationToken) => Task.CompletedTask;

    public async Task StopAsync(CancellationToken cancellationToken)
    {
        await _mutations.WaitAsync(cancellationToken);
        try { await Task.WhenAll(_simulators.Values.Select(simulator => simulator.StopServerAsync())); }
        finally { _mutations.Release(); }
    }

    public bool Contains(string code) => _simulators.ContainsKey(code);
    private S7SimulatorService Get(string code) => _simulators.TryGetValue(code, out var simulator)
        ? simulator : throw new ArgumentException("模拟设备不存在，请选择 TC01–TC05、CV01 或 CV02。");

    public IReadOnlyList<S7SimulatorSnapshot> List() => _simulators.Values
        .OrderBy(simulator => simulator.EquipmentCode.StartsWith("TC", StringComparison.Ordinal) ? 0 : 1)
        .ThenBy(simulator => simulator.EquipmentCode, StringComparer.Ordinal)
        .Select(simulator => simulator.Snapshot()).ToArray();

    public S7SimulatorSnapshot Snapshot(string code) => Get(code).Snapshot();
    public S7SimulatorSnapshot SetValues(string code, Dictionary<string, JsonElement>? values) => Get(code).SetValues(values);
    public S7SimulatorSnapshot SetMode(string code, string? mode) => Get(code).SetMode(mode);
    public S7SimulatorSnapshot Reset(string code) => Get(code).Reset();

    public async Task<S7SimulatorSnapshot> StartServerAsync(string code, int? requestedPort = null)
    {
        await _mutations.WaitAsync();
        try
        {
            var simulator = Get(code);
            ValidatePortOwner(simulator, requestedPort ?? simulator.Snapshot().Port);
            return await simulator.StartServerAsync(requestedPort);
        }
        finally { _mutations.Release(); }
    }

    public async Task<S7SimulatorSnapshot> StopServerAsync(string code)
    {
        await _mutations.WaitAsync();
        try { return await Get(code).StopServerAsync(); }
        finally { _mutations.Release(); }
    }

    public async Task<SimulatorConnectedDevice> ConnectGatewayAsync(string code, S7ConnectionManager manager)
    {
        await _mutations.WaitAsync();
        try { return await ConnectGatewayCoreAsync(Get(code), manager); }
        finally { _mutations.Release(); }
    }

    private async Task<SimulatorConnectedDevice> ConnectGatewayCoreAsync(
        S7SimulatorService simulator, S7ConnectionManager manager)
    {
        ValidatePortOwner(simulator, simulator.Snapshot().Port);
        var deviceId = await simulator.ConnectGatewayAsync(manager);
        return new SimulatorConnectedDevice(simulator.EquipmentCode, deviceId, simulator.Snapshot());
    }

    public async Task<SimulatorFleetConnectResult> ConnectAllAsync(S7ConnectionManager manager, string? mode,
        IReadOnlyCollection<string>? codes = null)
    {
        if (mode is not (null or "manual" or "auto"))
            throw new ArgumentException("模拟模式必须为 manual（手动）或 auto（自动演示）。");
        HashSet<string>? selectedCodes = null;
        if (codes is not null)
        {
            if (codes.Count == 0 || codes.Any(code => string.IsNullOrWhiteSpace(code) || !Contains(code)))
                throw new ArgumentException("codes 必须包含至少一个有效模拟设备编号：TC01–TC05、CV01 或 CV02。");
            selectedCodes = new HashSet<string>(codes, StringComparer.OrdinalIgnoreCase);
        }
        await _mutations.WaitAsync();
        try
        {
            var devices = new List<SimulatorConnectedDevice>();
            var failures = new List<SimulatorConnectionFailure>();
            foreach (var simulator in _simulators.Values
                .Where(item => selectedCodes is null || selectedCodes.Contains(item.EquipmentCode))
                .OrderBy(item => item.EquipmentCode.StartsWith("TC", StringComparison.Ordinal) ? 0 : 1)
                .ThenBy(item => item.EquipmentCode, StringComparer.Ordinal))
            {
                try
                {
                    var connected = await ConnectGatewayCoreAsync(simulator, manager);
                    if (mode is not null)
                        connected = connected with { Simulator = simulator.SetMode(mode) };
                    devices.Add(connected);
                }
                catch (Exception ex) when (ex is ArgumentException or IOException or UnauthorizedAccessException or InvalidOperationException)
                {
                    _logger.LogWarning(ex, "Unable to connect local simulator {EquipmentCode}", simulator.EquipmentCode);
                    failures.Add(new SimulatorConnectionFailure(simulator.EquipmentCode, ex.Message));
                }
            }
            return new SimulatorFleetConnectResult(devices, failures);
        }
        finally { _mutations.Release(); }
    }

    private void ValidatePortOwner(S7SimulatorService simulator, int port)
    {
        if (port is < 1 or > 65535)
            throw new ArgumentException("模拟 PLC 端口范围为 1–65535。");
        foreach (var other in _simulators.Values.Where(other => other != simulator))
        {
            if (port == other.DefaultPort)
                throw new ArgumentException($"端口 {port} 为 {other.EquipmentCode} 的默认端口，{simulator.EquipmentCode} 请使用 {simulator.DefaultPort} 或其他空闲端口。");
            if (port == other.Snapshot().Port)
                throw new ArgumentException($"端口 {port} 已分配给 {other.EquipmentCode}，请为 {simulator.EquipmentCode} 选择独立端口。");
        }
    }
}
