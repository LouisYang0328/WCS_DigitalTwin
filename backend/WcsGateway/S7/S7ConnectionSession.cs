using WcsGateway.Configuration;
using WcsGateway.S7.Profiles;
using WcsGateway.S7.Transport;

namespace WcsGateway.S7;

public sealed class S7ConnectionSession
{
    private readonly S7ProfileRegistry _profiles;
    private readonly IPlcClientFactory _clientFactory;
    private readonly S7PollingOptions _options;
    private TimeSpan ConnectTimeout => TimeSpan.FromMilliseconds(_options.ConnectTimeoutMs);
    private TimeSpan ReadTimeout => TimeSpan.FromMilliseconds(_options.ReadTimeoutMs);
    private readonly object _sync = new();
    private readonly object _lifecycle = new();
    private readonly ILogger _logger;
    private readonly Dictionary<string, BlockRuntime> _runtime;
    private IPlcClient? _plc;
    private CancellationTokenSource? _runCts;
    private Task? _runTask;
    private string _state = "offline";
    private string? _lastError;
    private DateTimeOffset? _lastConnectedAt;
    private DateTimeOffset? _lastReadAt;
    private long _readCount;
    private int _consecutiveFailures;

    private sealed class BlockRuntime
    {
        public long NextReadMs;
        public string? LastError;
        public DateTimeOffset? LastReadAt;
        public long ReadCount;
        public int ConsecutiveFailures;
        public byte[]? Bytes;
        public bool FreshData;
        public IReadOnlyList<TagValue> Tags = Array.Empty<TagValue>();
    }

    public S7ConnectionSession(ConnectionConfig config, S7ProfileRegistry profiles,
        IPlcClientFactory clientFactory, S7PollingOptions options, ILogger logger)
    {
        Config = config;
        _profiles = profiles;
        _clientFactory = clientFactory;
        _options = options;
        _logger = logger;
        _runtime = config.Blocks.ToDictionary(item => item.Id, _ => new BlockRuntime());
    }

    public ConnectionConfig Config { get; }

    public void Start()
    {
        lock (_lifecycle)
        {
            if (_runTask is { IsCompleted: false })
                return;
            Config.Enabled = true;
            lock (_sync)
                _state = "connecting";
            _runCts?.Dispose();
            _runCts = new CancellationTokenSource();
            var token = _runCts.Token;
            _runTask = Task.Run(() => RunAsync(token));
        }
    }

    public async Task StopAsync()
    {
        Task? task;
        lock (_lifecycle)
        {
            Config.Enabled = false;
            _runCts?.Cancel();
            task = _runTask;
        }
        if (task is not null)
        {
            try { await task; }
            catch (OperationCanceledException) { }
        }
        lock (_sync)
            _state = "offline";
    }

    public ConnectionSnapshot Snapshot(bool includeBlockData = true)
    {
        lock (_sync)
        {
            var blocks = Config.Blocks.Select(block =>
            {
                var runtime = _runtime[block.Id];
                var state = !block.Enabled ? "disabled"
                    : !Config.Enabled ? "offline"
                    : _state is "connecting" or "reconnecting" or "offline" ? _state
                    : runtime.LastError is not null ? "faulted"
                    : runtime.LastReadAt is not null ? "online"
                    : "waiting";
                var quality = !block.Enabled ? "disabled"
                    : runtime.LastReadAt is null ? "unknown"
                    : !Config.Enabled || _state is not ("online" or "degraded") || runtime.LastError is not null ? "bad"
                    : !runtime.FreshData || DateTimeOffset.UtcNow - runtime.LastReadAt.Value >
                        TimeSpan.FromMilliseconds(Math.Max(_options.StaleAfterMs, block.PollIntervalMs * 3)) ? "stale"
                    : "good";
                return new DbBlockSnapshot
                {
                    Id = block.Id,
                    Name = block.Name,
                    DbNumber = block.DbNumber,
                    Area = block.Area,
                    StartAddress = block.StartAddress,
                    ReadLength = block.ReadLength,
                    PollIntervalMs = block.PollIntervalMs,
                    Decoder = block.Decoder,
                    Enabled = block.Enabled,
                    State = state,
                    LastError = runtime.LastError,
                    LastReadAt = runtime.LastReadAt,
                    ReadCount = runtime.ReadCount,
                    ConsecutiveFailures = runtime.ConsecutiveFailures,
                    HasData = runtime.LastReadAt is not null,
                    Quality = quality,
                    IsStale = runtime.LastReadAt is not null && quality != "good",
                    RawBase64 = includeBlockData && runtime.Bytes is not null ? Convert.ToBase64String(runtime.Bytes) : null,
                    Tags = includeBlockData ? runtime.Tags : Array.Empty<TagValue>()
                };
            }).ToArray();

            return new ConnectionSnapshot
            {
                Id = Config.Id,
                Protocol = Config.Protocol,
                Name = Config.Name,
                IpAddress = Config.IpAddress,
                Port = Config.Port,
                Rack = Config.Rack,
                Slot = Config.Slot,
                CpuType = Config.CpuType,
                UnitId = Config.UnitId,
                Enabled = Config.Enabled,
                IsSimulation = IsLoopbackAddress(Config.IpAddress),
                State = _state,
                IsConnected = _state is "online" or "degraded",
                LastError = _lastError,
                LastConnectedAt = _lastConnectedAt,
                LastReadAt = _lastReadAt,
                ReadCount = _readCount,
                ConsecutiveFailures = _consecutiveFailures,
                Blocks = blocks
            };
        }
    }

    private async Task RunAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                if (_plc is null || !_plc.IsConnected)
                    await OpenPlcAsync(stoppingToken);

                await ReadDueBlocksAsync(stoppingToken);
                await Task.Delay(GetNextDelay(), stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                ClosePlc();
                int failures;
                lock (_sync)
                {
                    _consecutiveFailures++;
                    failures = _consecutiveFailures;
                    _state = Config.Enabled ? "reconnecting" : "offline";
                    _lastError = ex is OperationCanceledException or TimeoutException
                        ? "连接或读取超时，请检查网络、端口及 PLC 访问设置。"
                        : ex.Message;
                }
        if (failures == 1 || failures % 10 == 0)
            _logger.LogWarning("{Protocol} connection failed ({Failures}): {Name}: {Message}", failures, Config.Protocol, Config.Name, ex.Message);
                try { await Task.Delay(_options.RetryDelay(failures), stoppingToken); }
                catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
            }
        }
        ClosePlc();
        lock (_sync)
            _state = "offline";
    }

    private async Task OpenPlcAsync(CancellationToken stoppingToken)
    {
        ClosePlc();
        lock (_sync)
            _state = _consecutiveFailures == 0 ? "connecting" : "reconnecting";

        var client = _clientFactory.Create(Config);
        _plc = client;
        using var connectTimeout = CancellationTokenSource.CreateLinkedTokenSource(stoppingToken);
        connectTimeout.CancelAfter(ConnectTimeout);
        await client.OpenAsync(connectTimeout.Token).WaitAsync(ConnectTimeout, stoppingToken);

        lock (_sync)
        {
            _lastConnectedAt = DateTimeOffset.UtcNow;
            _lastError = null;
            _state = "online";
            _consecutiveFailures = 0;
            foreach (var runtime in _runtime.Values)
            {
                runtime.NextReadMs = 0;
                runtime.FreshData = false;
            }
        }
        _logger.LogInformation("{Protocol} connected: {Name} {Ip}:{Port}, {Blocks} read blocks",
            Config.Protocol, Config.Name, Config.IpAddress, Config.Port, Config.Blocks.Count);
    }

    private async Task ReadDueBlocksAsync(CancellationToken stoppingToken)
    {
        foreach (var block in Config.Blocks.Where(item => item.Enabled))
        {
            var runtime = _runtime[block.Id];
            if (Environment.TickCount64 < runtime.NextReadMs)
                continue;

            try
            {
                using var readTimeout = CancellationTokenSource.CreateLinkedTokenSource(stoppingToken);
                readTimeout.CancelAfter(ReadTimeout);
                var bytes = await _plc!.ReadAsync(
                    block.Area, block.DbNumber, block.StartAddress, block.ReadLength, readTimeout.Token
                ).WaitAsync(ReadTimeout, stoppingToken);
                if (bytes.Length != block.ReadLength)
                    throw new IOException($"PLC 返回 {bytes.Length} 字节，预期 {block.ReadLength} 字节。");

                // S7 的地址标签含 DB 起始字节；Modbus 等按协议地址寻址，标签用相对偏移，由前端换算。
                var tags = _profiles.Decode(block.Decoder, bytes, Config.IsS7 ? block.StartAddress : 0);
                var now = DateTimeOffset.UtcNow;
                lock (_sync)
                {
                    runtime.Bytes = bytes;
                    runtime.Tags = tags;
                    runtime.FreshData = true;
                    runtime.LastReadAt = now;
                    runtime.ReadCount++;
                    runtime.ConsecutiveFailures = 0;
                    runtime.LastError = null;
                    runtime.NextReadMs = Environment.TickCount64 + block.PollIntervalMs;
                    _lastReadAt = now;
                    _readCount++;
                    UpdateConnectedStateLocked();
                }
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                throw;
            }
            catch (Exception ex)
            {
                RecordBlockError(block, runtime, ex);
                if (ex is OperationCanceledException or TimeoutException || !_plc!.IsConnected)
                    throw new IOException($"{block.Name} 读取后连接失效：{ex.Message}", ex);
            }
        }
    }

    private void RecordBlockError(DbBlockConfig block, BlockRuntime runtime, Exception ex)
    {
        int failures;
        lock (_sync)
        {
            runtime.ConsecutiveFailures++;
            failures = runtime.ConsecutiveFailures;
            runtime.LastError = ex.Message;
            runtime.NextReadMs = Environment.TickCount64 + (long)Math.Min(15000,
                Math.Max(1000, block.PollIntervalMs * Math.Pow(2, Math.Min(failures - 1, 3))));
            UpdateConnectedStateLocked();
        }
        if (failures == 1 || failures % 10 == 0)
            _logger.LogWarning("Block read failed ({Failures}): {Device}/{Block}: {Message}",
                failures, Config.Name, block.Name, ex.Message);
    }

    private void UpdateConnectedStateLocked()
    {
        var hasError = Config.Blocks.Any(block => block.Enabled && _runtime[block.Id].LastError is not null);
        _state = hasError ? "degraded" : "online";
    }

    private TimeSpan GetNextDelay()
    {
        var enabled = Config.Blocks.Where(item => item.Enabled).ToArray();
        if (enabled.Length == 0)
            return TimeSpan.FromMilliseconds(500);
        var now = Environment.TickCount64;
        var next = enabled.Min(item => _runtime[item.Id].NextReadMs);
        return TimeSpan.FromMilliseconds(Math.Clamp(next - now, 20, 250));
    }

    private static bool IsLoopbackAddress(string address) =>
        System.Net.IPAddress.TryParse(address, out var ip) && System.Net.IPAddress.IsLoopback(ip);

    private void ClosePlc()
    {
        var client = _plc;
        _plc = null;
        if (client is null)
            return;
        try { client.Dispose(); }
        catch (Exception ex) { _logger.LogDebug("PLC close failed: {Message}", ex.Message); }
    }
}
