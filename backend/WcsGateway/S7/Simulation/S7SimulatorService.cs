using System.Buffers.Binary;
using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;
using WcsGateway.S7.Profiles;

namespace WcsGateway.S7.Simulation;

/// <summary>
/// An explicit, loopback-only S7comm peer. The gateway reads this memory through
/// its ordinary S7Net TCP transport, never through an in-process shortcut.
/// </summary>
public sealed class S7SimulatorService : IHostedService
{
    private const int MaxClients = 64;
    private readonly object _sync = new();
    private readonly SemaphoreSlim _lifecycle = new(1, 1);
    private readonly S7ProfileDefinition _profile;
    private readonly IReadOnlyList<S7ProfileDefinition> _connectionProfiles;
    private readonly IReadOnlyList<SimulatorConveyor> _conveyors;
    private readonly IReadOnlyDictionary<string, S7TagDefinition> _definitions;
    private readonly ILogger<S7SimulatorService> _logger;
    private readonly int _equipmentIndex;
    private readonly HashSet<TcpClient> _clients = [];
    private readonly HashSet<Task> _clientTasks = [];
    private readonly Dictionary<string, object> _values = new(StringComparer.Ordinal);
    private readonly Stopwatch _autoClock = new();
    private TcpListener? _listener;
    private CancellationTokenSource? _serverCancellation;
    private Task? _acceptTask;
    private bool _running;
    private int _port;
    private string _mode = "manual";
    private long _readCount;
    private DateTimeOffset? _lastReadAt;
    private string? _lastError;

    public S7SimulatorService(S7ProfileRegistry profiles, ILogger<S7SimulatorService> logger)
        : this(profiles, logger, "TC01", 1, 1102) { }

    public S7SimulatorService(S7ProfileRegistry profiles, ILogger<S7SimulatorService> logger,
        string equipmentCode, int equipmentIndex, int defaultPort)
    {
        EquipmentCode = equipmentCode;
        DeviceName = $"{equipmentCode}-SIM";
        DefaultPort = defaultPort;
        _equipmentIndex = equipmentIndex;
        _port = defaultPort;
        _connectionProfiles = IsConveyor
            ? profiles.List().Where(profile => profile.Id.StartsWith(equipmentCode.ToLowerInvariant() + "-", StringComparison.Ordinal))
                .OrderBy(profile => profile.DefaultStartAddress).ToArray()
            : [profiles.Get("tc") ?? throw new InvalidOperationException("模拟器需要 tc 点位模板。")];
        if (_connectionProfiles.Count == 0)
            throw new InvalidOperationException($"模拟器 {equipmentCode} 缺少对应的输送线点位模板。");
        _profile = IsConveyor ? MergeProfiles(_connectionProfiles, equipmentCode) : _connectionProfiles[0];
        _definitions = _profile.Tags.ToDictionary(tag => tag.Name, StringComparer.Ordinal);
        _conveyors = IsConveyor ? BuildConveyors(equipmentIndex, _profile.Tags) : Array.Empty<SimulatorConveyor>();
        _logger = logger;
        ResetValuesLocked();
    }

    public string EquipmentCode { get; }
    public string DeviceName { get; }
    public int DefaultPort { get; }
    private bool IsConveyor => EquipmentCode.StartsWith("CV", StringComparison.Ordinal);

    private static S7ProfileDefinition MergeProfiles(IReadOnlyList<S7ProfileDefinition> profiles, string equipmentCode)
    {
        if (profiles.Any(profile => profile.DefaultDbNumber != 600))
            throw new InvalidOperationException($"输送线 {equipmentCode} 的所有模拟块必须属于 DB600。");
        var start = profiles.Min(profile => profile.DefaultStartAddress);
        var tags = profiles.SelectMany(profile => profile.Tags.Select(tag => tag with
        {
            Offset = profile.DefaultStartAddress + tag.Offset - start
        })).OrderBy(tag => tag.Offset).ToArray();
        if (tags.Select(tag => tag.Name).Distinct(StringComparer.Ordinal).Count() != tags.Length)
            throw new InvalidOperationException($"输送线 {equipmentCode} 的分块点位不能重名。");
        return new S7ProfileDefinition
        {
            Id = equipmentCode.ToLowerInvariant(), Name = $"{equipmentCode} 输送线模拟",
            DefaultDbNumber = 600, DefaultStartAddress = start,
            ReadLength = profiles.Max(profile => profile.DefaultStartAddress + profile.ReadLength) - start,
            DefaultPollIntervalMs = profiles[0].DefaultPollIntervalMs, Tags = tags
        };
    }

    private static IReadOnlyList<SimulatorConveyor> BuildConveyors(int floor, IReadOnlyList<S7TagDefinition> tags)
    {
        const string statePrefix = "PLC_STATUS_STATE_";
        var unmapped = new HashSet<string>(StringComparer.Ordinal) { "1005", "1030", "1052", "1098" };
        return tags.Where(tag => tag.Name.StartsWith(statePrefix, StringComparison.Ordinal)).Select(tag =>
        {
            var sourceId = tag.Name[statePrefix.Length..];
            if (sourceId.Length != 6 || !int.TryParse(sourceId[^3..], out var number))
                throw new InvalidOperationException($"输送线点位来源编号不合法：{tag.Name}。");
            var id = (floor * 1000 + number).ToString(System.Globalization.CultureInfo.InvariantCulture);
            return new SimulatorConveyor(id, sourceId, tag.Name, $"PLC_STATUS_HASGOODS_{sourceId}",
                $"PLC_STATUS_CONTNO_{sourceId}", !unmapped.Contains(id));
        }).ToArray();
    }

    // Merely starting the web host does not open a PLC port or create a device.
    public Task StartAsync(CancellationToken cancellationToken) => Task.CompletedTask;
    public async Task StopAsync(CancellationToken cancellationToken) => await StopServerAsync();

    public S7SimulatorSnapshot Snapshot()
    {
        lock (_sync)
        {
            UpdateAutomaticValuesLocked();
            return SnapshotLocked();
        }
    }

    private S7SimulatorSnapshot SnapshotLocked() => new()
    {
        EquipmentCode = EquipmentCode,
        DeviceName = DeviceName,
        Kind = IsConveyor ? "conveyor" : "crane",
        Floor = IsConveyor ? _equipmentIndex : null,
        ProfileId = IsConveyor ? null : _profile.Id,
        ProfileIds = _connectionProfiles.Select(profile => profile.Id).ToArray(),
        EnumDescription = IsConveyor
            ? "本地模拟约定：状态 0停止、1运行、2报警、3离线；有货 0无货、1有货。未知数值原样保留。托盘号使用 S7 STRING[10] ASCII（2字节头+10字节内容），现场枚举与编码待核对。"
            : null,
        Conveyors = _conveyors,
        Running = _running,
        Port = _port,
        DbNumber = _profile.DefaultDbNumber,
        StartAddress = _profile.DefaultStartAddress,
        ReadLength = _profile.ReadLength,
        Mode = _mode,
        ClientCount = _clients.Count,
        ReadCount = _readCount,
        LastReadAt = _lastReadAt,
        LastError = _lastError,
        Values = new Dictionary<string, object>(_values, StringComparer.Ordinal),
        Tags = _profile.Tags.Select(tag => new SimulatorTag(tag.Name,
            $"DB{_profile.DefaultDbNumber}.DB{(tag.DataType == "UInt32" ? "D" : tag.DataType == "String" ? "B" : "W")}{_profile.DefaultStartAddress + tag.Offset}",
            tag.DataType, tag.Description, _values[tag.Name], tag.Length)).ToArray()
    };

    public async Task<S7SimulatorSnapshot> StartServerAsync(int? requestedPort = null)
    {
        await _lifecycle.WaitAsync();
        try
        {
            StartServerLocked(requestedPort);
            return Snapshot();
        }
        finally { _lifecycle.Release(); }
    }

    private void StartServerLocked(int? requestedPort)
    {
        lock (_sync)
        {
            var port = requestedPort ?? _port;
            if (port is < 1 or > 65535)
                throw new ArgumentException("模拟 PLC 端口范围为 1–65535。");
            if (_running)
            {
                if (port != _port)
                    throw new ArgumentException($"模拟 PLC 正在 127.0.0.1:{_port} 运行，请先停止再修改端口。");
                return;
            }

            // An accept failure can have stopped an earlier listener. Its token
            // must be cancelled before installing a new listener generation.
            _serverCancellation?.Cancel();
            _serverCancellation?.Dispose();
            _serverCancellation = null;
            _listener?.Stop();
            _listener = null;
            var listener = new TcpListener(IPAddress.Loopback, port);
            try { listener.Start(32); }
            catch (SocketException ex)
            {
                listener.Stop();
                _lastError = $"无法启动 127.0.0.1:{port}，端口可能已占用或无访问权限。";
                throw new ArgumentException(_lastError, ex);
            }

            _listener = listener;
            _serverCancellation = new CancellationTokenSource();
            _port = port;
            _running = true;
            _lastError = null;
            if (_mode == "auto") _autoClock.Start();
            _acceptTask = AcceptClientsAsync(listener, _serverCancellation.Token);
            _logger.LogInformation("Local S7 simulator listening at 127.0.0.1:{Port}", port);
        }
    }

    public async Task<S7SimulatorSnapshot> StopServerAsync()
    {
        await _lifecycle.WaitAsync();
        try
        {
            Task? acceptTask;
            CancellationTokenSource? cancellation;
            lock (_sync)
            {
                UpdateAutomaticValuesLocked();
                _running = false;
                _autoClock.Stop();
                cancellation = _serverCancellation;
                _serverCancellation = null;
                cancellation?.Cancel();
                _listener?.Stop();
                _listener = null;
                foreach (var client in _clients) client.Dispose();
                acceptTask = _acceptTask;
                _acceptTask = null;
            }
            if (acceptTask is not null) await acceptTask;
            Task[] pending;
            lock (_sync) pending = _clientTasks.ToArray();
            if (pending.Length > 0) await Task.WhenAll(pending);
            cancellation?.Dispose();
            return Snapshot();
        }
        finally { _lifecycle.Release(); }
    }

    public S7SimulatorSnapshot SetValues(Dictionary<string, JsonElement>? values)
    {
        if (values is null || values.Count == 0)
            throw new ArgumentException("请输入至少一个模拟点位值。");
        // Validate the entire patch before touching memory, including mode.
        var patch = new Dictionary<string, object>(StringComparer.Ordinal);
        foreach (var (name, element) in values)
        {
            if (!_definitions.TryGetValue(name, out var definition))
                throw new ArgumentException($"未知模拟点位：{name}。");
            if (definition.DataType == "String")
            {
                var text = element.ValueKind == JsonValueKind.String ? element.GetString() : null;
                if (text is null || text.Length > definition.Length || text.Any(character => character > 0x7f))
                    throw new ArgumentException($"{name} 必须是长度不超过 {definition.Length} 的 ASCII 字符串，前导零会原样保留。");
                patch.Add(name, text);
                continue;
            }
            var max = definition.DataType == "UInt16" ? ushort.MaxValue : uint.MaxValue;
            if (element.ValueKind != JsonValueKind.Number || !element.TryGetUInt32(out var value) || value > max)
                throw new ArgumentException($"{name} 必须是 0–{max} 之间的整数（{definition.DataType}）。");
            patch.Add(name, value);
        }
        lock (_sync)
        {
            UpdateAutomaticValuesLocked();
            _mode = "manual";
            _autoClock.Stop();
            foreach (var (name, value) in patch) _values[name] = value;
            return SnapshotLocked();
        }
    }

    public S7SimulatorSnapshot SetMode(string? mode)
    {
        if (mode is not ("manual" or "auto"))
            throw new ArgumentException("模拟模式必须为 manual（手动）或 auto（自动演示）。");
        lock (_sync)
        {
            UpdateAutomaticValuesLocked();
            if (_mode != mode)
            {
                _mode = mode;
                if (mode == "auto")
                {
                    _autoClock.Restart();
                    if (!_running) _autoClock.Stop();
                    UpdateAutomaticValuesLocked();
                }
                else _autoClock.Stop();
            }
            return SnapshotLocked();
        }
    }

    public S7SimulatorSnapshot Reset()
    {
        lock (_sync)
        {
            ResetValuesLocked();
            return SnapshotLocked();
        }
    }

    private void ResetValuesLocked()
    {
        _mode = "manual";
        _autoClock.Reset();
        foreach (var tag in _profile.Tags) _values[tag.Name] = tag.DataType == "String" ? "" : 0u;
        if (IsConveyor) return;
        PutKnown("PLC_DEVICECODE", (uint)_equipmentIndex);
        PutKnown("PLC_TUNNEL", (uint)_equipmentIndex);
        PutKnown("PLC_STARTPOSX", 1);
        PutKnown("PLC_STARTPOSY", 20);
        PutKnown("PLC_STARTPOSZ", 5);
        PutKnown("PLC_ENDPOSX", 1);
        PutKnown("PLC_ENDPOSY", 21);
        PutKnown("PLC_ENDPOSZ", 6);
        PutKnown("PLC_TASKTYPE", 1);
        PutKnown("PLC_TASK", 900001u + (uint)(_equipmentIndex - 1) * 10000);
        PutKnown("PLC_TASKNO", 900001u + (uint)(_equipmentIndex - 1) * 10000);
        PutKnown("PLC_TASKEXE", 1);
        PutKnown("PLC_TRAYTYPE", 1);
        PutKnown("PLC_DISPATCH", 1);
        PutKnown("PLC_PATTERN", 1);
        PutKnown("PLC_POSX", 1);
        PutKnown("PLC_POSY", 20);
        PutKnown("PLC_POSZ", 5);
        PutKnown("PLC_LOCATX", _equipmentIndex == 1 ? 30000u : (uint)(_equipmentIndex * 6000));
        PutKnown("PLC_LOCATY", _equipmentIndex == 1 ? 5200u : (uint)(1600 + _equipmentIndex * 1400));
        PutKnown("PLC_LOCATZ", 5000);
    }

    private void PutKnown(string name, uint value)
    {
        if (_definitions.ContainsKey(name)) _values[name] = value;
    }

    private void UpdateAutomaticValuesLocked()
    {
        if (_mode != "auto" || !_running) return;
        var seconds = _autoClock.Elapsed.TotalSeconds;
        if (IsConveyor)
        {
            UpdateAutomaticConveyorValuesLocked(seconds);
            return;
        }
        var phase = (_equipmentIndex - 1) * 0.93;
        var cycle = seconds + (_equipmentIndex - 1) * 5;
        var alarm = cycle % 48 >= 42;
        var mode = alarm ? 4u : cycle % 30 >= 26 ? 2u : 1u;
        var walking = (uint)Math.Round(20000 + 18000 * Math.Sin(seconds / 4.8 + phase));
        var lift = (uint)Math.Round(5200 + 3600 * Math.Sin(seconds / 6.2 + 0.7 + phase));
        var fork = (uint)Math.Round(5000 + 2100 * Math.Sin(seconds / 3.1 + phase));
        var task = 900000u + (uint)(_equipmentIndex - 1) * 10000 + (uint)(seconds / 8);
        PutKnown("PLC_DEVICECODE", (uint)_equipmentIndex);
        PutKnown("PLC_TUNNEL", (uint)_equipmentIndex);
        PutKnown("PLC_HEARTBEAT", (uint)(seconds * 2) % 60000);
        PutKnown("PLC_TASKTYPE", 1 + (uint)(seconds / 12) % 3);
        PutKnown("PLC_TASK", task);
        PutKnown("PLC_TASKNO", task);
        PutKnown("PLC_ERROR", alarm ? 1001u : 0u);
        PutKnown("PLC_PATTERN", mode);
        PutKnown("PLC_DISPATCH", mode == 1 && !alarm ? 1u : 0u);
        PutKnown("PLC_CLAIMGOODS", (uint)(seconds / 4) % 2);
        PutKnown("PLC_VANSTATE", (uint)(seconds / 7) % 2);
        PutKnown("PLC_RELEASEFINISH", (uint)(seconds / 6) % 2);
        PutKnown("PLC_LOCATX", walking);
        PutKnown("PLC_LOCATY", lift);
        PutKnown("PLC_LOCATZ", fork);
        PutKnown("PLC_POSY", Math.Max(1u, (uint)Math.Round(walking / 1500d)));
        PutKnown("PLC_POSZ", Math.Max(1u, (uint)Math.Round(lift / 1000d)));
    }

    private void UpdateAutomaticConveyorValuesLocked(double seconds)
    {
        PutKnown("PLC_STATUS_HEART", (uint)(seconds * 2) % 60000);
        var tick = (long)(seconds / 1.8) + (_equipmentIndex - 1) * 3;
        for (var index = 0; index < _conveyors.Count; index++)
        {
            var conveyor = _conveyors[index];
            var slot = ((tick - index) % 11 + 11) % 11;
            var hasGoods = slot is 0 or 1;
            var alarm = ((long)(seconds / 9) + index * 7 + _equipmentIndex) % 67 == 0;
            var offline = index == _conveyors.Count / 2 && (seconds + _equipmentIndex * 7) % 90 >= 85;
            _values[conveyor.StateTag] = offline ? 3u : alarm ? 2u : hasGoods ? 1u : 0u;
            _values[conveyor.HasGoodsTag] = hasGoods ? 1u : 0u;
            var parcel = (_equipmentIndex * 100000L + (tick + _conveyors.Count - index) / 11 + 1) % 10000000000L;
            _values[conveyor.TrayCodeTag] = hasGoods ? parcel.ToString("D10", System.Globalization.CultureInfo.InvariantCulture) : "";
        }
    }

    public async Task<string> ConnectGatewayAsync(S7ConnectionManager manager)
    {
        await _lifecycle.WaitAsync();
        try
        {
            int port;
            lock (_sync) port = _port;
            var devices = manager.List();
            var existing = devices.FirstOrDefault(device => device.IpAddress == "127.0.0.1" &&
                device.Port == port && device.Rack == 0 && device.Slot == 0);
            if (existing is not null && !existing.Name.Equals(DeviceName, StringComparison.OrdinalIgnoreCase))
                throw new ArgumentException($"127.0.0.1:{port} 已由 {existing.Name} 使用，不能复用为 {DeviceName}。请核对设备配置或更换端口。");
            var duplicateName = devices.FirstOrDefault(device =>
                device.Name.Equals(DeviceName, StringComparison.OrdinalIgnoreCase) && device.Id != existing?.Id);
            if (duplicateName is not null)
                throw new ArgumentException($"已存在同名设备 {DeviceName}（{duplicateName.IpAddress}:{duplicateName.Port}），请先在设备页核对其端口。未修改原设备。");
            if (existing is not null && (existing.Blocks.Count != _connectionProfiles.Count ||
                _connectionProfiles.Any(profile => !existing.Blocks.Any(block => block.Enabled && block.Decoder == profile.Id &&
                    block.DbNumber == profile.DefaultDbNumber && block.StartAddress == profile.DefaultStartAddress &&
                    block.ReadLength == profile.ReadLength))))
                throw new ArgumentException($"127.0.0.1:{port} 已有其他读取配置，请在设备页核对，或换一个本地端口。未修改原设备。");

            StartServerLocked(port);
            if (existing is not null)
            {
                if (!existing.Enabled) await manager.ConnectAsync(existing.Id);
                return existing.Id;
            }
            var created = await manager.CreateAsync(new ConnectionRequest
            {
                Name = DeviceName, IpAddress = "127.0.0.1", Port = port,
                Rack = 0, Slot = 0, CpuType = "S7-1200",
                Blocks = _connectionProfiles.Select(profile => new DbBlockRequest
                {
                    Name = profile.Name, DbNumber = profile.DefaultDbNumber,
                    StartAddress = profile.DefaultStartAddress, ReadLength = profile.ReadLength,
                    PollIntervalMs = profile.DefaultPollIntervalMs, Decoder = profile.Id
                }).ToArray()
            });
            return created.Id;
        }
        finally { _lifecycle.Release(); }
    }

    private async Task AcceptClientsAsync(TcpListener listener, CancellationToken cancellationToken)
    {
        try
        {
            while (!cancellationToken.IsCancellationRequested)
            {
                var client = await listener.AcceptTcpClientAsync(cancellationToken);
                lock (_sync)
                {
                    if (cancellationToken.IsCancellationRequested || _clients.Count >= MaxClients)
                    {
                        client.Dispose();
                        continue;
                    }
                    client.NoDelay = true;
                    _clients.Add(client);
                    var task = HandleClientAsync(client, cancellationToken);
                    _clientTasks.Add(task);
                    _ = task.ContinueWith(completed =>
                    {
                        lock (_sync) _clientTasks.Remove(completed);
                    }, CancellationToken.None, TaskContinuationOptions.ExecuteSynchronously, TaskScheduler.Default);
                }
            }
        }
        catch (Exception ex) when (ex is OperationCanceledException or ObjectDisposedException or SocketException or InvalidOperationException)
        {
            if (!cancellationToken.IsCancellationRequested)
            {
                lock (_sync)
                {
                    if (ReferenceEquals(_listener, listener))
                    {
                        UpdateAutomaticValuesLocked();
                        _running = false;
                        _autoClock.Stop();
                        _lastError = "模拟 PLC 监听异常，请停止后重新启动。";
                        _serverCancellation?.Cancel();
                        listener.Stop();
                        foreach (var client in _clients) client.Dispose();
                    }
                }
                _logger.LogWarning(ex, "S7 simulator accept loop stopped unexpectedly");
            }
        }
    }

    private async Task HandleClientAsync(TcpClient client, CancellationToken cancellationToken)
    {
        try
        {
            using var stream = client.GetStream();
            var header = new byte[4];
            var connected = false;
            var negotiated = false;
            while (!cancellationToken.IsCancellationRequested)
            {
                await stream.ReadExactlyAsync(header, cancellationToken);
                var length = BinaryPrimitives.ReadUInt16BigEndian(header.AsSpan(2));
                if (header[0] != 3 || header[1] != 0 || length is < 7 or > 8192)
                    throw new InvalidDataException("无效的 S7 TPKT 帧。");
                var frame = new byte[length];
                header.CopyTo(frame, 0);
                await stream.ReadExactlyAsync(frame.AsMemory(4), cancellationToken);
                var reply = Respond(frame, ref connected, ref negotiated);
                await stream.WriteAsync(reply, cancellationToken);
            }
        }
        catch (Exception ex) when (ex is InvalidDataException or IOException or SocketException or OperationCanceledException or ObjectDisposedException)
        {
            // A normal client disconnect/stop must not turn PLC data into an error.
            if (ex is InvalidDataException && !cancellationToken.IsCancellationRequested)
            {
                lock (_sync) _lastError = ex.Message;
                _logger.LogDebug(ex, "S7 simulator rejected an invalid frame");
            }
        }
        finally
        {
            client.Dispose();
            lock (_sync) _clients.Remove(client);
        }
    }

    private byte[] Respond(byte[] frame, ref bool connected, ref bool negotiated)
    {
        if (frame[5] == 0xe0)
        {
            if (frame.Length < 11 || frame[4] < 6 || frame[4] + 5 != frame.Length)
                throw new InvalidDataException("无效的 S7 COTP 连接请求。");
            var reply = frame.ToArray();
            reply[5] = 0xd0;
            frame.AsSpan(8, 2).CopyTo(reply.AsSpan(6));
            BinaryPrimitives.WriteUInt16BigEndian(reply.AsSpan(8), 1);
            connected = true;
            negotiated = false;
            return reply;
        }
        if (!connected || frame.Length < 17 || frame[4] != 2 || frame[5] != 0xf0 || frame[6] != 0x80 ||
            frame[7] != 0x32 || frame[8] != 1)
            throw new InvalidDataException("模拟 PLC 只接受 COTP/S7comm Job 请求。");
        var reference = BinaryPrimitives.ReadUInt16BigEndian(frame.AsSpan(11));
        var parameterLength = BinaryPrimitives.ReadUInt16BigEndian(frame.AsSpan(13));
        var dataLength = BinaryPrimitives.ReadUInt16BigEndian(frame.AsSpan(15));
        if (parameterLength < 1 || frame.Length != 17 + parameterLength + dataLength)
            throw new InvalidDataException("S7 请求参数长度与帧长度不一致。");
        var parameters = frame.AsSpan(17, parameterLength);
        if (parameters[0] == 0xf0)
        {
            if (parameterLength != 8 || dataLength != 0)
                throw new InvalidDataException("无效的 S7 通信协商请求。");
            var setup = new byte[] { 0xf0, 0, 0, 1, 0, 1, 0, 0 };
            var requestedPdu = BinaryPrimitives.ReadUInt16BigEndian(parameters[6..]);
            BinaryPrimitives.WriteUInt16BigEndian(setup.AsSpan(6), (ushort)Math.Clamp((int)requestedPdu, 240, 960));
            negotiated = true;
            return Ack(reference, setup, []);
        }
        if (!negotiated)
            throw new InvalidDataException("请先完成 S7 通信协商。");
        if (parameters[0] != 4 || parameterLength != 14 || parameters[1] != 1 || dataLength != 0)
            return Ack(reference, [parameters[0], 0], [], 0x81, 0x04);
        if (parameters[2] != 0x12 || parameters[3] != 0x0a || parameters[4] != 0x10 ||
            parameters[5] != 2 || parameters[10] != 0x84)
            return Ack(reference, [4, 1], [0x06, 0, 0, 0]);
        var count = BinaryPrimitives.ReadUInt16BigEndian(parameters[6..]);
        var dbNumber = BinaryPrimitives.ReadUInt16BigEndian(parameters[8..]);
        var bitAddress = parameters[11] * 65536 + parameters[12] * 256 + parameters[13];
        var start = bitAddress / 8;
        byte[] data;
        lock (_sync)
        {
            UpdateAutomaticValuesLocked();
            if (dbNumber != _profile.DefaultDbNumber)
                data = [0x0a, 0, 0, 0];
            else if (bitAddress % 8 != 0 || count < 1 || count > 960 ||
                start + count > _profile.DefaultStartAddress + _profile.ReadLength)
                data = [0x05, 0, 0, 0];
            else
            {
                var memory = new byte[_profile.DefaultStartAddress + _profile.ReadLength];
                foreach (var tag in _profile.Tags)
                {
                    var destination = memory.AsSpan(_profile.DefaultStartAddress + tag.Offset);
                    if (tag.DataType == "String")
                    {
                        var text = (string)_values[tag.Name];
                        destination[0] = checked((byte)tag.Length!.Value);
                        destination[1] = checked((byte)text.Length);
                        Encoding.ASCII.GetBytes(text, destination[2..]);
                    }
                    else if (tag.DataType == "UInt32") BinaryPrimitives.WriteUInt32BigEndian(destination, (uint)_values[tag.Name]);
                    else BinaryPrimitives.WriteUInt16BigEndian(destination, (ushort)(uint)_values[tag.Name]);
                }
                data = new byte[4 + count];
                data[0] = 0xff;
                data[1] = 4;
                BinaryPrimitives.WriteUInt16BigEndian(data.AsSpan(2), (ushort)(count * 8));
                memory.AsSpan(start, count).CopyTo(data.AsSpan(4));
                _readCount++;
                _lastReadAt = DateTimeOffset.UtcNow;
                _lastError = null;
            }
        }
        return Ack(reference, [4, 1], data);
    }

    private static byte[] Ack(ushort reference, byte[] parameters, byte[] data, byte errorClass = 0, byte errorCode = 0)
    {
        var frame = new byte[19 + parameters.Length + data.Length];
        frame[0] = 3;
        BinaryPrimitives.WriteUInt16BigEndian(frame.AsSpan(2), (ushort)frame.Length);
        frame[4] = 2;
        frame[5] = 0xf0;
        frame[6] = 0x80;
        frame[7] = 0x32;
        frame[8] = 3;
        BinaryPrimitives.WriteUInt16BigEndian(frame.AsSpan(11), reference);
        BinaryPrimitives.WriteUInt16BigEndian(frame.AsSpan(13), (ushort)parameters.Length);
        BinaryPrimitives.WriteUInt16BigEndian(frame.AsSpan(15), (ushort)data.Length);
        frame[17] = errorClass;
        frame[18] = errorCode;
        parameters.CopyTo(frame, 19);
        data.CopyTo(frame, 19 + parameters.Length);
        return frame;
    }
}
