using System.Collections.Concurrent;
using WcsGateway.Configuration;
using WcsGateway.S7.Profiles;
using WcsGateway.S7.Transport;

namespace WcsGateway.S7;

public sealed class S7ConnectionManager : IHostedService
{
    private readonly ConcurrentDictionary<string, S7ConnectionSession> _sessions = new();
    private readonly SemaphoreSlim _mutations = new(1, 1);
    private readonly ConnectionConfigStore _store;
    private readonly S7ProfileRegistry _profiles;
    private readonly IPlcClientFactory _clientFactory;
    private readonly S7PollingOptions _options;
    private readonly ILoggerFactory _loggerFactory;

    public S7ConnectionManager(ConnectionConfigStore store, S7ProfileRegistry profiles,
        IPlcClientFactory clientFactory, S7PollingOptions options, ILoggerFactory loggerFactory)
    {
        _store = store;
        _profiles = profiles;
        _clientFactory = clientFactory;
        _options = options;
        _loggerFactory = loggerFactory;
        foreach (var config in store.Load())
            _sessions[config.Id] = NewSession(config);
    }

    public IReadOnlyList<ConnectionSnapshot> List() => _sessions.Values
        .Select(session => session.Snapshot(includeBlockData: false))
        .OrderBy(item => item.Name, StringComparer.OrdinalIgnoreCase).ToArray();

    public ConnectionSnapshot? Get(string id) => _sessions.TryGetValue(id, out var session) ? session.Snapshot() : null;

    public async Task<ConnectionSnapshot> CreateAsync(ConnectionRequest request)
    {
        await _mutations.WaitAsync();
        try
        {
            var config = ConnectionRequestValidator.Validate(request, _profiles);
            EnsureEndpointAvailable(config);
            var session = NewSession(config);
            // 持久化成功后才改变运行状态，避免文件写入失败后遗留未保存的连接。
            _store.Save(Configs().Append(config));
            _sessions[config.Id] = session;
            session.Start();
            return session.Snapshot();
        }
        finally { _mutations.Release(); }
    }

    public async Task<ConnectionSnapshot?> UpdateAsync(string id, ConnectionRequest request)
    {
        await _mutations.WaitAsync();
        try
        {
            if (!_sessions.TryGetValue(id, out var previous)) return null;
            var config = ConnectionRequestValidator.Validate(request, _profiles, id) with { Enabled = previous.Config.Enabled };
            EnsureEndpointAvailable(config, id);
            var session = NewSession(config);
            _store.Save(Configs().Where(item => item.Id != id).Append(config));
            await previous.StopAsync();
            _sessions[id] = session;
            if (config.Enabled) session.Start();
            return session.Snapshot();
        }
        finally { _mutations.Release(); }
    }

    public async Task<ConnectionSnapshot?> ConnectAsync(string id)
    {
        await _mutations.WaitAsync();
        try
        {
            if (!_sessions.TryGetValue(id, out var session)) return null;
            SaveEnabled(id, true);
            session.Start();
            return session.Snapshot();
        }
        finally { _mutations.Release(); }
    }

    public async Task<ConnectionSnapshot?> DisconnectAsync(string id)
    {
        await _mutations.WaitAsync();
        try
        {
            if (!_sessions.TryGetValue(id, out var session)) return null;
            SaveEnabled(id, false);
            await session.StopAsync();
            return session.Snapshot();
        }
        finally { _mutations.Release(); }
    }

    public async Task<bool> RemoveAsync(string id)
    {
        await _mutations.WaitAsync();
        try
        {
            if (!_sessions.TryGetValue(id, out var session)) return false;
            _store.Save(Configs().Where(item => item.Id != id));
            await session.StopAsync();
            _sessions.TryRemove(id, out _);
            return true;
        }
        finally { _mutations.Release(); }
    }

    public Task StartAsync(CancellationToken cancellationToken)
    {
        foreach (var session in _sessions.Values.Where(item => item.Config.Enabled)) session.Start();
        return Task.CompletedTask;
    }

    public async Task StopAsync(CancellationToken cancellationToken)
    {
        await _mutations.WaitAsync(cancellationToken);
        try { await Task.WhenAll(_sessions.Values.Select(session => session.StopAsync())); }
        finally { _mutations.Release(); }
    }

    private IEnumerable<ConnectionConfig> Configs() => _sessions.Values.Select(session => session.Config);
    private void SaveEnabled(string id, bool enabled) =>
        _store.Save(Configs().Select(config => config.Id == id ? config with { Enabled = enabled } : config));

    private S7ConnectionSession NewSession(ConnectionConfig config) => new(config, _profiles,
        _clientFactory, _options, _loggerFactory.CreateLogger<S7ConnectionSession>());

    private void EnsureEndpointAvailable(ConnectionConfig config, string? excludedId = null)
    {
        if (_sessions.Values.Any(session => session.Config.Id != excludedId &&
            ConnectionConfigStore.EndpointKey(session.Config) == ConnectionConfigStore.EndpointKey(config)))
            throw new ArgumentException("该设备连接已存在（同协议 + 网络参数 + 站地址）；请编辑原设备并增加读取块，不要重复建立连接。");
    }
}
